/**
 * Interaction analysis for the interaction page.
 *
 * This module tracks mouse, keyboard, and input events and runs detectors that
 * analyze them. It never stores actual keyboard characters, input values,
 * passwords, clipboard contents, KeyboardEvent.key, or KeyboardEvent.code.
 * Only timing, event-integrity flags, and structural observations are kept.
 */
import { finding, inconclusive, pass, type DetectionResult } from './detector-types';
import {
  extractCDPFeatures,
  extractFormFeatures,
  extractKeyboardFeatures,
  extractPointerFeatures,
  extractSessionFeatures,
  type BehavioralFeatureVector,
} from './behavior-features';

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

function hasEnoughObservation(): boolean {
  const sessionDuration = tracking.formStartTime ? Date.now() - tracking.formStartTime : 0;
  return (
    (tracking.submitTime && tracking.firstFocusTime && (tracking.submitTime - tracking.firstFocusTime) > 2000) ||
    tracking.totalKeystrokes > 5 ||
    tracking.mouseEvents.length > 20 ||
    sessionDuration > 3000
  );
}

export function analyzeInsufficientObservationWindow(): DetectionResult {
  const sessionDuration = tracking.formStartTime ? Date.now() - tracking.formStartTime : 0;

  if (!hasEnoughObservation()) {
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

/**
 * Convert a 0-1 anomaly score into a severity label, with higher severity
 * when multiple behavioral dimensions corroborate.
 */
function severityFromCorroboration(maxScore: number, corroborating: number): 'weak' | 'medium' | 'strong' {
  if (maxScore >= 0.8 || corroborating >= 3) return 'strong';
  if (maxScore >= 0.5 || corroborating >= 2) return 'medium';
  return 'weak';
}

function reasonFromVector(vector: BehavioralFeatureVector, flags: string[]): string {
  if (flags.includes('autofillLike')) return 'autofill-like';
  if (flags.length === 0) return 'no-anomaly';
  // Pick the strongest contributing dimension's first flag.
  const dimPriority = ['keyboard', 'form', 'pointer', 'cdp', 'session'];
  for (const dim of dimPriority) {
    const d = vector[dim as keyof BehavioralFeatureVector];
    if (d.score >= 0.25 && d.flags.length > 0) return d.flags[0];
  }
  return flags[0];
}

export function analyzeLowObservationSubmission(): DetectionResult[] {
  const results: DetectionResult[] = [];

  if (!tracking.submitTime || tracking.formStartTime === null) {
    return results;
  }

  const form = extractFormFeatures(tracking);
  const session = extractSessionFeatures(tracking);
  const keyboard = extractKeyboardFeatures(tracking);

  // Autofill is a legitimate baseline and should not be scored as a bot.
  if (form.flags.includes('autofillLike')) {
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

  const corroborating = [form, session, keyboard].filter(d => d.score >= 0.25).length;
  const maxScore = Math.max(form.score, session.score, keyboard.score);
  const allFlags = [...form.flags, ...session.flags, ...keyboard.flags];

  if (corroborating === 0 || maxScore < 0.25) {
    results.push(
      pass(
        'interaction',
        'low-observation-submission',
        'interaction',
        'no-low-observation-anomaly',
        'No low-observation scripted submission pattern detected'
      )
    );
    return results;
  }

  const severity = severityFromCorroboration(maxScore, corroborating);
  const reason = reasonFromVector({ pointer: { score: 0, flags: [] }, keyboard, form, session, cdp: { score: 0, flags: [] } }, allFlags);

  results.push(
    finding(
      severity,
      'interaction',
      'low-observation-submission',
      'interaction',
      reason,
      `Low-observation submission with ${corroborating} corroborating behavioral dimensions and ${allFlags.length} flags`,
      {
        dimensions: ['form', 'session', 'keyboard'].filter((_, i) => [form, session, keyboard][i].score >= 0.25),
        flags: allFlags,
        formScore: Math.round(form.score * 100) / 100,
        sessionScore: Math.round(session.score * 100) / 100,
        keyboardScore: Math.round(keyboard.score * 100) / 100,
      }
    )
  );

  return results;
}

export function analyzeSuspiciousClientSideBehavior(): DetectionResult {
  if (!hasEnoughObservation()) {
    return pass(
      'interaction',
      'suspicious-client-side-behavior',
      'interaction',
      'insufficient-observation',
      'Waiting for more interaction data'
    );
  }

  const pointer = extractPointerFeatures(tracking);
  const session = extractSessionFeatures(tracking);
  const keyboard = extractKeyboardFeatures(tracking);

  const corroborating = [pointer, session, keyboard].filter(d => d.score >= 0.25).length;
  const maxScore = Math.max(pointer.score, session.score, keyboard.score);
  const allFlags = [...pointer.flags, ...session.flags, ...keyboard.flags];

  if (corroborating === 0 || maxScore < 0.25) {
    return pass(
      'interaction',
      'suspicious-client-side-behavior',
      'interaction',
      'no-suspicious-behavior',
      'No suspicious client-side behavior detected'
    );
  }

  const severity = severityFromCorroboration(maxScore, corroborating);
  const reason = reasonFromVector({ pointer, keyboard, form: { score: 0, flags: [] }, session, cdp: { score: 0, flags: [] } }, allFlags);

  return finding(
    severity,
    'interaction',
    'suspicious-client-side-behavior',
    'interaction',
    reason,
    `Suspicious client-side behavior: ${allFlags.slice(0, 3).join(', ')}`,
    {
      dimensions: ['pointer', 'session', 'keyboard'].filter((_, i) => [pointer, session, keyboard][i].score >= 0.25),
      behaviors: allFlags,
      pointerScore: Math.round(pointer.score * 100) / 100,
      sessionScore: Math.round(session.score * 100) / 100,
      keyboardScore: Math.round(keyboard.score * 100) / 100,
    }
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

  if (tracking.totalKeystrokes === 0) {
    return pass(
      'interaction',
      'super-human-speed',
      'interaction',
      'no-keystrokes',
      'No keystrokes to measure'
    );
  }

  const keyboard = extractKeyboardFeatures(tracking);

  if (keyboard.score < 0.25) {
    return pass(
      'interaction',
      'super-human-speed',
      'interaction',
      'normal-typing-speed',
      'Typing speed is within human range'
    );
  }

  const totalTime = tracking.submitTime - tracking.firstFocusTime;
  const cps = tracking.totalKeystrokes / (totalTime / 1000);
  const severity = keyboard.score >= 0.8 ? 'strong' : keyboard.score >= 0.5 ? 'medium' : 'weak';

  return finding(
    severity,
    'interaction',
    'super-human-speed',
    'interaction',
    keyboard.flags[0] ?? 'super-human-typing',
    `Typing speed ${cps.toFixed(1)} CPS with ${keyboard.flags.join(', ')}`,
    {
      charsPerSecond: cps.toFixed(1),
      totalTime,
      keystrokes: tracking.totalKeystrokes,
      keyboardScore: Math.round(keyboard.score * 100) / 100,
      flags: keyboard.flags,
    }
  );
}

export function analyzeAdvancedInteractionSignals(): DetectionResult {
  const pointer = extractPointerFeatures(tracking);
  const keyboard = extractKeyboardFeatures(tracking);
  const session = extractSessionFeatures(tracking);

  const allFlags = [...pointer.flags, ...keyboard.flags, ...session.flags];

  if (allFlags.length === 0) {
    return pass(
      'interaction',
      'advanced-bot-signals',
      'interaction',
      'no-advanced-signals',
      'No advanced interaction bot signals'
    );
  }

  const corroborating = [pointer, keyboard, session].filter(d => d.score >= 0.25).length;
  const maxScore = Math.max(pointer.score, keyboard.score, session.score);
  const severity = severityFromCorroboration(maxScore, corroborating);

  return finding(
    severity,
    'interaction',
    'advanced-bot-signals',
    'interaction',
    'advanced-bot-signals',
    `Advanced interaction bot signals: ${allFlags.slice(0, 3).join(', ')}`,
    { signals: allFlags }
  );
}

export function analyzeCDPMouseLeak(): DetectionResult {
  const cdp = extractCDPFeatures(tracking);

  if (cdp.flags.includes('insufficientMouseData')) {
    return pass(
      'cdp',
      'cdp:mouse-leak',
      'interaction',
      'insufficient-mouse-data',
      'Not enough mouse events to evaluate CDP leak'
    );
  }

  if (cdp.score === 0) {
    return pass(
      'cdp',
      'cdp:mouse-leak',
      'interaction',
      'no-cdp-leak',
      'No CDP screen coordinate leak pattern'
    );
  }

  const suspiciousChecks = tracking.cdpLeakChecks.filter(result => (result as CDPCheckResult).suspicious === true);
  const totalChecks = tracking.cdpLeakChecks.length;
  const ratio = totalChecks > 0 ? suspiciousChecks.length / totalChecks : 0;

  const windowScreenX = typeof window.screenX !== 'undefined' ? window.screenX : window.screenLeft || 0;
  const windowScreenY = typeof window.screenY !== 'undefined' ? window.screenY : window.screenTop || 0;

  const severity = cdp.score >= 0.8 ? 'medium' : 'weak';

  return finding(
    severity,
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
