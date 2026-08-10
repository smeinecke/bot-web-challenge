/**
 * Challenge mode utilities.
 *
 * Lab mode preserves named detectors, full explanations, JSON output, and exact
 * findings. Challenge mode uses an ephemeral seed to randomize the subset and
 * order of probes, and it does not disclose per-detector results until the
 * challenge attempt has completed.
 */

import type { ScoringResult } from './detector-types';
import type { DetectorRegistryEntry } from './detector-registry';

export type ChallengeMode = 'lab' | 'challenge';

export interface ChallengePlan {
  /** Opaque nonce identifying this challenge attempt. */
  nonce: string;
  /** Timestamp when the challenge was issued (ISO 8601). */
  issuedAt: string;
  /** Detectors selected for this attempt, in challenge execution order. */
  detectors: DetectorRegistryEntry[];
  /** Number of detectors that were available but intentionally not selected. */
  excludedCount: number;
  /** Whether the plan was produced in challenge mode. */
  mode: ChallengeMode;
}

function getRandomValues(size: number): Uint8Array {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint8Array(size));
  }
  const fallback = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    fallback[i] = Math.floor(Math.random() * 256);
  }
  return fallback;
}

/** Generate a URL-safe opaque challenge nonce. */
export function generateChallengeNonce(): string {
  const bytes = getRandomValues(16);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

export interface ChallengePlanOptions {
  /** Minimum detectors to keep (if fewer are available, keep all). */
  minDetectors?: number;
  /** Fraction of the available detectors to include (0-1). */
  fraction?: number;
  /** Seed for deterministic shuffle in tests. */
  seed?: string;
}

function splitmix32(seed: string): () => number {
  let state = 0;
  for (let i = 0; i < seed.length; i++) {
    state = (state + seed.charCodeAt(i)) | 0;
    state = Math.imul(state ^ (state >>> 15), 0xaf15b6ce);
    state = Math.imul(state ^ (state >>> 15), 0xaf15b6ce);
  }
  return () => {
    state |= 0;
    state = (state + 0x9e3779b9) | 0;
    let t = state ^ (state >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(input: T[], seed: string): T[] {
  const arr = input.slice();
  const rand = splitmix32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Build a randomized challenge plan from a detector registry. */
export function buildChallengePlan(
  availableDetectors: DetectorRegistryEntry[],
  mode: ChallengeMode = 'challenge',
  options: ChallengePlanOptions = {}
): ChallengePlan {
  const { minDetectors = 8, fraction = 0.75, seed = generateChallengeNonce() } = options;

  if (mode === 'lab') {
    return {
      nonce: generateChallengeNonce(),
      issuedAt: new Date().toISOString(),
      detectors: availableDetectors.slice(),
      excludedCount: 0,
      mode,
    };
  }

  const shuffled = seededShuffle(availableDetectors, seed);
  const targetCount = Math.max(minDetectors, Math.floor(shuffled.length * fraction));
  const selected = shuffled.slice(0, Math.min(shuffled.length, targetCount));

  return {
    nonce: generateChallengeNonce(),
    issuedAt: new Date().toISOString(),
    detectors: selected,
    excludedCount: availableDetectors.length - selected.length,
    mode,
  };
}

/** Result shape returned after a challenge attempt. */
export interface ChallengeResult {
  plan: ChallengePlan;
  scoring: ScoringResult;
}

/** Compute a compact opaque token for server-side verification. */
export function buildChallengeToken(result: ChallengeResult): string {
  const payload = {
    nonce: result.plan.nonce,
    issuedAt: result.plan.issuedAt,
    risk: result.scoring.summary.risk,
    coverage: result.scoring.summary.coverage,
    confidence: result.scoring.summary.confidence,
    verdict: result.scoring.summary.verdict,
    rule: result.scoring.summary.verdictRule,
  };
  const json = JSON.stringify(payload);
  if (typeof btoa !== 'undefined') {
    return btoa(json);
  }
  return json;
}
