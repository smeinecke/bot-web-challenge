/**
 * Interactions detector page
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
  prepareJSONOutput,
  setJSONTextContent,
  type DetectorResults,
  type RawDetectorValue,
} from '../shared';

interface TrackingState {
  mouseEvents: Array<Record<string, unknown>>;
  keyEvents: Array<Record<string, unknown>>;
  formStartTime: number | null;
  firstFocusTime: number | null;
  lastActivityTime: number | null;
  submitTime: number | null;
  totalKeystrokes: number;
  mousePathLength: number;
  lastMousePos: { x: number; y: number } | null;
  cdpLeakChecks: Array<Record<string, unknown>>;
  hasUntrustedEvent: boolean;
  clicksAtExactCenter: number;
  clicksAtZero: number;
  suspiciousKeyEvents: number;
  keystrokeTimes: number[];
}

interface CDPCheckResult {
  suspicious: boolean;
  reason?: string;
  confidence?: string;
  description?: string;
  [key: string]: unknown;
}

const MAX_EVENTS = 500;

let tracking: TrackingState = {
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
  keystrokeTimes: [],
};

let _listenersAttached = false;

function resetTracking(): void {
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
    keystrokeTimes: [],
  };
}

function onMouseMove(e: MouseEvent): void {
  const now = Date.now();
  const pos = { x: e.clientX, y: e.clientY };

  const windowScreenX = typeof window.screenX !== 'undefined' ? window.screenX : window.screenLeft || 0;
  const windowScreenY = typeof window.screenY !== 'undefined' ? window.screenY : window.screenTop || 0;

  const looksLikeCDP = Math.abs(e.screenX - pos.x) < 5 && Math.abs(e.screenY - pos.y) < 5;
  const hasWindowOffset = windowScreenX !== 0 || windowScreenY !== 0;
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

  if (tracking.lastMousePos) {
    const dx = pos.x - tracking.lastMousePos.x;
    const dy = pos.y - tracking.lastMousePos.y;
    tracking.mousePathLength += Math.sqrt(dx * dx + dy * dy);
  }
  tracking.lastMousePos = pos;

  if (tracking.cdpLeakChecks.length < 100) {
    const ua = navigator.userAgent;
    const isFirefoxLinux = /firefox/i.test(ua) && /linux|x11/i.test(ua);

    const result: CDPCheckResult = { suspicious: false };
    if (!looksLikeCDP) {
      result.suspicious = false;
    } else if (isFirefoxLinux) {
      result.reason = 'screen_equals_client_in_firefox_linux';
      result.confidence = 'none';
      result.description = 'Firefox/Linux may report screen coordinates equal to client coordinates in normal browsing.';
    } else if (!hasWindowOffset) {
      result.reason = 'no_window_offset';
      result.confidence = 'none';
      result.description = 'screenX/screenY equal client coordinates, but no reliable window offset exists.';
    } else {
      result.suspicious = true;
      result.reason = 'screen_equals_client_with_window_offset';
      result.confidence = 'medium';
      result.description = 'MouseEvent screen coordinates equal client coordinates despite non-zero window offset.';
    }
    tracking.cdpLeakChecks.push(result);
  }

  tracking.lastActivityTime = now;
}

function onMouseDown(e: MouseEvent): void {
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

  if (e.clientX === 0 && e.clientY === 0) {
    tracking.clicksAtZero++;
  }

  if (e.target instanceof Element && e.target.getBoundingClientRect) {
    const rect = e.target.getBoundingClientRect();
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    if (Math.abs(e.clientX - cx) <= 1 && Math.abs(e.clientY - cy) <= 1) {
      tracking.clicksAtExactCenter++;
    }
  }
}

function onMouseUp(e: MouseEvent): void {
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

function onKeyDown(e: KeyboardEvent): void {
  if (!e.isTrusted) tracking.hasUntrustedEvent = true;

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

function onKeyUp(e: KeyboardEvent): void {
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

function onFormFocus(): void {
  if (!tracking.firstFocusTime) {
    tracking.firstFocusTime = Date.now();
  }
}

function onFormSubmit(e: Event): void {
  e.preventDefault();
  tracking.submitTime = Date.now();
  analyzeAndShowResults();

  // Show results card and scroll
  const resultsCard = document.getElementById('results-card');
  if (resultsCard) {
    resultsCard.style.display = 'block';
    setTimeout(() => {
      resultsCard.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }
}

function startTracking(): void {
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

function countStraightLines(): number {
  let straightCount = 0;
  const moveEvents = tracking.mouseEvents.filter(e => e.type === 'move');

  for (let i = 2; i < moveEvents.length; i++) {
    const p1 = moveEvents[i - 2] as { x: number; y: number };
    const p2 = moveEvents[i - 1] as { x: number; y: number };
    const p3 = moveEvents[i] as { x: number; y: number };

    const crossProduct = Math.abs((p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x));
    const distance = Math.sqrt(Math.pow(p3.x - p1.x, 2) + Math.pow(p3.y - p1.y, 2));
    const threshold = Math.max(50, distance * 0.1);
    if (crossProduct < threshold) {
      straightCount++;
    }
  }

  return straightCount;
}

function checkUniformTiming(events: Array<{ time: number }>): boolean {
  if (events.length < 10) return false;

  const intervals: number[] = [];
  for (let i = 1; i < events.length; i++) {
    intervals.push(events[i].time - events[i - 1].time);
  }

  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);

  return stdDev < 5;
}

function analyzeSuspiciousBehavior(): RawDetectorValue {
  const sessionDuration = tracking.formStartTime ? Date.now() - tracking.formStartTime : 0;
  const hasEnoughObservation =
    (tracking.submitTime && tracking.firstFocusTime && (tracking.submitTime - tracking.firstFocusTime) > 2000) ||
    tracking.totalKeystrokes > 5 ||
    tracking.mouseEvents.length > 20 ||
    sessionDuration > 3000;

  if (!hasEnoughObservation) {
    return {
      inconclusive: true,
      reason: 'insufficientObservationWindow',
      description: 'Not enough interaction data to analyze (keyboard-only, touch, autofill, or fast interaction)'
    };
  }

  const suspicious: string[] = [];

  if (tracking.mouseEvents.length < 10 && tracking.totalKeystrokes > 0) {
    suspicious.push('insufficientMouseMovement');
  }

  if (tracking.mouseEvents.length > 50) {
    const straightLines = countStraightLines();
    const moveEvents = tracking.mouseEvents.filter(e => e.type === 'move').length;
    if (moveEvents > 30 && straightLines > moveEvents * 0.95) {
      suspicious.push('tooManyStraightLines');
    }
  }

  if (tracking.mouseEvents.length > 20) {
    const uniformTiming = checkUniformTiming(tracking.mouseEvents as Array<{ time: number }>);
    if (uniformTiming) {
      suspicious.push('uniformEventTiming');
    }
  }

  const formDuration = tracking.submitTime && tracking.firstFocusTime ? tracking.submitTime - tracking.firstFocusTime : 0;
  if (tracking.firstFocusTime && tracking.submitTime && formDuration < 500) {
    suspicious.push('instantFormCompletion');
  }

  if (tracking.totalKeystrokes === 0 && tracking.submitTime && formDuration > 1000) {
    const emailField = document.getElementById('email') as HTMLInputElement | null;
    const passwordField = document.getElementById('password') as HTMLInputElement | null;
    if ((emailField?.value) || (passwordField?.value)) {
      suspicious.push('pasteOnlyInput');
    }
  }

  if (suspicious.length > 0) {
    const descriptions: Record<string, string> = {
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

function analyzeSuperHumanSpeed(): RawDetectorValue {
  if (!tracking.firstFocusTime || !tracking.submitTime) {
    return false;
  }

  const totalTime = tracking.submitTime - tracking.firstFocusTime;
  const keystrokes = tracking.totalKeystrokes;

  if (keystrokes === 0) return false;

  const cps = keystrokes / (totalTime / 1000);

  if (cps > 15) {
    return {
      charsPerSecond: cps.toFixed(1),
      totalTime,
      keystrokes,
      threshold: 15,
      description: `Typing speed ${cps.toFixed(1)} CPS exceeds human limit (15 CPS)`
    };
  }

  if (totalTime < 500 && keystrokes > 5) {
    return {
      charsPerSecond: cps.toFixed(1),
      totalTime,
      keystrokes,
      reason: 'tooFastCompletion',
      description: `Form completed in ${totalTime}ms - too fast for human input`
    };
  }

  return false;
}

function analyzeAdvancedInteractionSignals(): RawDetectorValue {
  const signals: Array<{ name: string; description: string }> = [];

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

  if (tracking.keystrokeTimes.length >= 5) {
    const intervals: number[] = [];
    for (let i = 1; i < tracking.keystrokeTimes.length; i++) {
      intervals.push(tracking.keystrokeTimes[i] - tracking.keystrokeTimes[i - 1]);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(intervals.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / intervals.length);

    if (stdDev < 10 && avg < 100) {
      signals.push({
        name: 'uniformKeystrokeTiming',
        description: `Keystroke intervals too regular (avg ${avg.toFixed(0)}ms, σ=${stdDev.toFixed(1)}ms) — bot-like typing`
      });
    }
  }

  if (signals.length === 0) return false;

  return {
    signals: signals.map(s => s.name),
    description: signals.map(s => s.description).join('; ')
  };
}

function analyzeCDPMouseLeak(): RawDetectorValue {
  if (tracking.mouseEvents.length < 20) {
    return false;
  }

  const suspiciousChecks = tracking.cdpLeakChecks.filter(result => (result as CDPCheckResult).suspicious === true);

  if (suspiciousChecks.length === 0) {
    return false;
  }

  const totalChecks = tracking.cdpLeakChecks.length;
  const ratio = suspiciousChecks.length / totalChecks;

  const windowScreenX = typeof window.screenX !== 'undefined' ? window.screenX : window.screenLeft || 0;
  const windowScreenY = typeof window.screenY !== 'undefined' ? window.screenY : window.screenTop || 0;

  if (ratio > 0.8 && totalChecks > 20) {
    return {
      cdpPatternRatio: ratio.toFixed(2),
      totalEvents: tracking.mouseEvents.filter(e => e.type === 'move').length,
      suspiciousChecks: suspiciousChecks.length,
      totalChecks,
      windowPosition: { x: windowScreenX, y: windowScreenY },
      reason: 'cdpScreenOffsetBug',
      confidence: 'medium',
      description: `${(ratio * 100).toFixed(0)}% events show CDP screen coordinate bug (screenX === clientX with window offset)`
    };
  }

  return false;
}

async function analyzeTrackingData(): Promise<DetectorResults> {
  const results: DetectorResults = {
    hasBotUserAgent: checkBotUserAgent(),
    hasWebdriverTrue: checkWebdriver(),
    hasWebdriverInFrameTrue: checkWebdriverInFrame(),
    isPlaywright: checkPlaywright(),
    isSeleniumChromeDefault: checkSeleniumChromeDefault(),
    isHeadlessChrome: checkHeadlessChrome(),
    isWebGLInconsistent: checkWebGLInconsistent(),
    isAutomatedWithCDP: checkAutomatedWithCDP(),
    hasInconsistentChromeObject: checkInconsistentChrome(),
    isPhantom: checkPhantomJS(),
    isNightmare: checkNightmare(),
    isSequentum: checkSequentum(),
    isIframeOverridden: checkIframeOverridden(),
    hasHighHardwareConcurrency: checkHighHardwareConcurrency(),
    hasHeadlessChromeDefaultScreenResolution: checkHeadlessResolution(),
    hasMissingBrowserChrome: checkMissingBrowserChrome(),
    hasScreenAvailabilityAnomaly: checkScreenAvailability(),
    hasTouchInconsistency: checkTouchInconsistency(),
    hasSuspiciousWeakSignals: analyzeWeakSignals(),
    isAutomatedViaStackTrace: checkCDPViaStackTrace(),
    hasCanvasAvailabilityIssue: checkCanvasAvailability(),
    hasInconsistentClientHints: checkInconsistentClientHints(),
    hasInconsistentGPUFeatures: checkInconsistentGPUFeatures(),
    hasInconsistentWorkerValues: await checkInconsistentWorkerValues(),
    isAutomatedWithCDPInWebWorker: await checkAutomatedWithCDPInWorker(),
    hasBlobIframeCDPIssue: await checkBlobIframeCDP(),
    hasAudioFingerprintIssue: await checkAudioFingerprint(),
    hasNavigatorIntegrityViolation: checkNavigatorIntegrity(),
    hasPermissionsInconsistency: await checkPermissionsConsistency(),
    hasPluginsMimeTypesIssue: checkPluginsMimeTypes(),
    hasLocaleTimezoneIntlIssue: checkLocaleTimezoneIntl(),
    hasViewportScreenCoherenceIssue: checkViewportScreenCoherence(),
    hasAutomationGlobalsExtended: checkAutomationGlobalsExtended(),
    suspiciousClientSideBehavior: analyzeSuspiciousBehavior(),
    superHumanSpeed: analyzeSuperHumanSpeed(),
    hasCDPMouseLeak: analyzeCDPMouseLeak(),
    hasAdvancedBotSignals: analyzeAdvancedInteractionSignals(),
  };

  return results;
}

function displayResults(results: DetectorResults, container: HTMLElement): void {
  container.innerHTML = '';

  const interactionSection = document.createElement('div');
  interactionSection.innerHTML = '<h3>Interaction Analysis</h3>';

  const resultsGrid = document.createElement('div');
  resultsGrid.className = 'results-grid';

  const { tests } = summarizeResults(results);

  const interactionTests = ['suspiciousClientSideBehavior', 'superHumanSpeed', 'hasCDPMouseLeak', 'hasAdvancedBotSignals'];

  for (const name of interactionTests) {
    const result = tests[name];
    if (result) {
      const isBoolean = typeof result.value === 'boolean';
      const hasDetails = result.value !== undefined && result.value !== false && result.value !== null;
      resultsGrid.appendChild(createResultElement(name, result.value, isBoolean, hasDetails ? result.value : null));
    }
  }

  interactionSection.appendChild(resultsGrid);
  container.appendChild(interactionSection);

  const staticSection = document.createElement('div');
  staticSection.innerHTML = '<h3>Static Fingerprinting</h3>';

  const staticGrid = document.createElement('div');
  staticGrid.className = 'results-grid';

  for (const [name, result] of Object.entries(tests)) {
    if (!interactionTests.includes(name)) {
      const isBoolean = typeof result.value === 'boolean';
      const hasDetails = result.value !== undefined && result.value !== false && result.value !== null;
      staticGrid.appendChild(createResultElement(
        name,
        result.value,
        isBoolean,
        hasDetails ? result.value : null,
        name === 'isAutomatedViaStackTrace'
      ));
    }
  }

  staticSection.appendChild(staticGrid);
  container.appendChild(staticSection);

  updateOverallStatus(results);
  addTrackingStats(container);
}

function addTrackingStats(container: HTMLElement): void {
  const statsDiv = document.createElement('div');
  statsDiv.className = 'info-section';
  const heading = document.createElement('h3');
  heading.textContent = 'Tracking Statistics';
  const ul = document.createElement('ul');
  const stats = [
    `Mouse events: ${tracking.mouseEvents.length}`,
    `Key events: ${tracking.keyEvents.length}`,
    `Mouse path length: ${Math.round(tracking.mousePathLength)} px`,
    `Total keystrokes: ${tracking.totalKeystrokes}`,
    `Form completion time: ${tracking.submitTime && tracking.firstFocusTime ?
      (tracking.submitTime - tracking.firstFocusTime) + ' ms' : 'N/A'}`
  ];
  stats.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
  });
  statsDiv.appendChild(heading);
  statsDiv.appendChild(ul);
  container.appendChild(statsDiv);
}

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

async function analyzeAndShowResults(): Promise<void> {
  const container = document.getElementById('interaction-results');
  if (container) {
    container.innerHTML = '<div class="loading"><span class="spinner"></span>Analyzing interactions...</div>';
  }

  setTimeout(async () => {
    const results = await analyzeTrackingData();
    if (container) {
      displayResults(results, container);
    }
    (window as unknown as Record<string, DetectorResults>).lastInteractionResults = results;
  }, 100);
}

async function simulateBotMode(): Promise<void> {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => true,
    configurable: true
  });
  (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_ = {};

  resetWorkerTestsCache();

  const emailField = document.getElementById('email') as HTMLInputElement | null;
  const passwordField = document.getElementById('password') as HTMLInputElement | null;

  if (emailField) {
    emailField.value = 'test@example.com';
    emailField.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (passwordField) {
    passwordField.value = 'password123';
    passwordField.dispatchEvent(new Event('input', { bubbles: true }));
  }

  tracking.totalKeystrokes = 25;
  tracking.firstFocusTime = Date.now() - 200;
  tracking.submitTime = Date.now();

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
  tracking.hasUntrustedEvent = true;
  tracking.clicksAtZero = 1;
  tracking.clicksAtExactCenter = 3;
  tracking.mouseEvents.push({ type: 'down', x: 0, y: 0, isTrusted: false, time: now } as Record<string, unknown>);
  tracking.mouseEvents.push({ type: 'down', x: 0, y: 0, isTrusted: false, time: now + 1 } as Record<string, unknown>);
  tracking.mouseEvents.push({ type: 'down', x: 0, y: 0, isTrusted: false, time: now + 2 } as Record<string, unknown>);

  analyzeAndShowResults();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startTracking);
} else {
  startTracking();
}

// Expose functions for inline event handlers
(window as unknown as Record<string, unknown>).toggleBotMode = () => {
  const checkbox = document.getElementById('simulate-bot') as HTMLInputElement | null;
  if (checkbox?.checked) {
    simulateBotMode();
  } else {
    resetTracking();
    const container = document.getElementById('interaction-results');
    if (container) container.innerHTML = '';
    (window as unknown as Record<string, DetectorResults | null>).lastInteractionResults = null;
    const resultsCard = document.getElementById('results-card');
    if (resultsCard) resultsCard.style.display = 'none';
  }
};

(window as unknown as Record<string, () => void>).showJSONOutput = () => {
  const results = (window as unknown as Record<string, DetectorResults>).lastInteractionResults;
  if (!results) {
    alert('Please submit the form first to generate results.');
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

  const cleanResults = prepareJSONOutput(results, {
    mouseEvents: tracking.mouseEvents.length,
    keyEvents: tracking.keyEvents.length,
    mousePathLength: Math.round(tracking.mousePathLength),
    totalKeystrokes: tracking.totalKeystrokes,
    formCompletionTime: tracking.submitTime && tracking.firstFocusTime ?
      tracking.submitTime - tracking.firstFocusTime : null
  });
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

(window as unknown as Record<string, () => void>).copyJSON = () => {
  const results = (window as unknown as Record<string, DetectorResults>).lastInteractionResults;
  if (!results) {
    alert('Please submit the form first.');
    return;
  }
  const cleanResults = prepareJSONOutput(results, {
    mouseEvents: tracking.mouseEvents.length,
    keyEvents: tracking.keyEvents.length,
    mousePathLength: Math.round(tracking.mousePathLength),
    totalKeystrokes: tracking.totalKeystrokes,
    formCompletionTime: tracking.submitTime && tracking.firstFocusTime ?
      tracking.submitTime - tracking.firstFocusTime : null
  });
  navigator.clipboard.writeText(JSON.stringify(cleanResults, null, 2)).then(() => {
    alert('JSON copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
};

(window as unknown as Record<string, unknown>).InteractionDetector = {
  start: startTracking,
  reset: resetTracking,
  analyze: analyzeAndShowResults,
  simulateBot: simulateBotMode,
  getTrackingData: () => tracking
};
