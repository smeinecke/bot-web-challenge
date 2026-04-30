/**
 * Bot Detection Challenge - Static Fingerprinting Detector
 * Runs all static detection tests and displays results
 */

(function() {
    'use strict';

    const shared = window.BotDetectorShared;

    /**
     * Run all static detection tests
     */
    async function runStaticDetection() {
        const results = {};
        const log = (name, value) => {
            const display = value === false || value === null || value === undefined
                ? 'PASS'
                : (value === true ? 'FAIL' : `FAIL — ${value.description || value.reason || JSON.stringify(value).slice(0, 80)}`);
            console.log(`[${name}] ${display}`);
        };

        function runTest(name, testFn) {
            try {
                const r = testFn();
                log(name, r);
                return r;
            } catch (e) {
                console.error(`[${name}] ERROR: ${e.message}`);
                return false;
            }
        }

        async function runAsyncTest(name, testFn) {
            try {
                const r = await testFn();
                log(name, r);
                return r;
            } catch (e) {
                console.error(`[${name}] ERROR: ${e.message}`);
                return false;
            }
        }

        console.log(`[BotDetector] Starting detection — ${navigator.userAgent.slice(0, 80)}`);

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
        results.hasMissingBrowserChrome = runTest('hasMissingBrowserChrome', () => shared.checkMissingBrowserChrome());
        results.hasScreenAvailabilityAnomaly = runTest('hasScreenAvailabilityAnomaly', () => shared.checkScreenAvailability());
        results.hasTouchInconsistency = runTest('hasTouchInconsistency', () => shared.checkTouchInconsistency());
        results.hasNavigatorIntegrityViolation = runTest('hasNavigatorIntegrityViolation', () => shared.checkNavigatorIntegrity());

        // Async tests (worker runs once; both checks share the same worker result)
        results.hasInconsistentWorkerValues = await runAsyncTest('hasInconsistentWorkerValues', () => shared.checkInconsistentWorkerValues());
        results.isAutomatedWithCDPInWebWorker = await runAsyncTest('isAutomatedWithCDPInWebWorker', () => shared.checkAutomatedWithCDPInWorker());
        results.hasBlobIframeCDPIssue = await runAsyncTest('hasBlobIframeCDPIssue', () => shared.checkBlobIframeCDP());

        results.hasSuspiciousWeakSignals = runTest('hasSuspiciousWeakSignals', () => shared.analyzeWeakSignals());
        results.isAutomatedViaStackTrace = runTest('isAutomatedViaStackTrace', () => shared.checkCDPViaStackTrace());
        results.hasCanvasAvailabilityIssue = runTest('hasCanvasAvailabilityIssue', () => shared.checkCanvasAvailability());
        results.hasAudioFingerprintIssue = await runAsyncTest('hasAudioFingerprintIssue', () => shared.checkAudioFingerprint());
        results.hasPermissionsInconsistency = await runAsyncTest('hasPermissionsInconsistency', () => shared.checkPermissionsConsistency());
        results.hasPluginsMimeTypesIssue = runTest('hasPluginsMimeTypesIssue', () => shared.checkPluginsMimeTypes());
        results.hasLocaleTimezoneIntlIssue = runTest('hasLocaleTimezoneIntlIssue', () => shared.checkLocaleTimezoneIntl());
        results.hasViewportScreenCoherenceIssue = runTest('hasViewportScreenCoherenceIssue', () => shared.checkViewportScreenCoherence());
        results.hasAutomationGlobalsExtended = runTest('hasAutomationGlobalsExtended', () => shared.checkAutomationGlobalsExtended());

        results._debug = {
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            testCount: Object.keys(results).length - 1
        };

        console.log(`[BotDetector] Detection complete — ${results._debug.testCount} tests run`);
        return results;
    }

    /**
     * Display results in the container
     */
    function displayResults(results, container) {
        container.innerHTML = '';

        const resultsGrid = document.createElement('div');
        resultsGrid.className = 'results-grid';

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
            { label: 'isHeadlessChrome', value: results.isHeadlessChrome, details: results.isHeadlessChrome },
            { label: 'isWebGLInconsistent', value: results.isWebGLInconsistent, details: results.isWebGLInconsistent },
            { label: 'isAutomatedWithCDP', value: results.isAutomatedWithCDP },
            { label: 'isAutomatedWithCDPInWebWorker', value: results.isAutomatedWithCDPInWebWorker },
            { label: 'hasInconsistentClientHints', value: results.hasInconsistentClientHints, details: results.hasInconsistentClientHints },
            { label: 'hasInconsistentGPUFeatures', value: results.hasInconsistentGPUFeatures, details: results.hasInconsistentGPUFeatures },
            { label: 'isIframeOverridden', value: results.isIframeOverridden, details: results.isIframeOverridden },
            { label: 'hasInconsistentWorkerValues', value: results.hasInconsistentWorkerValues, details: results.hasInconsistentWorkerValues },
            { label: 'hasBlobIframeCDPIssue', value: results.hasBlobIframeCDPIssue, details: results.hasBlobIframeCDPIssue },
            { label: 'hasHighHardwareConcurrency', value: results.hasHighHardwareConcurrency, details: results.hasHighHardwareConcurrency },
            { label: 'hasHeadlessChromeDefaultScreenResolution', value: results.hasHeadlessChromeDefaultScreenResolution, details: results.hasHeadlessChromeDefaultScreenResolution },
            { label: 'hasMissingBrowserChrome', value: results.hasMissingBrowserChrome, details: results.hasMissingBrowserChrome },
            { label: 'hasScreenAvailabilityAnomaly', value: results.hasScreenAvailabilityAnomaly, details: results.hasScreenAvailabilityAnomaly },
            { label: 'hasTouchInconsistency', value: results.hasTouchInconsistency, details: results.hasTouchInconsistency },
            { label: 'hasNavigatorIntegrityViolation', value: results.hasNavigatorIntegrityViolation, details: results.hasNavigatorIntegrityViolation },
            { label: 'hasSuspiciousWeakSignals', value: results.hasSuspiciousWeakSignals, details: results.hasSuspiciousWeakSignals },
            { label: 'isAutomatedViaStackTrace', value: results.isAutomatedViaStackTrace, details: results.isAutomatedViaStackTrace, showLikelySource: true },
            { label: 'hasCanvasAvailabilityIssue', value: results.hasCanvasAvailabilityIssue, details: results.hasCanvasAvailabilityIssue },
            { label: 'hasAudioFingerprintIssue', value: results.hasAudioFingerprintIssue, details: results.hasAudioFingerprintIssue },
            { label: 'hasPermissionsInconsistency', value: results.hasPermissionsInconsistency, details: results.hasPermissionsInconsistency },
            { label: 'hasPluginsMimeTypesIssue', value: results.hasPluginsMimeTypesIssue, details: results.hasPluginsMimeTypesIssue },
            { label: 'hasLocaleTimezoneIntlIssue', value: results.hasLocaleTimezoneIntlIssue, details: results.hasLocaleTimezoneIntlIssue },
            { label: 'hasViewportScreenCoherenceIssue', value: results.hasViewportScreenCoherenceIssue, details: results.hasViewportScreenCoherenceIssue },
            { label: 'hasAutomationGlobalsExtended', value: results.hasAutomationGlobalsExtended, details: results.hasAutomationGlobalsExtended },
        ];

        for (const item of resultItems) {
            const isBoolean = typeof item.value === 'boolean';
            const hasDetails = item.details !== undefined && item.details !== false;
            resultsGrid.appendChild(shared.createResultElement(
                item.label,
                item.value,
                isBoolean,
                hasDetails ? item.details : null,
                item.showLikelySource
            ));
        }

        container.appendChild(resultsGrid);
        updateOverallStatus(results);
    }

    /**
     * Update overall bot/human status using shared scoring
     */
    function updateOverallStatus(results) {
        const statusContainer = document.getElementById('overall-status');
        if (!statusContainer) return;

        const { uiStatus } = shared.summarizeResults(results);
        statusContainer.textContent = '';
        const badge = document.createElement('span');
        badge.className = `status-badge ${uiStatus.statusClass}`;
        badge.textContent = uiStatus.statusText;
        statusContainer.appendChild(badge);
    }

    /**
     * Initialize and run detection
     */
    async function init() {
        const resultsContainer = document.getElementById('static-results');
        if (!resultsContainer) return;

        shared.showLoading(resultsContainer);
        await new Promise(r => setTimeout(r, 100));

        let results;
        try {
            results = await runStaticDetection();
        } catch (e) {
            results = { _fatalError: e.message };
        }

        try {
            displayResults(results, resultsContainer);
        } catch (e) {
            resultsContainer.textContent = '';
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error';
            errorDiv.textContent = `Error displaying results: ${e.message}`;
            resultsContainer.appendChild(errorDiv);
        }

        window.lastStaticResults = results;
    }

    /**
     * Simulate bot signatures for testing
     */
    async function simulateBotMode() {
        const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');

        Object.defineProperty(navigator, 'webdriver', {
            get: () => true,
            configurable: true
        });
        window.$cdc_asdjflasutopfhvcZLmcfl_ = {};

        // Reset worker cache so simulation gets fresh worker results
        if (shared.resetWorkerTestsCache) {
            shared.resetWorkerTestsCache();
        }

        // Wait for the full detection run before restoring state
        await init();

        if (originalDescriptor) {
            Object.defineProperty(navigator, 'webdriver', originalDescriptor);
        } else {
            delete navigator.webdriver;
        }
        delete window.$cdc_asdjflasutopfhvcZLmcfl_;
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
