import { describe, it, expect, beforeEach } from 'vitest';
import { resetTracking, tracking, onFormInput, onFormFocus } from './interaction-checks';
import {
  computeBehavioralFeatureVector,
  extractPointerFeatures,
  extractKeyboardFeatures,
  extractFormFeatures,
  extractCDPFeatures,
  summarizeBehavioralAnomaly,
} from './behavior-features';

function addMouseMove(x: number, y: number, time: number, screenX = x, screenY = y): void {
  const screenMismatch = Math.abs(screenX - x) < 5 && Math.abs(screenY - y) < 5;
  tracking.mouseEvents.push({
    type: 'move',
    x,
    y,
    screenX,
    screenY,
    time,
    screenMismatch,
  });
  tracking.lastMousePos = { x, y };
  tracking.lastActivityTime = time;
  if (screenMismatch) {
    tracking.cdpLeakChecks.push({ suspicious: true });
  } else {
    tracking.cdpLeakChecks.push({ suspicious: false });
  }
}

function addKeystroke(time: number): void {
  tracking.keyEvents.push({
    type: 'down',
    time,
    isTrusted: true,
    hasKeyCode: true,
  });
  tracking.keyEvents.push({
    type: 'up',
    time,
    isTrusted: true,
    hasKeyCode: true,
  });
  tracking.keystrokeTimes.push(time);
  tracking.totalKeystrokes++;
  tracking.lastActivityTime = time;
}

describe('behavioral feature extraction', () => {
  beforeEach(() => {
    resetTracking();
    tracking.formStartTime = Date.now();
    tracking.firstFocusTime = Date.now();
  });

  it('produces a feature vector with five dimensions', () => {
    const vector = computeBehavioralFeatureVector(tracking);
    expect(vector.pointer).toBeDefined();
    expect(vector.keyboard).toBeDefined();
    expect(vector.form).toBeDefined();
    expect(vector.session).toBeDefined();
    expect(vector.cdp).toBeDefined();
  });

  it('detects uniform mouse timing and straight lines as pointer anomalies', () => {
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      // straight line right
      addMouseMove(i * 5, 100, t0 + i * 16);
    }

    const pointer = extractPointerFeatures(tracking);
    expect(pointer.score).toBeGreaterThanOrEqual(0.25);
    expect(pointer.flags).toContain('tooManyStraightLines');
    expect(pointer.flags).toContain('uniformEventTiming');
  });

  it('detects super-human typing speed as a keyboard anomaly', () => {
    const t0 = Date.now();
    tracking.firstFocusTime = t0;
    tracking.submitTime = t0 + 250;
    for (let i = 0; i < 20; i++) {
      addKeystroke(t0 + i * 10);
    }

    const keyboard = extractKeyboardFeatures(tracking);
    expect(keyboard.score).toBeGreaterThanOrEqual(0.25);
    expect(keyboard.flags).toContain('superHumanCps');
    expect(keyboard.flags).toContain('tooFastCompletion');
  });

  it('classifies autofill-like patterns as human-like', () => {
    document.body.innerHTML = `
      <form id="login-form">
        <input type="email" id="email" value="autofilled@example.com" />
        <input type="password" id="password" />
      </form>
    `;
    onFormFocus({ isTrusted: true } as unknown as FocusEvent);
    const inputEvent = {
      isTrusted: true,
      inputType: 'insertReplacementText',
      target: document.getElementById('email'),
      bubbles: true,
    } as unknown as InputEvent;
    onFormInput(inputEvent);
    tracking.hasTrustedInput = true;
    tracking.totalKeystrokes = 0;
    tracking.firstFocusTime = Date.now() - 1500;
    tracking.submitTime = Date.now();

    const form = extractFormFeatures(tracking);
    expect(form.score).toBe(0);
    expect(form.flags).toContain('autofillLike');
  });

  it('requires corroboration before flagging a high anomaly summary', () => {
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      addMouseMove(i * 5, 100, t0 + i * 16);
    }
    const vector = computeBehavioralFeatureVector(tracking);
    const summary = summarizeBehavioralAnomaly(vector);
    expect(summary.corroboratingDimensions).toBeGreaterThanOrEqual(1);
    expect(summary.maxScore).toBe(vector.pointer.score);
  });

  it('detects CDP mouse leak when screenX equals clientX with window offset', () => {
    Object.defineProperty(window, 'screenX', { value: 100, configurable: true });
    Object.defineProperty(window, 'screenY', { value: 100, configurable: true });

    for (let i = 0; i < 50; i++) {
      addMouseMove(50, 50, Date.now() + i * 16, 50, 50);
    }

    const cdp = extractCDPFeatures(tracking);
    expect(cdp.score).toBeGreaterThanOrEqual(0.5);
    expect(cdp.flags).toContain('cdpScreenCoordinateLeak');
  });
});
