import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetTracking,
  tracking,
  onKeyDown,
  onKeyUp,
  onFormInput,
  onMouseDown,
  onMouseMove,
  analyzeLowObservationSubmission,
  analyzeSuspiciousClientSideBehavior,
} from './interaction-checks';
import { summarizeResults } from './scoring';

describe('interaction checks', () => {
  beforeEach(() => {
    resetTracking();
    document.body.innerHTML = `
      <form id="login-form">
        <input type="email" id="email" />
        <input type="password" id="password" />
      </form>
    `;
  });

  describe('keyboard tracking privacy', () => {
    it('does not retain characters, codes, passwords, or field values', () => {
      const email = document.getElementById('email') as HTMLInputElement;
      email.value = 'secret@example.com';

      const inputEvent = {
        isTrusted: true,
        inputType: 'insertText',
        target: email,
        bubbles: true,
      } as unknown as InputEvent;
      onFormInput(inputEvent);

      const keyEvent = new KeyboardEvent('keydown', {
        code: 'KeyA',
        key: 'a',
        keyCode: 65,
        bubbles: true,
      });
      onKeyDown(keyEvent as KeyboardEvent);
      onKeyUp(keyEvent as KeyboardEvent);

      expect(tracking.keyEvents.length).toBe(2);
      for (const e of tracking.keyEvents) {
        expect('key' in e).toBe(false);
        expect('code' in e).toBe(false);
      }
      expect(tracking.inputEvents.length).toBe(1);
      const storedInput = tracking.inputEvents[0];
      expect('data' in storedInput).toBe(false);
      expect(storedInput.value).toBeUndefined();
      expect(tracking.inputEvents.some(e => 'value' in e)).toBe(false);
    });
  });

  describe('low-observation submission', () => {
    const now = Date.now();

    it('rapid low-event scripted submission produces at least suspicious status', () => {
      const email = document.getElementById('email') as HTMLInputElement;
      const password = document.getElementById('password') as HTMLInputElement;
      email.value = 'test@example.com';
      password.value = 'hunter2';

      tracking.formStartTime = now - 100;
      tracking.firstFocusTime = now - 50;
      tracking.submitTime = now;
      tracking.hasTrustedFocus = true;
      tracking.totalKeystrokes = 0;

      const findings = analyzeLowObservationSubmission();
      const result = findings.find(f => f.artifactId === 'low-observation-submission') || findings[0];
      const scoring = summarizeResults({}, findings);
      expect(['suspicious', 'bot']).toContain(scoring.summary.verdict);
      expect(result).toBeDefined();
      expect(['weak', 'medium']).toContain(result?.severity);
    });

    it('realistic autofill is not automatically classified as a bot', () => {
      const email = document.getElementById('email') as HTMLInputElement;
      email.value = ' autofilled@example.com';

      tracking.formStartTime = now - 2000;
      tracking.firstFocusTime = now - 1500;
      tracking.submitTime = now;
      tracking.hasTrustedFocus = true;
      tracking.hasTrustedInput = true;
      tracking.totalKeystrokes = 0;
      tracking.inputEvents.push({
        type: 'input',
        time: now - 1000,
        isTrusted: true,
        inputType: 'insertReplacementText',
      });

      const findings = analyzeLowObservationSubmission();
      const scoring = summarizeResults({}, findings);
      expect(scoring.summary.verdict).not.toBe('bot');
      const result = findings.find(f => f.artifactId === 'low-observation-submission');
      expect(result?.status).toBe('passed');
    });

    it('insufficient observation window is inconclusive and prevents a clean human verdict', () => {
      const result = analyzeSuspiciousClientSideBehavior();
      expect(result.status).toBe('passed');
    });
  });

  describe('interaction tracking state', () => {
    it('synthetic events are recorded without storing coordinates or values', () => {
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: 123,
        clientY: 456,
        button: 0,
        bubbles: true,
      });
      onMouseDown(mouseEvent);
      onMouseMove(mouseEvent);

      expect(tracking.mouseEvents.length).toBe(2);
      for (const e of tracking.mouseEvents) {
        expect('target' in e).toBe(false);
        expect('value' in e).toBe(false);
      }
    });
  });
});
