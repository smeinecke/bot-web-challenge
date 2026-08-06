/**
 * Interaction analysis for the interaction page.
 *
 * This module tracks mouse, keyboard, and input events and runs detectors that
 * analyze them. It never stores actual keyboard characters, input values,
 * passwords, clipboard contents, KeyboardEvent.key, or KeyboardEvent.code.
 * Only timing, event-integrity flags, and structural observations are kept.
 */
import { finding, inconclusive, pass, type DetectionResult } from './detector-types';

export interface TrackingState {
  mouseEvents: Array<Record<string, unknown>>;
  keyEvents: Array<Record<string, unknown>>;
  inputEvents: Array<Record<string, unknown>>;
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
  hasTrustedInput: boolean;
  hasTrustedFocus: boolean;
  hasTrustedChange: boolean;
}

export interface CDPCheckResult {
  suspicious: boolean;
  reason?: string;
  confidence?: string;
  description?: string;
  [key: string]: unknown;
}

const MAX_EVENTS = 500;

export let tracking: TrackingState = createTrackingState();

let _listenersAttached = false;

export function createTrackingState(): TrackingState {
  return {
    mouseEvents: [],
    keyEvents: [],
    inputEvents: [],
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
    hasTrustedInput: false,
    hasTrustedFocus: false,
    hasTrustedChange: false,
  };
}

export function resetTracking(): void {
  tracking = createTrackingState();
}

function isEmailOrPasswordInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLInputElement)) return false;
  return target.type === 'email' || target.type === 'password' || target.id === 'email' || target.id === 'password';
}

export function onMouseMove(e: MouseEvent): void {
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
      screenMismatch,
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

export function onMouseDown(e: MouseEvent): void {
  if (!e.isTrusted) tracking.hasUntrustedEvent = true;

  if (tracking.mouseEvents.length < MAX_EVENTS) {
    tracking.mouseEvents.push({
      type: 'down',
      x: e.clientX,
      y: e.clientY,
      button: e.button,
      time: Date.now(),
      isTrusted: e.isTrusted,
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

export function onMouseUp(e: MouseEvent): void {
  if (!e.isTrusted) tracking.hasUntrustedEvent = true;
  if (tracking.mouseEvents.length < MAX_EVENTS) {
    tracking.mouseEvents.push({
      type: 'up',
      x: e.clientX,
      y: e.clientY,
      button: e.button,
      time: Date.now(),
      isTrusted: e.isTrusted,
    });
  }
}

export function onKeyDown(e: KeyboardEvent): void {
  if (!e.isTrusted) tracking.hasUntrustedEvent = true;

  if (e.code === '' && e.key === '' && e.keyCode > 0) {
    tracking.suspiciousKeyEvents++;
  }

  if (tracking.keyEvents.length < MAX_EVENTS) {
    tracking.keyEvents.push({
      type: 'down',
      time: Date.now(),
      isTrusted: e.isTrusted,
      // Deliberately not storing key, code, or keyCode.
      hasKeyCode: e.keyCode > 0,
    });
  }
  tracking.keystrokeTimes.push(Date.now());
  tracking.totalKeystrokes++;
  tracking.lastActivityTime = Date.now();
}

export function onKeyUp(e: KeyboardEvent): void {
  if (!e.isTrusted) tracking.hasUntrustedEvent = true;
  if (tracking.keyEvents.length < MAX_EVENTS) {
    tracking.keyEvents.push({
      type: 'up',
      time: Date.now(),
      isTrusted: e.isTrusted,
      hasKeyCode: e.keyCode > 0,
    });
  }
  tracking.lastActivityTime = Date.now();
}

export function onFormInput(e: InputEvent): void {
  if (!e.isTrusted) {
    tracking.hasUntrustedEvent = true;
    return;
  }
  if (isEmailOrPasswordInput(e.target)) {
    tracking.hasTrustedInput = true;
  }
  if (tracking.inputEvents.length < MAX_EVENTS) {
    tracking.inputEvents.push({
      type: 'input',
      time: Date.now(),
      isTrusted: e.isTrusted,
      inputType: e.inputType,
      // Deliberately not storing data (actual characters).
    });
  }
  tracking.lastActivityTime = Date.now();
}

export function onFormFocus(): void {
  tracking.hasTrustedFocus = true;
  if (!tracking.firstFocusTime) {
    tracking.firstFocusTime = Date.now();
  }
}

export function onFormChange(e: Event): void {
  if (e.isTrusted) {
    tracking.hasTrustedChange = true;
  }
}

export function startTracking(): void {
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
    form.addEventListener('input', onFormInput as EventListener, { passive: true });
    form.addEventListener('change', onFormChange, { passive: true });
  }
}

export function stopTracking(): void {
  if (!_listenersAttached) return;
  _listenersAttached = false;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);

  const form = document.getElementById('login-form');
  if (form) {
    form.removeEventListener('focusin', onFormFocus);
    form.removeEventListener('input', onFormInput as EventListener);
    form.removeEventListener('change', onFormChange);
  }
}

export function areFieldsPopulated(): boolean {
  const emailField = document.getElementById('email') as HTMLInputElement | null;
  const passwordField = document.getElementById('password') as HTMLInputElement | null;
  return Boolean((emailField?.value && emailField.value.length > 0) || (passwordField?.value && passwordField.value.length > 0));
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

export function analyzeInsufficientObservationWindow(): DetectionResult {
  const sessionDuration = tracking.formStartTime ? Date.now() - tracking.formStartTime : 0;

  const hasEnoughObservation =
    (tracking.submitTime && tracking.firstFocusTime && (tracking.submitTime - tracking.firstFocusTime) > 2000) ||
    tracking.totalKeystrokes > 5 ||
    tracking.mouseEvents.length > 20 ||
    sessionDuration > 3000;

  if (!hasEnoughObservation) {
    return inconclusive(
      'interaction',
      'insufficient-observation-window',
      'interaction',
      'insufficient-observation-window',
      'Not enough interaction data to analyze (keyboard-only, touch, autofill, or fast interaction)',
      {
        sessionDuration,
        keystrokes: tracking.totalKeystrokes,
        mouseEvents: tracking.mouseEvents.length,
      }
    );
  }

  return pass(
    'interaction',
    'insufficient-observation-window',
    'interaction',
    'sufficient-observation',
    'Interaction observation window is sufficient for analysis'
  );
}

export function analyzeLowObservationSubmission(): DetectionResult[] {
  const results: DetectionResult[] = [];

  if (!tracking.submitTime || tracking.formStartTime === null) {
    return results;
  }

  const sessionDuration = tracking.submitTime - tracking.formStartTime;
  const formDuration = tracking.firstFocusTime && tracking.submitTime
    ? tracking.submitTime - tracking.firstFocusTime
    : 0;

  const populated = areFieldsPopulated();
  const hasTrustedSequence = tracking.hasTrustedFocus && tracking.hasTrustedInput;
  const hasUntrustedInput = tracking.inputEvents.some(e => e.isTrusted === false);
  const noPointerActivity = tracking.mouseEvents.length === 0;
  const instantSubmit = tracking.firstFocusTime ? formDuration < 200 : false;

  const autofillLike =
    populated &&
    tracking.hasTrustedFocus &&
    tracking.hasTrustedInput &&
    formDuration >= 1000 &&
    tracking.totalKeystrokes === 0 &&
    tracking.inputEvents.some(e => e.inputType === 'insertReplacementText');

  if (autofillLike) {
    results.push(
      pass(
        'interaction',
        'low-observation-submission',
        'interaction',
        'autofill-like',
        'Submission pattern is consistent with ordinary browser autofill'
      )
    );
    return results;
  }

  const signals: string[] = [];
  let score = 0;

  if (populated && !hasTrustedSequence) {
    signals.push('populatedWithoutTrustedSequence');
    score += 3;
  }

  if (instantSubmit && tracking.totalKeystrokes === 0) {
    signals.push('instantSubmitNoKeystrokes');
    score += 2;
  }

  if (populated && !tracking.hasTrustedFocus) {
    signals.push('noFocusHistory');
    score += 2;
  }

  if (hasUntrustedInput) {
    signals.push('untrustedInputEvent');
    score += 2;
  }

  if (populated && tracking.totalKeystrokes === 0 && !tracking.hasTrustedInput) {
    signals.push('directValueAssignmentPattern');
    score += 2;
  }

  if (noPointerActivity && sessionDuration < 1000 && populated) {
    signals.push('noPointerActivityShortSession');
    score += 1;
  }

  if (tracking.hasUntrustedEvent && populated) {
    signals.push('syntheticEventWithPopulatedFields');
    score += 1;
  }

  if (score >= 5) {
    results.push(
      finding(
        'medium',
        'interaction',
        'low-observation-submission',
        'interaction',
        'low-observation-scripted',
        `Low-observation submission with ${signals.length} corroborating anomalies`,
        { signals, score, formDuration, sessionDuration }
      )
    );
  } else if (score >= 2) {
    results.push(
      finding(
        'weak',
        'interaction',
        'low-observation-submission',
        'interaction',
        'low-observation-suspicious',
        `Low-observation submission with ${signals.length} suspicious signals`,
        { signals, score, formDuration, sessionDuration }
      )
    );
  } else {
    results.push(
      pass(
        'interaction',
        'low-observation-submission',
        'interaction',
        'no-low-observation-anomaly',
        'No low-observation scripted submission pattern detected'
      )
    );
  }

  return results;
}

export function analyzeSuspiciousClientSideBehavior(): DetectionResult {
  const sessionDuration = tracking.formStartTime ? Date.now() - tracking.formStartTime : 0;
  const hasEnoughObservation =
    (tracking.submitTime && tracking.firstFocusTime && (tracking.submitTime - tracking.firstFocusTime) > 2000) ||
    tracking.totalKeystrokes > 5 ||
    tracking.mouseEvents.length > 20 ||
    sessionDuration > 3000;

  if (!hasEnoughObservation) {
    // This is now handled by the dedicated insufficient-observation detector.
    return pass(
      'interaction',
      'suspicious-client-side-behavior',
      'interaction',
      'insufficient-observation',
      'Waiting for more interaction data'
    );
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
    if (areFieldsPopulated() && !tracking.hasTrustedInput) {
      suspicious.push('noInputSequence');
    }
  }

  if (suspicious.length > 0) {
    return finding(
      'weak',
      'interaction',
      'suspicious-client-side-behavior',
      'interaction',
      'suspicious-client-side-patterns',
      `Suspicious client-side behavior: ${suspicious.join(', ')}`,
      { behaviors: suspicious }
    );
  }

  return pass(
    'interaction',
    'suspicious-client-side-behavior',
    'interaction',
    'no-suspicious-behavior',
    'No suspicious client-side behavior detected'
  );
}

export function analyzeSuperHumanSpeed(): DetectionResult {
  if (!tracking.firstFocusTime || !tracking.submitTime) {
    return pass(
      'interaction',
      'super-human-speed',
      'interaction',
      'no-submit',
      'Form not submitted yet'
    );
  }

  const totalTime = tracking.submitTime - tracking.firstFocusTime;
  const keystrokes = tracking.totalKeystrokes;

  if (keystrokes === 0) {
    return pass(
      'interaction',
      'super-human-speed',
      'interaction',
      'no-keystrokes',
      'No keystrokes to measure'
    );
  }

  const cps = keystrokes / (totalTime / 1000);

  if (cps > 15) {
    return finding(
      'strong',
      'interaction',
      'super-human-speed',
      'interaction',
      'super-human-typing',
      `Typing speed ${cps.toFixed(1)} CPS exceeds human limit (15 CPS)`,
      { charsPerSecond: cps.toFixed(1), totalTime, keystrokes, threshold: 15 }
    );
  }

  if (totalTime < 500 && keystrokes > 5) {
    return finding(
      'medium',
      'interaction',
      'super-human-speed',
      'interaction',
      'too-fast-completion',
      `Form completed in ${totalTime}ms - too fast for human input`,
      { charsPerSecond: cps.toFixed(1), totalTime, keystrokes }
    );
  }

  return pass(
    'interaction',
    'super-human-speed',
    'interaction',
    'normal-typing-speed',
    'Typing speed is within human range'
  );
}

export function analyzeAdvancedInteractionSignals(): DetectionResult {
  const signals: string[] = [];

  if (tracking.hasUntrustedEvent) {
    signals.push('untrustedEvent');
  }

  if (tracking.clicksAtZero > 0) {
    signals.push('zeroCoordinateClick');
  }

  const totalClicks = tracking.mouseEvents.filter(e => e.type === 'down').length;
  if (totalClicks >= 2 && tracking.clicksAtExactCenter >= totalClicks * 0.8) {
    signals.push('exactCenterClicks');
  }

  if (tracking.suspiciousKeyEvents > 0) {
    signals.push('syntheticKeyEvents');
  }

  if (tracking.keystrokeTimes.length >= 5) {
    const intervals: number[] = [];
    for (let i = 1; i < tracking.keystrokeTimes.length; i++) {
      intervals.push(tracking.keystrokeTimes[i] - tracking.keystrokeTimes[i - 1]);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(intervals.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / intervals.length);

    if (stdDev < 10 && avg < 100) {
      signals.push('uniformKeystrokeTiming');
    }
  }

  if (signals.length === 0) {
    return pass(
      'interaction',
      'advanced-bot-signals',
      'interaction',
      'no-advanced-signals',
      'No advanced interaction bot signals'
    );
  }

  return finding(
    'medium',
    'interaction',
    'advanced-bot-signals',
    'interaction',
    'advanced-bot-signals',
    `Advanced interaction bot signals: ${signals.join(', ')}`,
    { signals }
  );
}

export function analyzeCDPMouseLeak(): DetectionResult {
  if (tracking.mouseEvents.length < 20) {
    return pass(
      'cdp',
      'cdp:mouse-leak',
      'interaction',
      'insufficient-mouse-data',
      'Not enough mouse events to evaluate CDP leak'
    );
  }

  const suspiciousChecks = tracking.cdpLeakChecks.filter(result => (result as CDPCheckResult).suspicious === true);

  if (suspiciousChecks.length === 0) {
    return pass(
      'cdp',
      'cdp:mouse-leak',
      'interaction',
      'no-cdp-leak',
      'No CDP screen coordinate leak pattern'
    );
  }

  const totalChecks = tracking.cdpLeakChecks.length;
  const ratio = suspiciousChecks.length / totalChecks;

  const windowScreenX = typeof window.screenX !== 'undefined' ? window.screenX : window.screenLeft || 0;
  const windowScreenY = typeof window.screenY !== 'undefined' ? window.screenY : window.screenTop || 0;

  if (ratio > 0.8 && totalChecks > 20) {
    return finding(
      'medium',
      'cdp',
      'cdp:mouse-leak',
      'interaction',
      'cdp-screen-offset-bug',
      `${(ratio * 100).toFixed(0)}% events show CDP screen coordinate bug (screenX === clientX with window offset)`,
      {
        cdpPatternRatio: ratio.toFixed(2),
        totalEvents: tracking.mouseEvents.filter(e => e.type === 'move').length,
        suspiciousChecks: suspiciousChecks.length,
        totalChecks,
        windowPosition: { x: windowScreenX, y: windowScreenY },
      }
    );
  }

  return pass(
    'cdp',
    'cdp:mouse-leak',
    'interaction',
    'insufficient-cdp-pattern',
    'Some screen coordinate anomalies but below CDP leak threshold'
  );
}
