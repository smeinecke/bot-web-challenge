import { describe, it, expect } from 'vitest';
import { buildChallengePlan, buildChallengeToken, generateChallengeNonce } from './challenge';
import type { DetectorRegistryEntry } from './detector-registry';

const mockDetectors: DetectorRegistryEntry[] = Array.from({ length: 12 }, (_, i) => ({
  id: `detector-${i}`,
  artifactId: `artifact-${i}`,
  category: 'browser-integrity',
  context: 'main',
  critical: i < 3,
  isAsync: false,
  run: () => false,
}));

describe('challenge mode', () => {
  it('generates a deterministic plan from a seed and a different plan from a different seed', () => {
    const planA = buildChallengePlan(mockDetectors, 'challenge', { seed: 'seed-a' });
    const planB = buildChallengePlan(mockDetectors, 'challenge', { seed: 'seed-a' });
    const planC = buildChallengePlan(mockDetectors, 'challenge', { seed: 'seed-b' });

    expect(planA.detectors.map(d => d.id)).toEqual(planB.detectors.map(d => d.id));
    expect(planA.detectors.map(d => d.id)).not.toEqual(planC.detectors.map(d => d.id));
    expect(planA.mode).toBe('challenge');
  });

  it('includes a nonce and an issued-at timestamp in every plan', () => {
    const plan = buildChallengePlan(mockDetectors, 'challenge');
    expect(plan.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(new Date(plan.issuedAt).getTime()).toBeGreaterThan(0);
  });

  it('binds the disclosed nonce to the shuffle seed so the plan is reproducible', () => {
    const plan = buildChallengePlan(mockDetectors, 'challenge', { seed: 'seed-a' });
    expect(plan.nonce).toBe('seed-a');
    const replayed = buildChallengePlan(mockDetectors, 'challenge', { seed: plan.nonce });
    expect(replayed.detectors.map(d => d.id)).toEqual(plan.detectors.map(d => d.id));
  });

  it('lab mode keeps all detectors and does not exclude any', () => {
    const plan = buildChallengePlan(mockDetectors, 'lab');
    expect(plan.detectors).toHaveLength(mockDetectors.length);
    expect(plan.excludedCount).toBe(0);
    expect(plan.mode).toBe('lab');
  });

  it('honors the configured fraction and minimum detector count', () => {
    const plan = buildChallengePlan(mockDetectors, 'challenge', { fraction: 0.5, minDetectors: 8, seed: 'x' });
    expect(plan.detectors.length).toBeGreaterThanOrEqual(8);
    expect(plan.detectors.length).toBeLessThanOrEqual(mockDetectors.length);
  });

  it('builds a token that contains the challenge nonce and summary', () => {
    const plan = buildChallengePlan(mockDetectors, 'challenge', { seed: 'token-test' });
    const scoring = {
      summary: {
        nonce: plan.nonce,
        risk: 'medium',
        coverage: 75,
        confidence: 0.82,
        verdict: 'suspicious',
        verdictRule: 'single-category-suspicious:browser-integrity',
      },
    } as any;
    const token = buildChallengeToken({ plan, scoring });
    const decoded = JSON.parse(atob(token));
    expect(decoded.nonce).toBe(plan.nonce);
    expect(decoded.risk).toBe('medium');
    expect(decoded.coverage).toBe(75);
  });

  it('generates a fresh nonce on demand', () => {
    const a = generateChallengeNonce();
    const b = generateChallengeNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
