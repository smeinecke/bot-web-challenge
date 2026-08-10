import { describe, it, expect } from 'vitest';
import { evaluateWorkerCDP, evaluateWorkerConsistency, type WorkerResults } from './worker-checks';

const baseWorker: WorkerResults = {
  userAgent: navigator.userAgent,
  webdriver: false,
  platform: navigator.platform,
  hardwareConcurrency: navigator.hardwareConcurrency,
  languages: [],
  hasCDP: false,
  webGLVendor: 'NA',
  webGLRenderer: 'NA',
};

describe('evaluateWorkerCDP failure handling', () => {
  it('treats worker errors as inconclusive, not a pass', () => {
    const result = evaluateWorkerCDP({ ...baseWorker, error: 'boom' });
    expect(result).not.toBe(false);
    expect(result).toMatchObject({
      inconclusive: true,
      reason: 'workerError',
    });
  });

  it('treats worker timeouts as inconclusive', () => {
    const result = evaluateWorkerCDP({ ...baseWorker, timeout: true });
    expect(result).not.toBe(false);
    expect(result).toMatchObject({
      inconclusive: true,
      reason: 'workerTimeout',
    });
  });

  it('treats unsupported workers as inconclusive', () => {
    const result = evaluateWorkerCDP({ ...baseWorker, notSupported: true });
    expect(result).not.toBe(false);
    expect(result).toMatchObject({
      inconclusive: true,
      reason: 'workerUnsupported',
    });
  });

  it('still reports a CDP finding when the worker measurement succeeds', () => {
    const result = evaluateWorkerCDP({ ...baseWorker, hasCDP: true });
    expect(result).not.toBe(false);
    expect(result).toMatchObject({
      reason: 'workerCDPMarker',
      severity: 'strong',
      category: 'cdp',
    });
  });
});

describe('evaluateWorkerConsistency failure handling', () => {
  it('treats worker errors as inconclusive, not a pass', () => {
    const result = evaluateWorkerConsistency({ ...baseWorker, error: 'boom' });
    expect(result).not.toBe(false);
    expect(result).toMatchObject({
      inconclusive: true,
      reason: 'workerError',
    });
  });

  it('treats unsupported workers as inconclusive', () => {
    const result = evaluateWorkerConsistency({ ...baseWorker, notSupported: true });
    expect(result).not.toBe(false);
    expect(result).toMatchObject({
      inconclusive: true,
      reason: 'workerUnsupported',
    });
  });

  it('treats worker timeouts as inconclusive', () => {
    const result = evaluateWorkerConsistency({ ...baseWorker, timeout: true });
    expect(result).not.toBe(false);
    expect(result).toMatchObject({
      inconclusive: true,
      reason: 'workerTimeout',
    });
  });
});
