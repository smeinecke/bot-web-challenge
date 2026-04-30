/**
 * Static fingerprinting detector page
 */
import {
  checkBotUserAgent,
  checkWebdriver,
  checkWebdriverInFrame,
  checkPlaywright,
  checkInconsistentChrome,
  checkPhantomJS,
  checkNightmare,
  checkSequentum,
  checkSeleniumChromeDefault,
  checkHeadlessChrome,
  checkWebGLInconsistent,
  checkAutomatedWithCDP,
  checkInconsistentClientHints,
  checkInconsistentGPUFeatures,
  checkIframeOverridden,
  checkHighHardwareConcurrency,
  checkHeadlessResolution,
  checkMissingBrowserChrome,
  checkScreenAvailability,
  checkTouchInconsistency,
  checkNavigatorIntegrity,
  checkCanvasAvailability,
  checkAudioFingerprint,
  checkPermissionsConsistency,
  checkPluginsMimeTypes,
  checkLocaleTimezoneIntl,
  checkViewportScreenCoherence,
  checkAutomationGlobalsExtended,
  checkCDPViaStackTrace,
  analyzeWeakSignals,
  checkBlobIframeCDP,
  checkInconsistentWorkerValues,
  checkAutomatedWithCDPInWorker,
  resetWorkerTestsCache,
  summarizeResults,
  createResultElement,
  showLoading,
  prepareJSONOutput,
  setJSONTextContent,
  type DetectorResults,
  type RawDetectorValue,
} from '../shared';

/**
 * Run all static detection tests
 */
async function runStaticDetection(): Promise<DetectorResults> {
  const results: DetectorResults = {};

  const log = (name: string, value: unknown) => {
    const display = value === false || value === null || value === undefined
      ? 'PASS'
      : (value === true ? 'FAIL' : `FAIL — ${(value as { description?: string; reason?: string })?.description || (value as { reason?: string })?.reason || JSON.stringify(value).slice(0, 80)}`);
    console.log(`[${name}] ${display}`);
  };

  function runTest(name: string, testFn: () => RawDetectorValue): RawDetectorValue {
    try {
      const r = testFn();
      log(name, r);
      return r;
    } catch (e) {
      console.error(`[${name}] ERROR: ${(e as Error).message}`);
      return false;
    }
  }

  async function runAsyncTest(name: string, testFn: () => Promise<RawDetectorValue>): Promise<RawDetectorValue> {
    try {
      const r = await testFn();
      log(name, r);
      return r;
    } catch (e) {
      console.error(`[${name}] ERROR: ${(e as Error).message}`);
      return false;
    }
  }

  console.log(`[BotDetector] Starting detection — ${navigator.userAgent.slice(0, 80)}`);

  // Sync tests
  results.hasBotUserAgent = runTest('hasBotUserAgent', () => checkBotUserAgent());
  results.hasWebdriverTrue = runTest('hasWebdriverTrue', () => checkWebdriver());
  results.hasWebdriverInFrameTrue = runTest('hasWebdriverInFrameTrue', () => checkWebdriverInFrame());
  results.isPlaywright = runTest('isPlaywright', () => checkPlaywright());
  results.hasInconsistentChromeObject = runTest('hasInconsistentChromeObject', () => checkInconsistentChrome());
  results.isPhantom = runTest('isPhantom', () => checkPhantomJS());
  results.isNightmare = runTest('isNightmare', () => checkNightmare());
  results.isSequentum = runTest('isSequentum', () => checkSequentum());
  results.isSeleniumChromeDefault = runTest('isSeleniumChromeDefault', () => checkSeleniumChromeDefault());
  results.isHeadlessChrome = runTest('isHeadlessChrome', () => checkHeadlessChrome());
  results.isWebGLInconsistent = runTest('isWebGLInconsistent', () => checkWebGLInconsistent());
  results.isAutomatedWithCDP = runTest('isAutomatedWithCDP', () => checkAutomatedWithCDP());
  results.hasInconsistentClientHints = runTest('hasInconsistentClientHints', () => checkInconsistentClientHints());
  results.hasInconsistentGPUFeatures = runTest('hasInconsistentGPUFeatures', () => checkInconsistentGPUFeatures());
  results.isIframeOverridden = runTest('isIframeOverridden', () => checkIframeOverridden());
  results.hasHighHardwareConcurrency = runTest('hasHighHardwareConcurrency', () => checkHighHardwareConcurrency());
  results.hasHeadlessChromeDefaultScreenResolution = runTest('hasHeadlessChromeDefaultScreenResolution', () => checkHeadlessResolution());
  results.hasMissingBrowserChrome = runTest('hasMissingBrowserChrome', () => checkMissingBrowserChrome());
  results.hasScreenAvailabilityAnomaly = runTest('hasScreenAvailabilityAnomaly', () => checkScreenAvailability());
  results.hasTouchInconsistency = runTest('hasTouchInconsistency', () => checkTouchInconsistency());
  results.hasNavigatorIntegrityViolation = runTest('hasNavigatorIntegrityViolation', () => checkNavigatorIntegrity());

  // Async tests (worker runs once; both checks share the same worker result)
  results.hasInconsistentWorkerValues = await runAsyncTest('hasInconsistentWorkerValues', () => checkInconsistentWorkerValues());
  results.isAutomatedWithCDPInWebWorker = await runAsyncTest('isAutomatedWithCDPInWebWorker', () => checkAutomatedWithCDPInWorker());
  results.hasBlobIframeCDPIssue = await runAsyncTest('hasBlobIframeCDPIssue', () => checkBlobIframeCDP());

  results.hasSuspiciousWeakSignals = runTest('hasSuspiciousWeakSignals', () => analyzeWeakSignals());
  results.isAutomatedViaStackTrace = runTest('isAutomatedViaStackTrace', () => checkCDPViaStackTrace());
  results.hasCanvasAvailabilityIssue = runTest('hasCanvasAvailabilityIssue', () => checkCanvasAvailability());
  results.hasAudioFingerprintIssue = await runAsyncTest('hasAudioFingerprintIssue', () => checkAudioFingerprint());
  results.hasPermissionsInconsistency = await runAsyncTest('hasPermissionsInconsistency', () => checkPermissionsConsistency());
  results.hasPluginsMimeTypesIssue = runTest('hasPluginsMimeTypesIssue', () => checkPluginsMimeTypes());
  results.hasLocaleTimezoneIntlIssue = runTest('hasLocaleTimezoneIntlIssue', () => checkLocaleTimezoneIntl());
  results.hasViewportScreenCoherenceIssue = runTest('hasViewportScreenCoherenceIssue', () => checkViewportScreenCoherence());
  results.hasAutomationGlobalsExtended = runTest('hasAutomationGlobalsExtended', () => checkAutomationGlobalsExtended());

  (results as Record<string, unknown>)._debug = {
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    testCount: Object.keys(results).length - 1
  };

  console.log(`[BotDetector] Detection complete — ${(results as Record<string, { testCount?: number }>)._debug?.testCount} tests run`);
  return results;
}

/**
 * Display results in the container
 */
function displayResults(results: DetectorResults, container: HTMLElement): void {
  container.innerHTML = '';

  const resultsGrid = document.createElement('div');
  resultsGrid.className = 'results-grid';

  const { tests } = summarizeResults(results);

  const resultItems = Object.entries(tests).map(([name, result]) => ({
    label: name,
    value: result.value,
    isBoolean: typeof result.value === 'boolean',
    details: result.value,
  }));

  for (const item of resultItems) {
    const isBoolean = typeof item.value === 'boolean';
    const hasDetails = item.details !== undefined && item.details !== false && item.details !== null;
    resultsGrid.appendChild(createResultElement(
      item.label,
      item.value,
      isBoolean,
      hasDetails ? item.details : null,
      item.label === 'isAutomatedViaStackTrace'
    ));
  }

  container.appendChild(resultsGrid);
  updateOverallStatus(results);
}

/**
 * Update overall bot/human status
 */
function updateOverallStatus(results: DetectorResults): void {
  const statusContainer = document.getElementById('overall-status');
  if (!statusContainer) return;

  const { uiStatus } = summarizeResults(results);
  statusContainer.innerHTML = '';
  const badge = document.createElement('span');
  badge.className = `status-badge ${uiStatus.statusClass}`;
  badge.textContent = uiStatus.statusText;
  statusContainer.appendChild(badge);
}

/**
 * Initialize and run detection
 */
async function init(): Promise<void> {
  const resultsContainer = document.getElementById('static-results');
  if (!resultsContainer) return;

  showLoading(resultsContainer);
  await new Promise(r => setTimeout(r, 100));

  let results: DetectorResults;
  try {
    results = await runStaticDetection();
  } catch (e) {
    results = { _fatalError: (e as Error).message } as unknown as DetectorResults;
  }

  try {
    displayResults(results, resultsContainer);
  } catch (e) {
    resultsContainer.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = `Error displaying results: ${(e as Error).message}`;
    resultsContainer.appendChild(errorDiv);
  }

  // Expose for JSON export
  (window as unknown as Record<string, DetectorResults>).lastStaticResults = results;
}

/**
 * Simulate bot signatures for testing
 */
async function simulateBotMode(): Promise<void> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');

  Object.defineProperty(navigator, 'webdriver', {
    get: () => true,
    configurable: true
  });
  (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_ = {};

  // Reset worker cache so simulation gets fresh worker results
  resetWorkerTestsCache();

  // Wait for the full detection run before restoring state
  await init();

  if (originalDescriptor) {
    Object.defineProperty(navigator, 'webdriver', originalDescriptor);
  } else {
    delete ((navigator as unknown) as Record<string, unknown>).webdriver;
  }
  delete (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose functions for inline event handlers
(window as unknown as Record<string, unknown>).toggleBotMode = () => {
  const checkbox = document.getElementById('simulate-bot') as HTMLInputElement | null;
  if (checkbox?.checked) {
    simulateBotMode();
  } else {
    location.reload();
  }
};

(window as unknown as Record<string, unknown>).showJSONOutput = () => {
  const results = (window as unknown as Record<string, DetectorResults>).lastStaticResults;
  if (!results) {
    alert('Results not ready yet. Please wait a moment.');
    return;
  }

  let jsonDiv = document.getElementById('json-output');
  if (!jsonDiv) {
    jsonDiv = document.createElement('div');
    jsonDiv.id = 'json-output';
    jsonDiv.className = 'card';
    (jsonDiv as HTMLElement).style.marginTop = '1rem';
    const container = document.querySelector('.container');
    container?.appendChild(jsonDiv);
  }

  const cleanResults = prepareJSONOutput(results);
  jsonDiv.innerHTML = `
    <h3>JSON Output (for FlareSolverr integration)</h3>
    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.75rem; max-height: 400px; overflow-y: auto;"><code></code></pre>
  `;
  const code = jsonDiv.querySelector('code');
  if (code) {
    setJSONTextContent(code as HTMLElement, cleanResults);
  }
  jsonDiv.scrollIntoView({ behavior: 'smooth' });
};

(window as unknown as Record<string, unknown>).copyJSON = () => {
  const results = (window as unknown as Record<string, DetectorResults>).lastStaticResults;
  if (!results) {
    alert('Results not ready yet.');
    return;
  }
  const cleanResults = prepareJSONOutput(results);
  navigator.clipboard.writeText(JSON.stringify(cleanResults, null, 2)).then(() => {
    alert('JSON copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
};

(window as unknown as Record<string, unknown>).StaticDetector = {
  run: init,
  simulateBot: simulateBotMode
};
