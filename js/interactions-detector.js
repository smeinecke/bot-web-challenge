/**
 * Bot Detection Challenge - Interactions Detector
 * Tracks mouse movements, typing patterns, and form submission timing
 */

(function() {
    'use strict';

    const shared = window.BotDetectorShared;

    // Simulation state
    let _originalWebdriverDescriptor = null;

    // Tracking state
    let tracking = {
        mouseEvents: [],
        keyEvents: [],
        formStartTime: null,
        firstFocusTime: null,
        lastActivityTime: null,
        submitTime: null,
        totalKeystrokes: 0,
        mousePathLength: 0,
        lastMousePos: null,
        cdpLeakChecks: [],
        // Advanced interaction signals
        hasUntrustedEvent: false,
        clicksAtExactCenter: 0,
        clicksAtZero: 0,
        suspiciousKeyEvents: 0,
        keystrokeTimes: []
    };

    const MAX_EVENTS = 500;

    // Keep references to registered listeners so they can be removed on reset
    let _listenersAttached = false;

    /**
     * Start tracking interactions
     */
    function startTracking() {
        resetTracking();
        tracking.formStartTime = Date.now();

        if (_listenersAttached) return;
        _listenersAttached = true;

        document.addEventListener('mousemove', onMouseMove, { passive: true });
        document.addEventListener('mousedown', onMouseDown, { passive: true });
        document.addEventListener('mouseup', onMouseUp, { passive: true });
        document.addEventListener('keydown', onKeyDown, { passive: true });
        document.addEventListener('keyup', onKeyUp, { passive: true });

        const form = document.getElementById('login-form');
        if (form) {
            form.addEventListener('focusin', onFormFocus, { passive: true });
            form.addEventListener('submit', onFormSubmit);
        }
    }

    /**
     * Reset tracking state (listeners remain attached — data is cleared)
     */
    function resetTracking() {
        tracking = {
            mouseEvents: [],
            keyEvents: [],
            formStartTime: null,
            firstFocusTime: null,
            lastActivityTime: null,
            submitTime: null,
            totalKeystrokes: 0,
            mousePathLength: 0,
            lastMousePos: null,
            cdpLeakChecks: [],
            hasUntrustedEvent: false,
            clicksAtExactCenter: 0,
            clicksAtZero: 0,
            suspiciousKeyEvents: 0,
            keystrokeTimes: []
        };
        if (_originalWebdriverDescriptor) {
            try {
                Object.defineProperty(navigator, 'webdriver', _originalWebdriverDescriptor);
            } catch (_) {}
            _originalWebdriverDescriptor = null;
        }
    }

    /**
     * Mouse move handler with CDP leak detection
     */
    function onMouseMove(e) {
        const now = Date.now();
        const pos = { x: e.clientX, y: e.clientY };

        // CDP mouse leak detection
        // CDP-injected mouse events often have screenX === clientX (missing window position offset)
        // In normal browsers: screenX = clientX + window.screenX (window position on screen)
        const windowScreenX = typeof window.screenX !== 'undefined' ? window.screenX : window.screenLeft || 0;
        const windowScreenY = typeof window.screenY !== 'undefined' ? window.screenY : window.screenTop || 0;

        // Expected screen coords = client coords + window position on screen
        const expectedScreenX = pos.x + windowScreenX;
        const expectedScreenY = pos.y + windowScreenY;

        // CDP bug: screenX === clientX (forgets to add window position)
        const looksLikeCDP = Math.abs(e.screenX - pos.x) < 5 && Math.abs(e.screenY - pos.y) < 5;
        const hasWindowOffset = windowScreenX !== 0 || windowScreenY !== 0;

        // Only flag as CDP leak if window has position offset but screen coords don't reflect it
        const screenMismatch = hasWindowOffset && looksLikeCDP;

        if (tracking.mouseEvents.length < MAX_EVENTS) {
            tracking.mouseEvents.push({
                type: 'move',
                x: pos.x,
                y: pos.y,
                screenX: e.screenX,
                screenY: e.screenY,
                time: now,
                screenMismatch
            });
        }

        // Calculate path length
        if (tracking.lastMousePos) {
            const dx = pos.x - tracking.lastMousePos.x;
            const dy = pos.y - tracking.lastMousePos.y;
            tracking.mousePathLength += Math.sqrt(dx * dx + dy * dy);
        }
        tracking.lastMousePos = pos;

        // Collect CDP leak checks with structured results
        if (tracking.cdpLeakChecks.length < 100) {
            const ua = navigator.userAgent;
            const isFirefoxLinux = /firefox/i.test(ua) && /linux|x11/i.test(ua);

            if (!looksLikeCDP) {
                tracking.cdpLeakChecks.push({ suspicious: false });
            } else if (isFirefoxLinux) {
                // Firefox/Linux can report screen coordinates equal to client coordinates in normal browsing
                tracking.cdpLeakChecks.push({
                    suspicious: false,
                    reason: 'screen_equals_client_in_firefox_linux',
                    confidence: 'none',
                    description: 'Firefox/Linux may report screen coordinates equal to client coordinates in normal browsing.'
                });
            } else if (!hasWindowOffset) {
                tracking.cdpLeakChecks.push({
                    suspicious: false,
                    reason: 'no_window_offset',
                    confidence: 'none',
                    description: 'screenX/screenY equal client coordinates, but no reliable window offset exists.'
                });
            } else {
                tracking.cdpLeakChecks.push({
                    suspicious: true,
                    reason: 'screen_equals_client_with_window_offset',
                    confidence: 'medium',
                    description: 'MouseEvent screen coordinates equal client coordinates despite non-zero window offset.'
                });
            }
        }

        tracking.lastActivityTime = now;
    }

    function onMouseDown(e) {
        if (!e.isTrusted) tracking.hasUntrustedEvent = true;

        if (tracking.mouseEvents.length < MAX_EVENTS) {
            tracking.mouseEvents.push({
                type: 'down',
                x: e.clientX,
                y: e.clientY,
                button: e.button,
                time: Date.now(),
                isTrusted: e.isTrusted
            });
        }

        // Zero-coordinate click is a known CDP/automation artifact
        if (e.clientX === 0 && e.clientY === 0) {
            tracking.clicksAtZero++;
        }

        // Check if click landed on the exact center of the target element
        if (e.target && e.target.getBoundingClientRect) {
            const rect = e.target.getBoundingClientRect();
            const cx = Math.round(rect.left + rect.width / 2);
            const cy = Math.round(rect.top + rect.height / 2);
            if (Math.abs(e.clientX - cx) <= 1 && Math.abs(e.clientY - cy) <= 1) {
                tracking.clicksAtExactCenter++;
            }
        }
    }

    function onMouseUp(e) {
        if (!e.isTrusted) tracking.hasUntrustedEvent = true;
        if (tracking.mouseEvents.length < MAX_EVENTS) {
            tracking.mouseEvents.push({
                type: 'up',
                x: e.clientX,
                y: e.clientY,
                button: e.button,
                time: Date.now(),
                isTrusted: e.isTrusted
            });
        }
    }

    function onKeyDown(e) {
        if (!e.isTrusted) tracking.hasUntrustedEvent = true;

        // Synthetic key events from some automation frameworks have empty code/key
        // but a non-zero keyCode — this is not possible for real keyboard input
        if (e.code === '' && e.key === '' && e.keyCode > 0) {
            tracking.suspiciousKeyEvents++;
        }

        if (tracking.keyEvents.length < MAX_EVENTS) {
            tracking.keyEvents.push({
                type: 'down',
                key: e.key,
                code: e.code,
                time: Date.now(),
                isTrusted: e.isTrusted
            });
        }
        tracking.keystrokeTimes.push(Date.now());
        tracking.totalKeystrokes++;
        tracking.lastActivityTime = Date.now();
    }

    function onKeyUp(e) {
        if (!e.isTrusted) tracking.hasUntrustedEvent = true;
        if (tracking.keyEvents.length < MAX_EVENTS) {
            tracking.keyEvents.push({
                type: 'up',
                key: e.key,
                code: e.code,
                time: Date.now(),
                isTrusted: e.isTrusted
            });
        }
        tracking.lastActivityTime = Date.now();
    }

    function onFormFocus(e) {
        if (!tracking.firstFocusTime) {
            tracking.firstFocusTime = Date.now();
        }
    }

    /**
     * Form submission handler
     */
    function onFormSubmit(e) {
        e.preventDefault();
        tracking.submitTime = Date.now();

        analyzeAndShowResults();
    }

    /**
     * Analyze all tracking data (async because some static tests are async)
     */
    async function analyzeTrackingData() {
        const results = {
            // Include all static tests (sync)
            hasBotUserAgent: shared.checkBotUserAgent(),
            hasWebdriverTrue: shared.checkWebdriver(),
            hasWebdriverInFrameTrue: shared.checkWebdriverInFrame(),
            isPlaywright: shared.checkPlaywright(),
            isSeleniumChromeDefault: shared.checkSeleniumChromeDefault(),
            isHeadlessChrome: shared.checkHeadlessChrome(),
            isWebGLInconsistent: shared.checkWebGLInconsistent(),
            isAutomatedWithCDP: shared.checkAutomatedWithCDP(),
            hasInconsistentChromeObject: shared.checkInconsistentChrome(),
            isPhantom: shared.checkPhantomJS(),
            isNightmare: shared.checkNightmare(),
            isSequentum: shared.checkSequentum(),
            isIframeOverridden: shared.checkIframeOverridden(),
            hasHighHardwareConcurrency: shared.checkHighHardwareConcurrency(),
            hasHeadlessChromeDefaultScreenResolution: shared.checkHeadlessResolution(),
            hasMissingBrowserChrome: shared.checkMissingBrowserChrome(),
            hasScreenAvailabilityAnomaly: shared.checkScreenAvailability(),
            hasTouchInconsistency: shared.checkTouchInconsistency(),
            hasSuspiciousWeakSignals: shared.analyzeWeakSignals(),
            isAutomatedViaStackTrace: shared.checkCDPViaStackTrace(),
            hasCanvasAvailabilityIssue: shared.checkCanvasAvailability(),

            // Include static tests (async)
            hasInconsistentClientHints: shared.checkInconsistentClientHints(),
            hasInconsistentGPUFeatures: shared.checkInconsistentGPUFeatures(),
            hasInconsistentWorkerValues: await shared.checkInconsistentWorkerValues(),
            isAutomatedWithCDPInWebWorker: await shared.checkAutomatedWithCDPInWorker(),
            hasBlobIframeCDPIssue: await shared.checkBlobIframeCDP(),
            hasAudioFingerprintIssue: await shared.checkAudioFingerprint(),
            hasNavigatorIntegrityViolation: shared.checkNavigatorIntegrity(),
        };

        // Interaction-based tests
        results.suspiciousClientSideBehavior = analyzeSuspiciousBehavior();
        results.superHumanSpeed = analyzeSuperHumanSpeed();
        results.hasCDPMouseLeak = analyzeCDPMouseLeak();
        results.hasAdvancedBotSignals = analyzeAdvancedInteractionSignals();

        return results;
    }

    /**
     * Analyze for suspicious client-side behavior
     */
    function analyzeSuspiciousBehavior() {
        const suspicious = [];

        // Check for no mouse movement
        if (tracking.mouseEvents.length < 10) {
            suspicious.push('insufficientMouseMovement');
        }

        // Check for perfectly straight lines (bot-like movement)
        if (tracking.mouseEvents.length > 50) {
            const straightLines = countStraightLines();
            const moveEvents = tracking.mouseEvents.filter(e => e.type === 'move').length;
            // Very high threshold - humans have some jitter even when moving "straight"
            if (moveEvents > 30 && straightLines > moveEvents * 0.95) {
                suspicious.push('tooManyStraightLines');
            }
        }

        // Check for uniform timing between events
        if (tracking.mouseEvents.length > 20) {
            const uniformTiming = checkUniformTiming(tracking.mouseEvents);
            if (uniformTiming) {
                suspicious.push('uniformEventTiming');
            }
        }

        // Check for instant form completion
        const formDuration = tracking.submitTime - tracking.firstFocusTime;
        if (tracking.firstFocusTime && formDuration < 1000) { // Less than 1 second
            suspicious.push('instantFormCompletion');
        }

        // Check for no typing (paste-only)
        if (tracking.totalKeystrokes === 0 && tracking.submitTime) {
            const emailField = document.getElementById('email');
            const passwordField = document.getElementById('password');
            if ((emailField && emailField.value) || (passwordField && passwordField.value)) {
                suspicious.push('pasteOnlyInput');
            }
        }

        if (suspicious.length > 0) {
            const descriptions = {
                'insufficientMouseMovement': `Only ${tracking.mouseEvents.length} mouse events detected`,
                'tooManyStraightLines': 'Mouse path shows >95% straight lines (bot-like)',
                'uniformEventTiming': 'Mouse events have suspiciously uniform timing',
                'instantFormCompletion': `Form completed in ${formDuration}ms - too fast`,
                'pasteOnlyInput': 'Form filled without keystrokes (paste-only)'
            };

            return {
                behaviors: suspicious,
                description: suspicious.map(b => descriptions[b] || b).join('; ')
            };
        }

        return false;
    }

    /**
     * Count straight line segments in mouse path
     */
    function countStraightLines() {
        let straightCount = 0;
        const moveEvents = tracking.mouseEvents.filter(e => e.type === 'move');

        for (let i = 2; i < moveEvents.length; i++) {
            const p1 = moveEvents[i - 2];
            const p2 = moveEvents[i - 1];
            const p3 = moveEvents[i];

            // Check if three points are collinear (approximately)
            // Using cross product: if result is near 0, points are collinear
            const crossProduct = Math.abs((p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x));
            // Threshold: allow some natural wobble in human movement
            // Scale threshold by distance - longer lines can have more deviation
            const distance = Math.sqrt(Math.pow(p3.x - p1.x, 2) + Math.pow(p3.y - p1.y, 2));
            const threshold = Math.max(50, distance * 0.1); // 10% of line length or minimum 50px
            if (crossProduct < threshold) {
                straightCount++;
            }
        }

        return straightCount;
    }

    /**
     * Check for uniform timing between events
     */
    function checkUniformTiming(events) {
        if (events.length < 10) return false;

        const intervals = [];
        for (let i = 1; i < events.length; i++) {
            intervals.push(events[i].time - events[i - 1].time);
        }

        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / intervals.length;
        const stdDev = Math.sqrt(variance);

        // If standard deviation is very low, timing is suspiciously uniform
        return stdDev < 5; // Less than 5ms variance
    }

    /**
     * Analyze for super-human typing speed
     */
    function analyzeSuperHumanSpeed() {
        if (!tracking.firstFocusTime || !tracking.submitTime) {
            return false;
        }

        const totalTime = tracking.submitTime - tracking.firstFocusTime;
        const keystrokes = tracking.totalKeystrokes;

        if (keystrokes === 0) return false;

        // Calculate typing speed (characters per second)
        const cps = keystrokes / (totalTime / 1000);

        // Human typing is typically 3-8 CPS, superhuman is > 15 CPS
        if (cps > 15) {
            return {
                charsPerSecond: cps.toFixed(1),
                totalTime: totalTime,
                keystrokes: keystrokes,
                threshold: 15,
                description: `Typing speed ${cps.toFixed(1)} CPS exceeds human limit (15 CPS)`
            };
        }

        // Also check for suspiciously fast form completion
        if (totalTime < 500 && keystrokes > 5) {
            return {
                charsPerSecond: cps.toFixed(1),
                totalTime: totalTime,
                keystrokes: keystrokes,
                reason: 'tooFastCompletion',
                description: `Form completed in ${totalTime}ms - too fast for human input`
            };
        }

        return false;
    }

    /**
     * Analyze advanced interaction signals from info.js patterns:
     * - isTrusted=false events (synthetic events)
     * - exact center clicks (bots click mathematical centers)
     * - zero coordinate clicks
     * - suspicious key events (empty code/key with non-zero keyCode)
     * - keystroke timing regularity
     */
    function analyzeAdvancedInteractionSignals() {
        const signals = [];

        if (tracking.hasUntrustedEvent) {
            signals.push({
                name: 'untrustedEvent',
                description: 'Event with isTrusted=false detected — automation dispatches synthetic events'
            });
        }

        if (tracking.clicksAtZero > 0) {
            signals.push({
                name: 'zeroCoordinateClick',
                description: `${tracking.clicksAtZero} click(s) at coordinates (0,0) — CDP automation artifact`
            });
        }

        const totalClicks = tracking.mouseEvents.filter(e => e.type === 'down').length;
        if (totalClicks >= 2 && tracking.clicksAtExactCenter >= totalClicks * 0.8) {
            signals.push({
                name: 'exactCenterClicks',
                description: `${tracking.clicksAtExactCenter}/${totalClicks} clicks at exact element center — automated clicking pattern`
            });
        }

        if (tracking.suspiciousKeyEvents > 0) {
            signals.push({
                name: 'syntheticKeyEvents',
                description: `${tracking.suspiciousKeyEvents} key event(s) with empty code/key — automation injection signature`
            });
        }

        // Keystroke interval regularity (complement to the general uniform timing check)
        if (tracking.keystrokeTimes.length >= 5) {
            const intervals = [];
            for (let i = 1; i < tracking.keystrokeTimes.length; i++) {
                intervals.push(tracking.keystrokeTimes[i] - tracking.keystrokeTimes[i - 1]);
            }
            const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const stdDev = Math.sqrt(intervals.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / intervals.length);
            const sorted = [...intervals].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];

            if (stdDev < 10 && avg < 100) {
                signals.push({
                    name: 'uniformKeystrokeTiming',
                    description: `Keystroke intervals too regular (avg ${avg.toFixed(0)}ms, σ=${stdDev.toFixed(1)}ms, median ${median}ms) — bot-like typing`
                });
            }
        }

        if (signals.length === 0) return false;

        return {
            signals: signals.map(s => s.name),
            description: signals.map(s => s.description).join('; ')
        };
    }

    /**
     * Analyze for CDP mouse leak
     * CDP-injected mouse events often have screenX === clientX (missing window position offset)
     * Returns structured results with browser awareness
     */
    function analyzeCDPMouseLeak() {
        if (tracking.mouseEvents.length < 20) {
            return false; // Not enough data
        }

        // Count only suspicious CDP leak results (where suspicious === true)
        const suspiciousChecks = tracking.cdpLeakChecks.filter(result => result && result.suspicious === true);

        if (suspiciousChecks.length === 0) {
            return false;
        }

        const totalChecks = tracking.cdpLeakChecks.length;
        const ratio = suspiciousChecks.length / totalChecks;

        // Get window position for context
        const windowScreenX = typeof window.screenX !== 'undefined' ? window.screenX : window.screenLeft || 0;
        const windowScreenY = typeof window.screenY !== 'undefined' ? window.screenY : window.screenTop || 0;

        // If more than 80% of checks show the CDP pattern, flag it
        if (ratio > 0.8 && totalChecks > 20) {
            return {
                cdpPatternRatio: ratio.toFixed(2),
                totalEvents: tracking.mouseEvents.filter(e => e.type === 'move').length,
                suspiciousChecks: suspiciousChecks.length,
                totalChecks: totalChecks,
                windowPosition: { x: windowScreenX, y: windowScreenY },
                reason: 'cdpScreenOffsetBug',
                confidence: 'medium',
                description: `${(ratio * 100).toFixed(0)}% events show CDP screen coordinate bug (screenX === clientX with window offset)`
            };
        }

        return false;
    }

    /**
     * Display interaction analysis results
     */
    function displayResults(results, container) {
        container.innerHTML = '';

        // Interaction tests
        const interactionSection = document.createElement('div');
        interactionSection.innerHTML = '<h3>Interaction Analysis</h3>';

        const resultsGrid = document.createElement('div');
        resultsGrid.className = 'results-grid';

        const resultItems = [
            { label: 'suspiciousClientSideBehavior', value: results.suspiciousClientSideBehavior !== false, details: results.suspiciousClientSideBehavior },
            { label: 'superHumanSpeed', value: results.superHumanSpeed !== false, details: results.superHumanSpeed },
            { label: 'hasCDPMouseLeak', value: results.hasCDPMouseLeak !== false, details: results.hasCDPMouseLeak },
            { label: 'hasAdvancedBotSignals', value: results.hasAdvancedBotSignals !== false, details: results.hasAdvancedBotSignals },
        ];

        for (const item of resultItems) {
            const isBoolean = typeof item.value === 'boolean';
            const hasDetails = item.details !== undefined && item.details !== false && item.details !== null;
            resultsGrid.appendChild(shared.createResultElement(item.label, item.value, isBoolean, hasDetails ? item.details : null));
        }

        interactionSection.appendChild(resultsGrid);
        container.appendChild(interactionSection);

        // Static tests section
        const staticSection = document.createElement('div');
        staticSection.innerHTML = '<h3>Static Fingerprinting</h3>';

        const staticGrid = document.createElement('div');
        staticGrid.className = 'results-grid';

        const staticItems = [
            { label: 'hasBotUserAgent', value: results.hasBotUserAgent },
            { label: 'hasWebdriverTrue', value: results.hasWebdriverTrue },
            { label: 'hasWebdriverInFrameTrue', value: results.hasWebdriverInFrameTrue },
            { label: 'isPlaywright', value: results.isPlaywright },
            { label: 'hasInconsistentChromeObject', value: results.hasInconsistentChromeObject },
            { label: 'isPhantom', value: results.isPhantom },
            { label: 'isNightmare', value: results.isNightmare },
            { label: 'isSequentum', value: results.isSequentum },
            { label: 'isSeleniumChromeDefault', value: results.isSeleniumChromeDefault },
            { label: 'isHeadlessChrome', value: results.isHeadlessChrome !== false, details: results.isHeadlessChrome },
            { label: 'isWebGLInconsistent', value: results.isWebGLInconsistent !== false, details: results.isWebGLInconsistent },
            { label: 'isAutomatedWithCDP', value: results.isAutomatedWithCDP },
            { label: 'isAutomatedWithCDPInWebWorker', value: results.isAutomatedWithCDPInWebWorker },
            { label: 'hasInconsistentClientHints', value: results.hasInconsistentClientHints !== false, details: results.hasInconsistentClientHints },
            { label: 'hasInconsistentGPUFeatures', value: results.hasInconsistentGPUFeatures !== false, details: results.hasInconsistentGPUFeatures },
            { label: 'isIframeOverridden', value: results.isIframeOverridden !== false, details: results.isIframeOverridden },
            { label: 'hasInconsistentWorkerValues', value: results.hasInconsistentWorkerValues !== false, details: results.hasInconsistentWorkerValues },
            { label: 'hasBlobIframeCDPIssue', value: results.hasBlobIframeCDPIssue !== false, details: results.hasBlobIframeCDPIssue },
            { label: 'hasHighHardwareConcurrency', value: results.hasHighHardwareConcurrency !== false, details: results.hasHighHardwareConcurrency },
            { label: 'hasHeadlessChromeDefaultScreenResolution', value: results.hasHeadlessChromeDefaultScreenResolution !== false, details: results.hasHeadlessChromeDefaultScreenResolution },
            { label: 'hasMissingBrowserChrome', value: results.hasMissingBrowserChrome !== false, details: results.hasMissingBrowserChrome },
            { label: 'hasScreenAvailabilityAnomaly', value: results.hasScreenAvailabilityAnomaly !== false, details: results.hasScreenAvailabilityAnomaly },
            { label: 'hasTouchInconsistency', value: results.hasTouchInconsistency !== false, details: results.hasTouchInconsistency },
            { label: 'hasNavigatorIntegrityViolation', value: results.hasNavigatorIntegrityViolation !== false, details: results.hasNavigatorIntegrityViolation },
            { label: 'hasSuspiciousWeakSignals', value: results.hasSuspiciousWeakSignals !== false, details: results.hasSuspiciousWeakSignals },
            { label: 'isAutomatedViaStackTrace', value: results.isAutomatedViaStackTrace && results.isAutomatedViaStackTrace.likelySource === 'automation', details: results.isAutomatedViaStackTrace, showLikelySource: true },
            { label: 'hasCanvasAvailabilityIssue', value: results.hasCanvasAvailabilityIssue !== false, details: results.hasCanvasAvailabilityIssue },
            { label: 'hasAudioFingerprintIssue', value: results.hasAudioFingerprintIssue !== false, details: results.hasAudioFingerprintIssue },
        ];

        for (const item of staticItems) {
            const isBoolean = typeof item.value === 'boolean';
            const hasDetails = item.details !== undefined && item.details !== false && item.details !== null;
            staticGrid.appendChild(shared.createResultElement(
                item.label,
                item.value,
                isBoolean,
                hasDetails ? item.details : null,
                item.showLikelySource
            ));
        }

        staticSection.appendChild(staticGrid);
        container.appendChild(staticSection);

        // Update overall status
        updateOverallStatus(results);

        // Add tracking stats
        addTrackingStats(container);
    }

    /**
     * Add tracking statistics
     */
    function addTrackingStats(container) {
        const statsDiv = document.createElement('div');
        statsDiv.className = 'info-section';
        statsDiv.innerHTML = `
            <h3>Tracking Statistics</h3>
            <ul>
                <li>Mouse events: ${tracking.mouseEvents.length}</li>
                <li>Key events: ${tracking.keyEvents.length}</li>
                <li>Mouse path length: ${Math.round(tracking.mousePathLength)} px</li>
                <li>Total keystrokes: ${tracking.totalKeystrokes}</li>
                <li>Form completion time: ${tracking.submitTime && tracking.firstFocusTime ?
                    (tracking.submitTime - tracking.firstFocusTime) + ' ms' : 'N/A'}</li>
            </ul>
        `;
        container.appendChild(statsDiv);
    }

    /**
     * Update overall bot/human status using shared scoring
     */
    function updateOverallStatus(results) {
        const statusContainer = document.getElementById('overall-status');
        if (!statusContainer) return;

        const { uiStatus } = shared.summarizeResults(results);
        statusContainer.innerHTML = `<span class="status-badge ${uiStatus.statusClass}">${uiStatus.statusText}</span>`;
    }

    /**
     * Analyze and show results
     */
    async function analyzeAndShowResults() {
        const container = document.getElementById('interaction-results');
        if (container) {
            container.innerHTML = '<div class="loading"><span class="spinner"></span>Analyzing interactions...</div>';
        }

        // Small delay to show loading state
        setTimeout(async () => {
            const results = await analyzeTrackingData();
            if (container) {
                displayResults(results, container);
            }
            window.lastInteractionResults = results;
        }, 100);
    }

    /**
     * Simulate bot interactions for testing
     */
    function simulateBotMode() {
        _originalWebdriverDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');

        // Override navigator.webdriver
        Object.defineProperty(navigator, 'webdriver', {
            get: () => true,
            configurable: true
        });

        // Reset worker cache so simulation gets fresh worker results
        if (shared.resetWorkerTestsCache) {
            shared.resetWorkerTestsCache();
        }

        // Pre-fill form quickly
        const emailField = document.getElementById('email');
        const passwordField = document.getElementById('password');

        if (emailField) {
            emailField.value = 'test@example.com';
            emailField.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (passwordField) {
            passwordField.value = 'password123';
            passwordField.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Simulate instant typing
        tracking.totalKeystrokes = 25;
        tracking.firstFocusTime = Date.now() - 200;
        tracking.submitTime = Date.now();

        // Add some mouse events with CDP-like patterns (perfect straight line, uniform timing)
        const now = Date.now();
        for (let i = 0; i < 50; i++) {
            tracking.mouseEvents.push({
                type: 'move',
                x: 100 + i * 5,
                y: 200,
                screenX: 100 + i * 5,
                screenY: 200,
                time: now - (50 - i) * 16,
                screenMismatch: true,
                isTrusted: false
            });
            tracking.cdpLeakChecks.push({
                suspicious: true,
                reason: 'simulated_cdp_mouse_leak',
                confidence: 'medium',
                description: 'Simulated CDP screen coordinate leak'
            });
        }
        // Simulate clicks at exact center and zero coordinates
        tracking.hasUntrustedEvent = true;
        tracking.clicksAtZero = 1;
        tracking.clicksAtExactCenter = 3;
        tracking.mouseEvents.push({ type: 'down', x: 0, y: 0, isTrusted: false, time: now });
        tracking.mouseEvents.push({ type: 'down', x: 0, y: 0, isTrusted: false, time: now + 1 });
        tracking.mouseEvents.push({ type: 'down', x: 0, y: 0, isTrusted: false, time: now + 2 });

        // Trigger analysis
        analyzeAndShowResults();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startTracking);
    } else {
        startTracking();
    }

    // Expose functions
    window.InteractionDetector = {
        start: startTracking,
        reset: resetTracking,
        analyze: analyzeAndShowResults,
        simulateBot: simulateBotMode,
        getTrackingData: () => tracking
    };

})();
