/**
 * Bot Detection Challenge - Static Fingerprinting Detector
 * Runs all static detection tests and displays results
 */

(function() {
    'use strict';

    // Global error handlers for debugging
    window.addEventListener('error', function(e) {
        console.error('[BotDetector] Global error caught:', e.error, 'at', e.filename, ':', e.lineno);
    });
    window.addEventListener('unhandledrejection', function(e) {
        console.error('[BotDetector] Unhandled promise rejection:', e.reason);
    });

    console.log('[BotDetector] static-detector.js loaded');

    const shared = window.BotDetectorShared;

    /**
     * Run all static detection tests
     */
    async function runStaticDetection() {
        console.log('[BotDetector] Starting static detection tests...');
        const results = {};
        const errors = {};

        // Helper to run test with error catching
        function runTest(name, testFn) {
            try {
                console.log(`[BotDetector] Running test: ${name}`);
                const result = testFn();
                console.log(`[BotDetector] Test ${name} completed:`, result);
                return result;
            } catch (e) {
                console.error(`[BotDetector] Test ${name} failed:`, e);
                errors[name] = e.message;
                return { error: e.message, description: `Test failed: ${e.message}` };
            }
        }

        // Helper to run async test with error catching
        async function runAsyncTest(name, testFn) {
            try {
                console.log(`[BotDetector] Running async test: ${name}`);
                const result = await testFn();
                console.log(`[BotDetector] Async test ${name} completed:`, result);
                return result;
            } catch (e) {
                console.error(`[BotDetector] Async test ${name} failed:`, e);
                errors[name] = e.message;
                return { error: e.message, description: `Test failed: ${e.message}` };
            }
        }

        // Sync tests
        results.hasBotUserAgent = runTest('hasBotUserAgent', () => shared.checkBotUserAgent());
        results.hasWebdriverTrue = runTest('hasWebdriverTrue', () => shared.checkWebdriver());
        results.hasWebdriverInFrameTrue = runTest('hasWebdriverInFrameTrue', () => shared.checkWebdriverInFrame());
        results.isPlaywright = runTest('isPlaywright', () => shared.checkPlaywright());
        results.hasInconsistentChromeObject = runTest('hasInconsistentChromeObject', () => shared.checkInconsistentChrome());
        results.isPhantom = runTest('isPhantom', () => shared.checkPhantomJS());
        results.isNightmare = runTest('isNightmare', () => shared.checkNightmare());
        results.isSequentum = runTest('isSequentum', () => shared.checkSequentum());
        results.isSeleniumChromeDefault = runTest('isSeleniumChromeDefault', () => shared.checkSeleniumChromeDefault());
        results.isHeadlessChrome = runTest('isHeadlessChrome', () => shared.checkHeadlessChrome());
        results.isWebGLInconsistent = runTest('isWebGLInconsistent', () => shared.checkWebGLInconsistent());
        results.isAutomatedWithCDP = runTest('isAutomatedWithCDP', () => shared.checkAutomatedWithCDP());
        results.hasInconsistentClientHints = runTest('hasInconsistentClientHints', () => shared.checkInconsistentClientHints());
        results.hasInconsistentGPUFeatures = runTest('hasInconsistentGPUFeatures', () => shared.checkInconsistentGPUFeatures());
        results.isIframeOverridden = runTest('isIframeOverridden', () => shared.checkIframeOverridden());
        results.hasHighHardwareConcurrency = runTest('hasHighHardwareConcurrency', () => shared.checkHighHardwareConcurrency());
        results.hasHeadlessChromeDefaultScreenResolution = runTest('hasHeadlessChromeDefaultScreenResolution', () => shared.checkHeadlessResolution());

        // Async tests
        results.hasInconsistentWorkerValues = await runAsyncTest('hasInconsistentWorkerValues', () => shared.checkInconsistentWorkerValues());
        results.isAutomatedWithCDPInWebWorker = await runAsyncTest('isAutomatedWithCDPInWebWorker', () => shared.checkAutomatedWithCDPInWorker());
        results.hasSuspiciousWeakSignals = runTest('hasSuspiciousWeakSignals', () => shared.analyzeWeakSignals());

        // New tests from device_info.min.js analysis
        results.isAutomatedViaStackTrace = runTest('isAutomatedViaStackTrace', () => shared.checkCDPViaStackTrace());
        results.hasCanvasFingerprintIssue = runTest('hasCanvasFingerprintIssue', () => shared.checkCanvasFingerprint());
        results.hasAudioFingerprintIssue = await runAsyncTest('hasAudioFingerprintIssue', () => shared.checkAudioFingerprint());

        // Log summary
        console.log('[BotDetector] All tests completed');
        console.log('[BotDetector] Results:', results);
        if (Object.keys(errors).length > 0) {
            console.error('[BotDetector] Errors encountered:', errors);
        }

        // Add debug info to results
        results._debug = {
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            errors: errors,
            testCount: Object.keys(results).length - 1 // excluding _debug
        };

        return results;
    }

    /**
     * Display results in the container
     */
    function displayResults(results, container) {
        console.log('[BotDetector] displayResults called with', Object.keys(results).length, 'results');
        container.innerHTML = '';

        const resultsGrid = document.createElement('div');
        resultsGrid.className = 'results-grid';

        // Add all result items
        const resultItems = [
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
            { label: 'hasHighHardwareConcurrency', value: results.hasHighHardwareConcurrency !== false, details: results.hasHighHardwareConcurrency },
            { label: 'hasHeadlessChromeDefaultScreenResolution', value: results.hasHeadlessChromeDefaultScreenResolution !== false, details: results.hasHeadlessChromeDefaultScreenResolution },
            { label: 'hasSuspiciousWeakSignals', value: results.hasSuspiciousWeakSignals !== false, details: results.hasSuspiciousWeakSignals },
            { label: 'isAutomatedViaStackTrace', value: results.isAutomatedViaStackTrace !== false, details: results.isAutomatedViaStackTrace, showLikelySource: true },
            { label: 'hasCanvasFingerprintIssue', value: results.hasCanvasFingerprintIssue !== false, details: results.hasCanvasFingerprintIssue },
            { label: 'hasAudioFingerprintIssue', value: results.hasAudioFingerprintIssue !== false, details: results.hasAudioFingerprintIssue },
        ];

        let processedCount = 0;
        for (const item of resultItems) {
            try {
                const isBoolean = typeof item.value === 'boolean';
                const hasDetails = item.details !== undefined && item.details !== false;
                console.log(`[BotDetector] Processing ${item.label}: value=${item.value}, isBoolean=${isBoolean}, hasDetails=${hasDetails}`);
                const element = shared.createResultElement(
                    item.label,
                    item.value,
                    isBoolean,
                    hasDetails ? item.details : null,
                    item.showLikelySource
                );
                resultsGrid.appendChild(element);
                processedCount++;
            } catch (e) {
                console.error(`[BotDetector] Error processing result item ${item.label}:`, e);
            }
        }
        console.log(`[BotDetector] Processed ${processedCount}/${resultItems.length} result items`);

        container.appendChild(resultsGrid);

        // Update overall status
        updateOverallStatus(results);
    }

    /**
     * Update overall bot/human status
     */
    function updateOverallStatus(results) {
        const statusContainer = document.getElementById('overall-status');
        if (!statusContainer) return;

        // Count positive detections
        let botIndicators = 0;
        const criticalTests = [
            'hasWebdriverTrue',
            'hasWebdriverInFrameTrue',
            'isPlaywright',
            'isPhantom',
            'isSeleniumChromeDefault'
        ];

        for (const test of criticalTests) {
            if (results[test] === true) {
                botIndicators++;
            }
        }

        // Check array/object results (tests that return objects when failed)
        if (results.isHeadlessChrome && results.isHeadlessChrome.indicators) botIndicators++;
        if (results.isWebGLInconsistent) botIndicators++;
        if (results.isAutomatedWithCDP) botIndicators++;
        if (results.hasInconsistentWorkerValues) botIndicators++;
        if (results.hasInconsistentGPUFeatures) botIndicators++;
        if (results.hasInconsistentClientHints) botIndicators++;
        if (results.isIframeOverridden) botIndicators++;
        if (results.hasHighHardwareConcurrency) botIndicators++;
        if (results.hasHeadlessChromeDefaultScreenResolution) botIndicators++;
        if (results.hasSuspiciousWeakSignals) botIndicators++;
        // isAutomatedViaStackTrace: only count clear automation signals
        if (results.isAutomatedViaStackTrace) {
            const source = results.isAutomatedViaStackTrace.likelySource;
            if (source === 'automation') {
                botIndicators++; // Clear automation signal
                console.log('[BotDetector] isAutomatedViaStackTrace: automation detected');
            } else if (source === 'browser-extension' || source === 'dynamic-script') {
                // Suspicious but not definitive
                console.log(`[BotDetector] isAutomatedViaStackTrace: ${source} detected (suspicious)`);
            } else {
                // browser-internal, native-code, browser-devtools, unknown - don't count
                console.log(`[BotDetector] isAutomatedViaStackTrace: ${source} detected (not counting as bot)`);
            }
        }
        if (results.hasCanvasFingerprintIssue) botIndicators++;
        if (results.hasAudioFingerprintIssue) botIndicators++;

        let statusClass, statusText;
        if (botIndicators >= 2) {
            statusClass = 'bot';
            statusText = `BOT DETECTED (${botIndicators} indicators)`;
        } else if (botIndicators === 1) {
            statusClass = 'pending';
            statusText = `SUSPICIOUS (${botIndicators} indicator)`;
        } else {
            statusClass = 'human';
            statusText = 'HUMAN (0 indicators)';
        }

        statusContainer.innerHTML = `<span class="status-badge ${statusClass}">${statusText}</span>`;
    }

    /**
     * Initialize and run detection
     */
    async function init() {
        console.log('[BotDetector] Initializing...');
        const resultsContainer = document.getElementById('static-results');
        if (!resultsContainer) {
            console.error('[BotDetector] No results container found!');
            return;
        }

        console.log('[BotDetector] Results container found, showing loading...');
        shared.showLoading(resultsContainer);

        // Small delay to let page render
        await new Promise(r => setTimeout(r, 100));

        console.log('[BotDetector] Running detection...');
        let results;
        try {
            results = await runStaticDetection();
            console.log('[BotDetector] Detection complete, displaying results...');
        } catch (e) {
            console.error('[BotDetector] Fatal error during detection:', e);
            results = { _fatalError: e.message };
        }

        try {
            displayResults(results, resultsContainer);
            console.log('[BotDetector] Results displayed');
        } catch (e) {
            console.error('[BotDetector] Error displaying results:', e);
            resultsContainer.innerHTML = `<div class="error">Error displaying results: ${e.message}</div>`;
        }

        // Store results globally for test mode access
        window.lastStaticResults = results;
        console.log('[BotDetector] Results stored in window.lastStaticResults');
    }

    /**
     * Simulate bot signatures for testing
     */
    function simulateBotMode() {
        // Override navigator properties to simulate bot
        const originalWebdriver = navigator.webdriver;
        const originalUA = navigator.userAgent;

        // Create temporary overrides
        Object.defineProperty(navigator, 'webdriver', {
            get: () => true,
            configurable: true
        });

        // Add Selenium marker
        window.$cdc_asdjflasutopfhvcZLmcfl_ = {};

        // Re-run detection
        init();

        // Cleanup after detection
        setTimeout(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => originalWebdriver,
                configurable: true
            });
            delete window.$cdc_asdjflasutopfhvcZLmcfl_;
        }, 500);
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose functions
    window.StaticDetector = {
        run: init,
        simulateBot: simulateBotMode
    };

})();
