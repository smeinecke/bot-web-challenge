import { describe, it, expect } from 'vitest';
import {
  computeTightLoopStats,
  collectMainTimingSamples,
  analyzeTimingMeasurements,
  checkTimingIntegrity,
  extractTimingMeasurements,
  type TimingMeasurements,
  type TimingRealmMeasurements,
  type TimingRafMeasurement,
  type TightLoopStats,
} from './timing-checks';
import type { DetectionResult } from './detector-types';

function stockSamples(n = 300, realStep = 0.04, quantum = 0.1): number[] {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const raw = i * realStep;
    samples.push(Math.floor(raw / quantum) * quantum);
  }
  return samples;
}

function patch13Samples(n = 300, realStep = 0.05, increment = 0.5): number[] {
  const samples: number[] = [0];
  for (let i = 1; i < n; i++) {
    const raw = i * realStep;
    const next = Math.max(raw, samples[i - 1] + increment);
    samples.push(next);
  }
  return samples;
}

function pageOnlyOverrideSamples(n = 300, realStep = 0.05, increment = 0.2): number[] {
  // Page-only JS override that adds a per-call increment in the main realm
  // while workers remain stock. This produces a call-frequency inflation
  // detectable only in the overridden realm.
  const samples: number[] = [0];
  for (let i = 1; i < n; i++) {
    const raw = i * realStep;
    const next = Math.max(raw, samples[i - 1] + increment);
    samples.push(next);
  }
  return samples;
}

function nonMonotonicSamples(n = 300): number[] {
  const samples = stockSamples(n);
  // Create a single backward step while keeping the array non-empty.
  samples[51] = samples[50] - 0.02;
  return samples;
}

function workerClampedSamples(n = 300, realStep = 0.05, quantum = 0.4): number[] {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const raw = i * realStep;
    samples.push(Math.floor(raw / quantum) * quantum);
  }
  return samples;
}

function makeRealm(
  realm: TimingRealmMeasurements['realm'],
  samples: number[],
  realStep: number
): TimingRealmMeasurements {
  const comparisonElapsedMs = (samples.length - 1) * realStep;
  return {
    realm,
    timeOrigin: 0,
    timeOriginCoherence: { notSupported: true },
    tightLoop: computeTightLoopStats(samples, comparisonElapsedMs),
  };
}

function zeroComparisonStats(reportedElapsedMs: number): TightLoopStats {
  return {
    sampleCount: 1000,
    reportedElapsedMs,
    comparisonElapsedMs: 0,
    zeroDeltaCount: 999,
    zeroDeltaRatio: 1,
    positiveDeltaCount: 0,
    minPositiveDelta: 0,
    medianPositiveDelta: 0,
    p95PositiveDelta: 0,
    maxPositiveDelta: 0,
    uniquePositiveDeltaCount: 0,
    nonMonotonicDrops: 0,
  };
}

function makeRafMeasurement(
  rafTimestamp: number,
  nowAtCallback: number,
  futureOffset = 0,
  monotonicDrops = 0
): TimingRafMeasurement {
  return {
    rafTimestamp,
    nowAtCallback,
    callbackLag: nowAtCallback - rafTimestamp,
    futureOffset,
    monotonicDrops,
    samples: [],
  };
}

function makeMainMeasurement(
  samples: number[],
  realStep: number,
  overrides: Partial<TimingRealmMeasurements> = {}
): TimingRealmMeasurements {
  const comparisonElapsedMs = (samples.length - 1) * realStep;
  return {
    realm: 'main',
    timeOrigin: 0,
    timeOriginCoherence: { timeOrigin: 0, nowAtCheck: comparisonElapsedMs, dateAtCheck: comparisonElapsedMs, driftMs: 0 },
    tightLoop: computeTightLoopStats(samples, comparisonElapsedMs),
    delay: { notSupported: true },
    raf: { notSupported: true },
    eventTimestamp: { notSupported: true },
    ...overrides,
  };
}

function scoredFindings(results: DetectionResult[]): DetectionResult[] {
  return results.filter((f) => f.status === 'finding');
}

function findingByArtifactId(results: DetectionResult[], id: string): DetectionResult | undefined {
  return results.find((f) => f.artifactId === id);
}

describe('computeTightLoopStats', () => {
  it('computes the expected aggregates for a stock-like clamped sequence', () => {
    const samples = stockSamples(100);
    const stats = computeTightLoopStats(samples, 99 * 0.04);
    expect(stats.sampleCount).toBe(100);
    expect(stats.positiveDeltaCount).toBeGreaterThan(0);
    expect(stats.zeroDeltaCount).toBeGreaterThan(0);
    expect(stats.minPositiveDelta).toBeCloseTo(0.1, 5);
    expect(stats.uniquePositiveDeltaCount / stats.positiveDeltaCount).toBeLessThan(0.2);
    expect(stats.nonMonotonicDrops).toBe(0);
  });

  it('detects non-monotonic drops', () => {
    const samples = nonMonotonicSamples(100);
    const stats = computeTightLoopStats(samples);
    expect(stats.nonMonotonicDrops).toBeGreaterThan(0);
  });
});

describe('analyzeTimingMeasurements', () => {
  it('produces no scored findings for a stock-like clamped fixture', () => {
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(stockSamples(300), 0.04),
      realms: [
        makeRealm('worker', workerClampedSamples(300, 0.04, 0.4), 0.04),
      ],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    expect(scoredFindings(analysis.findings)).toHaveLength(0);
  });

  it('flags old unbounded Patch 13 as call-frequency inflation', () => {
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(patch13Samples(300), 0.05),
      realms: [],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    const inflation = findingByArtifactId(analysis.findings, 'timing:call-frequency-inflation');
    expect(inflation).toBeDefined();
    expect(inflation?.status).toBe('finding');
    expect(inflation?.severity).toBe('medium');
  });

  it('flags a page-only JS override as cross-realm coherence', () => {
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(pageOnlyOverrideSamples(300), 0.05),
      realms: [
        makeRealm('worker', workerClampedSamples(300, 0.05, 0.4), 0.05),
      ],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    const crossRealm = findingByArtifactId(analysis.findings, 'timing:cross-realm-coherence');
    expect(crossRealm).toBeDefined();
    expect(crossRealm?.status).toBe('finding');
    expect(crossRealm?.severity).toBe('medium');

    const inflation = findingByArtifactId(analysis.findings, 'timing:call-frequency-inflation');
    expect(inflation).toBeDefined();
    expect(inflation?.status).toBe('finding');
  });

  it('flags a non-monotonic fixture', () => {
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(nonMonotonicSamples(300), 0.04),
      realms: [],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    const nonMono = findingByArtifactId(analysis.findings, 'timing:non-monotonic');
    expect(nonMono).toBeDefined();
    expect(nonMono?.status).toBe('finding');
  });

  it('does not score a normal cross-realm resolution difference', () => {
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(stockSamples(300, 0.04, 0.1), 0.04),
      realms: [
        makeRealm('worker', workerClampedSamples(300, 0.05, 0.4), 0.05),
      ],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    expect(scoredFindings(analysis.findings)).toHaveLength(0);
  });

  it('treats Firefox-style rAF callback lag as diagnostic, not a finding', () => {
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(stockSamples(100), 0.04, {
        raf: makeRafMeasurement(250.005, 366.674, 0, 0),
      }),
      realms: [],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    const rafFinding = findingByArtifactId(analysis.findings, 'timing:raf-coherence');
    expect(rafFinding).toBeUndefined();
  });

  it('flags a future-dated rAF timestamp as a coherence finding', () => {
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(stockSamples(100), 0.04, {
        raf: makeRafMeasurement(100, 50, 55, 0),
      }),
      realms: [],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    const rafFinding = findingByArtifactId(analysis.findings, 'timing:raf-coherence');
    expect(rafFinding).toBeDefined();
    expect(rafFinding?.status).toBe('finding');
    expect(rafFinding?.reason).toMatch(/raf-future-timestamp/);
  });

  it('does not flag frame-quantized clocks (hardened Firefox) as timing anomalies', () => {
    // Firefox with clamped timers reports performance.now() in frame-aligned
    // steps (~16.667ms at 60Hz). The rAF timestamp legitimately lands one frame
    // ahead of the quantized now(), and a 150ms delay under-reads by ~2 quanta.
    const quantum = 1000 / 60;
    const samples = Array.from({ length: 100 }, (_, i) => i * quantum);
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(samples, quantum, {
        raf: makeRafMeasurement(283.339, 266.672, quantum, 0),
        delay: {
          targetDelayMs: 150,
          actualDelayMs: 166,
          performanceDeltaMs: 8 * quantum,
          driftMs: 8 * quantum - 166,
          relativeDrift: (8 * quantum - 166) / 166,
        },
        timeOriginCoherence: { timeOrigin: 100, nowAtCheck: 283.339, dateAtCheck: 366, driftMs: 17.2 },
      }),
      realms: [makeRealm('worker', samples, quantum)],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    expect(findingByArtifactId(analysis.findings, 'timing:raf-coherence')).toBeUndefined();
    expect(findingByArtifactId(analysis.findings, 'timing:cross-clock-coherence')).toBeUndefined();
    expect(findingByArtifactId(analysis.findings, 'timing:time-origin-coherence')).toBeUndefined();
    expect(scoredFindings(analysis.findings)).toHaveLength(0);
  });

  it('still flags grossly future rAF timestamps on quantized clocks', () => {
    const quantum = 1000 / 60;
    const samples = Array.from({ length: 100 }, (_, i) => i * quantum);
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(samples, quantum, {
        raf: makeRafMeasurement(500, 400, 120, 0),
      }),
      realms: [],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    const rafFinding = findingByArtifactId(analysis.findings, 'timing:raf-coherence');
    expect(rafFinding).toBeDefined();
    expect(rafFinding?.status).toBe('finding');
    expect(rafFinding?.reason).toMatch(/raf-future-timestamp/);
  });

  it('flags non-monotonic rAF timestamps as a coherence finding', () => {
    const raf: TimingRafMeasurement = {
      rafTimestamp: 50,
      nowAtCallback: 60,
      callbackLag: 10,
      futureOffset: 0,
      monotonicDrops: 1,
      samples: [
        { rafTimestamp: 100, nowAtCallback: 110 },
        { rafTimestamp: 90, nowAtCallback: 120 },
      ],
    };
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(stockSamples(100), 0.04, { raf }),
      realms: [],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    const rafFinding = findingByArtifactId(analysis.findings, 'timing:raf-coherence');
    expect(rafFinding).toBeDefined();
    expect(rafFinding?.status).toBe('finding');
    expect(rafFinding?.reason).toMatch(/raf-non-monotonic/);
  });

  it('does not inflate when both wall-clock and performance.now report zero elapsed', () => {
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(stockSamples(100), 0.04, {
        tightLoop: zeroComparisonStats(0),
      }),
      realms: [],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    const inflation = findingByArtifactId(analysis.findings, 'timing:call-frequency-inflation');
    expect(inflation).toBeUndefined();
  });

  it('flags inflation when performance.now reports elapsed time while wall-clock stays at zero', () => {
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(stockSamples(100), 0.04, {
        tightLoop: zeroComparisonStats(300),
      }),
      realms: [],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    const inflation = findingByArtifactId(analysis.findings, 'timing:call-frequency-inflation');
    expect(inflation).toBeDefined();
    expect(inflation?.status).toBe('finding');
    expect(inflation?.severity).toBe('medium');
  });

  it('reports a clean pass when no contradictions are found', () => {
    const measurements: TimingMeasurements = {
      main: makeMainMeasurement(stockSamples(100), 0.04),
      realms: [],
      collectedAt: Date.now(),
    };
    const analysis = analyzeTimingMeasurements(measurements);
    expect(analysis.clean).toBe(true);
    const pass = findingByArtifactId(analysis.findings, 'timing:integrity');
    expect(pass?.status).toBe('passed');
  });
});

describe('collectMainTimingSamples', () => {
  it('returns diagnostic data in jsdom without false positives', async () => {
    const measurements = await collectMainTimingSamples({ sampleCount: 50, delayMs: 50 });
    expect(measurements.main.realm).toBe('main');
    expect(measurements.main.tightLoop).toBeDefined();
    expect(measurements.main.delay).toBeDefined();
    expect(measurements.main.raf).toBeDefined();
    expect(measurements.main.eventTimestamp).toBeDefined();

    // Unsupported/legacy APIs must be marked not supported, not as passes.
    if ('notSupported' in (measurements.main.raf as object)) {
      expect(measurements.main.raf).toMatchObject({ notSupported: true });
    }
    if ('notSupported' in (measurements.main.eventTimestamp as object)) {
      expect(measurements.main.eventTimestamp).toMatchObject({ notSupported: true });
    } else {
      const ev = measurements.main.eventTimestamp as { eventTimestamp: number; driftMs: number };
      expect(Number.isFinite(ev.eventTimestamp)).toBe(true);
      expect(Number.isFinite(ev.driftMs)).toBe(true);
    }

    const analysis = analyzeTimingMeasurements(measurements);
    expect(scoredFindings(analysis.findings)).toHaveLength(0);
  });
});

describe('checkTimingIntegrity integration', () => {
  it('exposes measurements that can be extracted from raw results', async () => {
    const { findings, measurements } = await checkTimingIntegrity();
    expect(findings).toBeInstanceOf(Array);
    expect(measurements.main).toBeDefined();
    expect(measurements.collectedAt).toBeGreaterThan(0);

    const rawResults = { checkTimingIntegrity: { findings, measurements } };
    const extracted = extractTimingMeasurements(rawResults);
    expect(extracted).toBeDefined();
    expect(extracted?.collectedAt).toBe(measurements.collectedAt);
  });
});
