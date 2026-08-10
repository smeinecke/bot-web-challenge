/**
 * Timing integrity subsystem.
 *
 * Distinguishes stock browser timing from modified / call-frequency-inflated
 * performance.now() behavior by collecting tight-loop samples in multiple
 * execution realms and looking for semantic contradictions.
 *
 * Anti-goals enforced here:
 *   - No detector-specific logic for external services.
 *   - No hard-coded Chromium/Firefox resolution values.
 *   - Raw resolution is diagnostic; only contradictions are scored.
 *   - All scored artifacts live in category 'timing'.
 */
import {
  finding,
  inconclusive,
  pass,
  notApplicable,
  type DetectionResult,
} from './detector-types';
import {
  collectSameOriginIframeObservations,
  collectBlobIframeObservations,
  collectWorkerObservations,
  collectSharedWorkerObservations,
  type RealmSnapshot,
  type CrossRealmProbe,
  type RealmContext,
} from './cross-realm';

const JITTER_EPS = 0.0005;
const TIGHT_LOOP_SAMPLE_COUNT = 1000;
const DELAY_TARGET_MS = 150;

export interface TimingTightLoopSample {
  /** Individual performance.now() readings, in milliseconds. */
  samples: number[];
}

export interface TightLoopStats {
  sampleCount: number;
  reportedElapsedMs: number;
  comparisonElapsedMs?: number;
  zeroDeltaCount: number;
  zeroDeltaRatio: number;
  positiveDeltaCount: number;
  minPositiveDelta: number;
  medianPositiveDelta: number;
  p95PositiveDelta: number;
  maxPositiveDelta: number;
  uniquePositiveDeltaCount: number;
  nonMonotonicDrops: number;
}

export interface TimingDelayMeasurement {
  targetDelayMs: number;
  actualDelayMs: number;
  performanceDeltaMs: number;
  driftMs: number;
  relativeDrift: number;
}

export interface TimingRafMeasurement {
  rafTimestamp: number;
  nowAtCallback: number;
  callbackLag: number;
  futureOffset: number;
  monotonicDrops: number;
  samples?: { rafTimestamp: number; nowAtCallback: number }[];
}

export interface TimingEventTimestampMeasurement {
  beforeNow: number;
  afterNow: number;
  eventTimestamp: number;
  estimatedOriginTime: number;
  driftMs: number;
  isTrusted: boolean;
}

export interface TimingTimeOriginMeasurement {
  timeOrigin: number;
  nowAtCheck: number;
  dateAtCheck: number;
  driftMs: number;
}

export interface NotSupportedMeasurement {
  notSupported: true;
  error?: string;
}

export interface TimingRealmMeasurements {
  realm: RealmContext;
  timeOrigin?: number;
  timeOriginCoherence?: TimingTimeOriginMeasurement | NotSupportedMeasurement;
  tightLoop?: TightLoopStats | NotSupportedMeasurement;
  delay?: TimingDelayMeasurement | NotSupportedMeasurement;
  raf?: TimingRafMeasurement | NotSupportedMeasurement;
  eventTimestamp?: TimingEventTimestampMeasurement | NotSupportedMeasurement;
}

export interface TimingMeasurements {
  main: TimingRealmMeasurements;
  realms: TimingRealmMeasurements[];
  collectedAt: number;
}

export interface TimingFinding extends DetectionResult {}

export interface TimingAnalysis {
  findings: TimingFinding[];
  evidence: Record<string, unknown>;
  clean: boolean;
}

export interface TimingCollectionOptions {
  sampleCount?: number;
  delayMs?: number;
}

export interface TimingAnalysisOptions {
  inflationAbsMs?: number;
  inflationRel?: number;
  delayDriftAbsMs?: number;
  delayDriftRel?: number;
  timeOriginDriftMs?: number;
  rafFutureOffsetMs?: number;
  eventTsDriftMs?: number;
}

const DEFAULT_ANALYSIS_OPTIONS: Required<TimingAnalysisOptions> = {
  inflationAbsMs: 25,
  inflationRel: 1.8,
  delayDriftAbsMs: 30,
  delayDriftRel: 0.25,
  timeOriginDriftMs: 50,
  rafFutureOffsetMs: 10,
  eventTsDriftMs: 50,
};

/**
 * Compute aggregate statistics over a tight loop of performance.now() samples.
 * comparisonElapsedMs is an independent wall-clock measurement (e.g. Date.now()).
 */
export function computeTightLoopStats(
  samples: number[],
  comparisonElapsedMs?: number
): TightLoopStats {
  const n = samples.length;
  const reportedElapsedMs = n > 1 ? samples[n - 1] - samples[0] : 0;

  let zeroDeltaCount = 0;
  let positiveDeltaCount = 0;
  let nonMonotonicDrops = 0;
  const uniqueDeltas = new Set<number>();
  const positiveDeltas: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const d = samples[i + 1] - samples[i];
    if (Math.abs(d) <= JITTER_EPS) {
      zeroDeltaCount++;
    } else if (d > JITTER_EPS) {
      positiveDeltaCount++;
      positiveDeltas.push(d);
      uniqueDeltas.add(d);
    } else {
      nonMonotonicDrops++;
    }
  }

  positiveDeltas.sort((a, b) => a - b);

  const minPositiveDelta = positiveDeltas[0] ?? 0;
  const maxPositiveDelta = positiveDeltas[positiveDeltas.length - 1] ?? 0;
  const medianPositiveDelta = positiveDeltas.length
    ? positiveDeltas[Math.floor(positiveDeltas.length / 2)]
    : 0;
  const p95Index = Math.max(0, Math.ceil(positiveDeltas.length * 0.95) - 1);
  const p95PositiveDelta = positiveDeltas[p95Index] ?? 0;

  return {
    sampleCount: n,
    reportedElapsedMs,
    comparisonElapsedMs,
    zeroDeltaCount,
    zeroDeltaRatio: n > 1 ? zeroDeltaCount / (n - 1) : 0,
    positiveDeltaCount,
    minPositiveDelta,
    medianPositiveDelta,
    p95PositiveDelta,
    maxPositiveDelta,
    uniquePositiveDeltaCount: uniqueDeltas.size,
    nonMonotonicDrops,
  };
}

function isNotSupported(value: unknown): value is NotSupportedMeasurement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'notSupported' in value &&
    (value as NotSupportedMeasurement).notSupported === true
  );
}

function isTightLoopStats(value: unknown): value is TightLoopStats {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sampleCount' in value &&
    typeof (value as TightLoopStats).sampleCount === 'number' &&
    'positiveDeltaCount' in value
  );
}

function isTimeOriginMeasurement(value: unknown): value is TimingTimeOriginMeasurement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'driftMs' in value &&
    typeof (value as TimingTimeOriginMeasurement).driftMs === 'number'
  );
}

function isDelayMeasurement(value: unknown): value is TimingDelayMeasurement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'actualDelayMs' in value &&
    typeof (value as TimingDelayMeasurement).actualDelayMs === 'number'
  );
}

function isRafMeasurement(value: unknown): value is TimingRafMeasurement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rafTimestamp' in value &&
    typeof (value as TimingRafMeasurement).rafTimestamp === 'number'
  );
}

function isEventTimestampMeasurement(value: unknown): value is TimingEventTimestampMeasurement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'eventTimestamp' in value &&
    typeof (value as TimingEventTimestampMeasurement).eventTimestamp === 'number'
  );
}

function isInflated(stats: TightLoopStats, opts: Required<TimingAnalysisOptions>): boolean {
  if (stats.comparisonElapsedMs == null) {
    return false;
  }

  const excess = stats.reportedElapsedMs - stats.comparisonElapsedMs;

  // If the independent wall clock did not advance a measurable tick, the only
  // way to inflate is for performance.now() to report elapsed time anyway.
  if (stats.comparisonElapsedMs <= 0) {
    return stats.reportedElapsedMs > opts.inflationAbsMs;
  }

  return (
    excess > opts.inflationAbsMs &&
    stats.reportedElapsedMs > stats.comparisonElapsedMs * opts.inflationRel
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTimingProbeExpr(sampleCount: number): string {
  return `(() => {
  try {
    if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
      return { notSupported: true };
    }
    const timeOrigin = performance.timeOrigin || 0;
    const toNow = performance.now();
    const toDate = Date.now();
    const timeOriginDrift = (timeOrigin + toNow) - toDate;
    const n = ${sampleCount};
    const before = performance.now();
    const beforeDate = Date.now();
    const samples = [];
    for (let i = 0; i < n; i++) {
      samples.push(performance.now());
    }
    const after = performance.now();
    const afterDate = Date.now();
    const reportedElapsedMs = after - before;
    const comparisonElapsedMs = afterDate - beforeDate;
    const jitter = ${JITTER_EPS};
    let zeroDeltaCount = 0;
    let positiveDeltaCount = 0;
    let nonMonotonicDrops = 0;
    const uniqueDeltas = new Set();
    const positiveDeltas = [];
    for (let i = 0; i < samples.length - 1; i++) {
      const d = samples[i + 1] - samples[i];
      if (Math.abs(d) <= jitter) {
        zeroDeltaCount++;
      } else if (d > jitter) {
        positiveDeltaCount++;
        positiveDeltas.push(d);
        uniqueDeltas.add(d);
      } else {
        nonMonotonicDrops++;
      }
    }
    positiveDeltas.sort((a, b) => a - b);
    const minPositiveDelta = positiveDeltas[0] || 0;
    const maxPositiveDelta = positiveDeltas[positiveDeltas.length - 1] || 0;
    const medianPositiveDelta = positiveDeltas.length ? positiveDeltas[Math.floor(positiveDeltas.length / 2)] : 0;
    const p95Index = Math.max(0, Math.ceil(positiveDeltas.length * 0.95) - 1);
    const p95PositiveDelta = positiveDeltas[p95Index] || 0;
    const uniquePositiveDeltaCount = uniqueDeltas.size;
    return {
      timeOrigin,
      timeOriginCoherence: { timeOrigin, nowAtCheck: toNow, dateAtCheck: toDate, driftMs: timeOriginDrift },
      tightLoop: {
        sampleCount: n,
        reportedElapsedMs,
        comparisonElapsedMs,
        zeroDeltaCount,
        zeroDeltaRatio: n > 1 ? zeroDeltaCount / (n - 1) : 0,
        positiveDeltaCount,
        minPositiveDelta,
        medianPositiveDelta,
        p95PositiveDelta,
        maxPositiveDelta,
        uniquePositiveDeltaCount,
        nonMonotonicDrops
      }
    };
  } catch (e) {
    return { error: String(e.message || e) };
  }
})()`;
}

function buildTimingProbe(sampleCount: number): CrossRealmProbe {
  return {
    id: 'timing:tight-loop',
    category: 'other',
    severity: 'weak',
    realms: ['main', 'same-origin-iframe', 'blob-iframe', 'worker', 'shared-worker'],
    expr: buildTimingProbeExpr(sampleCount),
    description: 'Tight-loop performance.now() timing probe',
  };
}

async function collectDelayMeasurement(
  delayMs = DELAY_TARGET_MS
): Promise<TimingDelayMeasurement | NotSupportedMeasurement> {
  if (
    typeof performance === 'undefined' ||
    typeof performance.now !== 'function' ||
    typeof Date === 'undefined' ||
    typeof setTimeout !== 'function'
  ) {
    return { notSupported: true };
  }
  const beforeNow = performance.now();
  const beforeDate = Date.now();
  await sleep(delayMs);
  const afterNow = performance.now();
  const afterDate = Date.now();

  const actualDelayMs = afterDate - beforeDate;
  const performanceDeltaMs = afterNow - beforeNow;
  const driftMs = performanceDeltaMs - actualDelayMs;
  const relativeDrift = actualDelayMs > 0 ? driftMs / actualDelayMs : 0;

  return {
    targetDelayMs: delayMs,
    actualDelayMs,
    performanceDeltaMs,
    driftMs,
    relativeDrift,
  };
}

function collectRafMeasurement(): Promise<TimingRafMeasurement | NotSupportedMeasurement> {
  if (typeof requestAnimationFrame !== 'function') {
    return Promise.resolve({ notSupported: true });
  }

  return new Promise((resolve) => {
    let resolved = false;
    const samples: { rafTimestamp: number; nowAtCallback: number }[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);

      if (samples.length === 0) {
        resolve({ notSupported: true });
        return;
      }

      let monotonicDrops = 0;
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].rafTimestamp < samples[i - 1].rafTimestamp - JITTER_EPS) {
          monotonicDrops++;
        }
      }

      const last = samples[samples.length - 1];
      const maxFutureOffset = samples.reduce(
        (max, s) => Math.max(max, s.rafTimestamp - s.nowAtCallback),
        0
      );

      resolve({
        rafTimestamp: last.rafTimestamp,
        nowAtCallback: last.nowAtCallback,
        callbackLag: last.nowAtCallback - last.rafTimestamp,
        futureOffset: maxFutureOffset,
        monotonicDrops,
        samples,
      });
    };

    const timeout = () => {
      if (!resolved) {
        resolved = true;
        resolve({ notSupported: true });
      }
    };

    // A missing or heavily throttled rAF is a capability limitation, not a
    // coherence finding. Cap the wait so the detector remains usable in
    // jsdom/headless environments.
    timeoutId = setTimeout(timeout, 500);

    const step = () => {
      requestAnimationFrame((timestamp) => {
        if (resolved) return;

        if (!Number.isFinite(timestamp)) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve({ notSupported: true });
          return;
        }

        samples.push({
          rafTimestamp: timestamp,
          nowAtCallback: performance.now(),
        });

        if (samples.length < 3) {
          step();
        } else {
          finish();
        }
      });
    };

    step();
  });
}

async function collectEventTimestampMeasurement(): Promise<
  TimingEventTimestampMeasurement | NotSupportedMeasurement
> {
  if (
    typeof EventTarget === 'undefined' ||
    typeof Event === 'undefined' ||
    typeof performance === 'undefined' ||
    typeof performance.now !== 'function'
  ) {
    return { notSupported: true };
  }

  const target = new EventTarget();
  const beforeNow = performance.now();
  const timeOrigin = performance.timeOrigin || 0;
  let eventTimestamp = NaN;
  let isTrusted = false;

  const handler = (e: Event) => {
    eventTimestamp = e.timeStamp;
    isTrusted = e.isTrusted;
  };
  target.addEventListener('test', handler);

  const ev = new Event('test');
  target.dispatchEvent(ev);

  const afterNow = performance.now();
  // Event.timeStamp is a DOMHighResTimeStamp relative to the same timeOrigin as
  // performance.now(), so the coherent reference is the performance.now() value
  // around the moment the event was dispatched.
  const referenceNow = (beforeNow + afterNow) / 2;
  const driftMs = eventTimestamp - referenceNow;
  const estimatedOriginTime = timeOrigin + eventTimestamp;

  // Some environments (e.g. jsdom) report absolute epoch timestamps or 0 for
  // synthetic events, which cannot be compared to performance.now().
  if (
    !Number.isFinite(eventTimestamp) ||
    eventTimestamp === 0 ||
    (eventTimestamp > 1e12 && Math.abs(driftMs) > 1000)
  ) {
    return { notSupported: true };
  }

  return {
    beforeNow,
    afterNow,
    eventTimestamp,
    estimatedOriginTime,
    driftMs,
    isTrusted,
  };
}

/**
 * Collect timing samples in the main realm.
 */
export async function collectMainTimingSamples(
  options: TimingCollectionOptions = {}
): Promise<TimingMeasurements> {
  const sampleCount = options.sampleCount ?? TIGHT_LOOP_SAMPLE_COUNT;
  const delayMs = options.delayMs ?? DELAY_TARGET_MS;

  const mainRealm: TimingRealmMeasurements = { realm: 'main' };

  if (
    typeof performance === 'undefined' ||
    typeof performance.now !== 'function'
  ) {
    mainRealm.timeOriginCoherence = { notSupported: true };
    mainRealm.tightLoop = { notSupported: true };
    mainRealm.delay = { notSupported: true };
    mainRealm.raf = { notSupported: true };
    mainRealm.eventTimestamp = { notSupported: true };
    return { main: mainRealm, realms: [], collectedAt: Date.now() };
  }

  const timeOrigin = performance.timeOrigin || 0;
  mainRealm.timeOrigin = timeOrigin;

  const toNow = performance.now();
  const toDate = Date.now();
  mainRealm.timeOriginCoherence = {
    timeOrigin,
    nowAtCheck: toNow,
    dateAtCheck: toDate,
    driftMs: timeOrigin + toNow - toDate,
  };

  const beforeDate = Date.now();
  const samples: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    samples.push(performance.now());
  }
  const afterDate = Date.now();

  mainRealm.tightLoop = computeTightLoopStats(samples, afterDate - beforeDate);

  const [delay, raf, eventTimestamp] = await Promise.all([
    collectDelayMeasurement(delayMs),
    collectRafMeasurement(),
    collectEventTimestampMeasurement(),
  ]);

  mainRealm.delay = delay;
  mainRealm.raf = raf;
  mainRealm.eventTimestamp = eventTimestamp;

  return { main: mainRealm, realms: [], collectedAt: Date.now() };
}

async function collectRealmTiming(
  realm: RealmContext,
  probe: CrossRealmProbe
): Promise<TimingRealmMeasurements> {
  let snapshot: RealmSnapshot;
  try {
    if (realm === 'same-origin-iframe') {
      snapshot = await collectSameOriginIframeObservations([probe]);
    } else if (realm === 'blob-iframe') {
      snapshot = await collectBlobIframeObservations([probe]);
    } else if (realm === 'worker') {
      snapshot = await collectWorkerObservations([probe]);
    } else if (realm === 'shared-worker') {
      snapshot = await collectSharedWorkerObservations([probe]);
    } else {
      snapshot = {
        realm,
        values: {},
        inconclusive: true,
        reason: 'unknownRealm',
        description: 'Unknown realm',
      };
    }
  } catch (e) {
    snapshot = {
      realm,
      values: {},
      inconclusive: true,
      reason: 'exception',
      description: (e as Error).message,
    };
  }

  if (snapshot.inconclusive) {
    return {
      realm,
      timeOriginCoherence: { notSupported: true, error: snapshot.reason },
      tightLoop: { notSupported: true, error: snapshot.reason },
    };
  }

  const raw = snapshot.values[probe.id] as unknown;
  if (!raw || typeof raw !== 'object' || isNotSupported(raw) || ('error' in (raw as object))) {
    return {
      realm,
      timeOriginCoherence: { notSupported: true },
      tightLoop: (raw as NotSupportedMeasurement) || { notSupported: true },
    };
  }

  const rm = raw as TimingRealmMeasurements;
  rm.realm = realm;
  return rm;
}

/**
 * Collect timing samples in all applicable realms.
 */
export async function collectAllTimingMeasurements(
  options: TimingCollectionOptions = {}
): Promise<TimingMeasurements> {
  const sampleCount = options.sampleCount ?? TIGHT_LOOP_SAMPLE_COUNT;
  const mainMeasurement = await collectMainTimingSamples(options);
  const probe = buildTimingProbe(sampleCount);

  const [sameOrigin, blob, worker, sharedWorker] = await Promise.all([
    collectRealmTiming('same-origin-iframe', probe),
    collectRealmTiming('blob-iframe', probe),
    collectRealmTiming('worker', probe),
    collectRealmTiming('shared-worker', probe),
  ]);

  return {
    main: mainMeasurement.main,
    realms: [sameOrigin, blob, worker, sharedWorker],
    collectedAt: Date.now(),
  };
}

/**
 * Analyze collected timing measurements and produce scored timing findings.
 */
export function analyzeTimingMeasurements(
  measurements: TimingMeasurements,
  options: TimingAnalysisOptions = {}
): TimingAnalysis {
  const opts: Required<TimingAnalysisOptions> = {
    ...DEFAULT_ANALYSIS_OPTIONS,
    ...options,
  };

  const findings: TimingFinding[] = [];
  const evidence: Record<string, unknown> = { collectedAt: measurements.collectedAt };
  const allRealms = [measurements.main, ...measurements.realms];

  const realmFlags: Record<
    string,
    { stats: TightLoopStats; inflated: boolean; monotonic: boolean }
  > = {};
  let mainTightLoopSupported = false;

  for (const realm of allRealms) {
    evidence[realm.realm] = {
      timeOrigin: realm.timeOrigin,
      timeOriginCoherence: realm.timeOriginCoherence,
      tightLoop: realm.tightLoop,
      delay: realm.delay,
      raf: realm.raf,
      eventTimestamp: realm.eventTimestamp,
    };

    const stats = isTightLoopStats(realm.tightLoop)
      ? (realm.tightLoop as TightLoopStats)
      : undefined;

    if (stats) {
      if (realm.realm === 'main') mainTightLoopSupported = true;
      realmFlags[realm.realm] = {
        stats,
        inflated: isInflated(stats, opts),
        monotonic: (stats.nonMonotonicDrops ?? 0) > 0,
      };
    } else if (isNotSupported(realm.tightLoop)) {
      if (realm.realm === 'main') {
        mainTightLoopSupported = false;
      } else {
        findings.push(
          notApplicable(
            'timing',
            `timing:${realm.realm}:not-supported`,
            realm.realm,
            'realm-unsupported',
            `${realm.realm} timing collection is not supported in this environment`
          )
        );
      }
    }
  }

  if (!mainTightLoopSupported) {
    findings.push(
      inconclusive(
        'timing',
        'timing:integrity',
        'main',
        'main-timing-unsupported',
        'performance.now() is not available in the main realm',
        { evidence }
      )
    );
    return { findings, evidence, clean: false };
  }

  const flagsList = Object.entries(realmFlags);

  // call-frequency inflation
  const inflated = flagsList.filter(([, v]) => v.inflated);
  if (inflated.length > 0) {
    findings.push(
      finding(
        'medium',
        'timing',
        'timing:call-frequency-inflation',
        'main',
        'call-frequency-inflation',
        'performance.now() elapsed in a tight loop is disproportionate to real wall-clock time',
        {
          inflatedRealms: inflated.map(([r]) => r),
          realmStats: Object.fromEntries(
            flagsList.map(([r, v]) => [r, { reportedElapsedMs: v.stats.reportedElapsedMs, comparisonElapsedMs: v.stats.comparisonElapsedMs }])
          ),
        }
      )
    );
  }

  // monotonicity
  const nonMonotonic = flagsList.filter(([, v]) => v.monotonic);
  if (nonMonotonic.length > 0) {
    findings.push(
      finding(
        'medium',
        'timing',
        'timing:non-monotonic',
        'main',
        'non-monotonic-clock',
        'performance.now() decreased between consecutive calls',
        {
          nonMonotonicRealms: nonMonotonic.map(([r]) => r),
        }
      )
    );
  }

  // cross-realm coherence
  const anyInflated = flagsList.some(([, v]) => v.inflated);
  const anyNormal = flagsList.some(([, v]) => !v.inflated);
  if (anyInflated && anyNormal) {
    findings.push(
      finding(
        'medium',
        'timing',
        'timing:cross-realm-coherence',
        'main',
        'cross-realm-timing-mismatch',
        'Timing behavior is inconsistent between execution realms',
        {
          comparison: flagsList.map(([r, v]) => ({
            realm: r,
            inflated: v.inflated,
            zeroDeltaRatio: v.stats.zeroDeltaRatio,
            uniquePositiveDeltaCount: v.stats.uniquePositiveDeltaCount,
            positiveDeltaCount: v.stats.positiveDeltaCount,
            medianPositiveDelta: v.stats.medianPositiveDelta,
          })),
        }
      )
    );
  }

  // real-delay clock coherence
  if (measurements.main.delay) {
    if (isDelayMeasurement(measurements.main.delay)) {
      const delay = measurements.main.delay as TimingDelayMeasurement;
      if (
        Math.abs(delay.driftMs) > opts.delayDriftAbsMs &&
        Math.abs(delay.relativeDrift) > opts.delayDriftRel
      ) {
        if (inflated.length === 0) {
          findings.push(
            finding(
              'weak',
              'timing',
              'timing:cross-clock-coherence',
              'main',
              'cross-clock-drift',
              'performance.now() delta diverges from Date.now() during a controlled delay',
              { delay }
            )
          );
        }
      }
    } else {
      findings.push(
        notApplicable(
          'timing',
          'timing:cross-clock-coherence',
          'main',
          'delay-unsupported',
          'Controlled delay measurement is not supported in this environment'
        )
      );
    }
  }

  // time-origin coherence
  if (measurements.main.timeOriginCoherence) {
    if (isTimeOriginMeasurement(measurements.main.timeOriginCoherence)) {
      const toc = measurements.main.timeOriginCoherence as TimingTimeOriginMeasurement;
      if (Math.abs(toc.driftMs) > opts.timeOriginDriftMs) {
        if (inflated.length === 0) {
          findings.push(
            finding(
              'weak',
              'timing',
              'timing:time-origin-coherence',
              'main',
              'time-origin-drift',
              'performance.timeOrigin + performance.now() diverges from Date.now()',
              { timeOrigin: toc.timeOrigin, nowAtCheck: toc.nowAtCheck, dateAtCheck: toc.dateAtCheck, driftMs: toc.driftMs }
            )
          );
        }
      }
    } else {
      findings.push(
        notApplicable(
          'timing',
          'timing:time-origin-coherence',
          'main',
          'time-origin-unsupported',
          'performance.timeOrigin is not supported in this environment'
        )
      );
    }
  }

  // rAF coherence
  if (measurements.main.raf) {
    if (isRafMeasurement(measurements.main.raf)) {
      const raf = measurements.main.raf as TimingRafMeasurement;
      const rafReasons: string[] = [];

      // A positive futureOffset means the rAF timestamp is later than
      // performance.now() inside the callback, which contradicts the rendering
      // order: the frame timestamp should not materially post-date the callback.
      if (raf.futureOffset > opts.rafFutureOffsetMs) {
        rafReasons.push('raf-future-timestamp');
      }

      // rAF timestamps must be monotonically non-decreasing across frames.
      if (raf.monotonicDrops > 0) {
        rafReasons.push('raf-non-monotonic');
      }

      if (rafReasons.length > 0) {
        findings.push(
          finding(
            'medium',
            'timing',
            'timing:raf-coherence',
            'main',
            rafReasons.join('+'),
            'requestAnimationFrame timestamp is inconsistent with the high-resolution clock',
            { raf, rafReasons }
          )
        );
      }
    } else {
      findings.push(
        notApplicable(
          'timing',
          'timing:raf-coherence',
          'main',
          'raf-unsupported',
          'requestAnimationFrame is not supported in this environment'
        )
      );
    }
  }

  // event timestamp coherence
  if (measurements.main.eventTimestamp) {
    if (isEventTimestampMeasurement(measurements.main.eventTimestamp)) {
      const ev = measurements.main.eventTimestamp as TimingEventTimestampMeasurement;
      if (ev.eventTimestamp > 0 && Math.abs(ev.driftMs) > opts.eventTsDriftMs) {
        findings.push(
          finding(
            'weak',
            'timing',
            'timing:event-timestamp-coherence',
            'main',
            'event-timestamp-drift',
            'Event.timeStamp is inconsistent with performance.now()',
            { eventTimestamp: ev }
          )
        );
      }
    } else {
      findings.push(
        notApplicable(
          'timing',
          'timing:event-timestamp-coherence',
          'main',
          'event-timestamp-unsupported',
          'Event.timeStamp is not usable in this environment'
        )
      );
    }
  }

  const hasScoredFinding = findings.some((f) => f.status === 'finding');
  if (!hasScoredFinding) {
    findings.push(
      pass(
        'timing',
        'timing:integrity',
        'main',
        'timing-consistent',
        'Timing measurements are consistent with a stock browser',
        { evidence }
      )
    );
  }

  return { findings, evidence, clean: !hasScoredFinding };
}

/**
 * Entry point for the detector registry.
 */
export async function checkTimingIntegrity(): Promise<{
  findings: DetectionResult[];
  measurements: TimingMeasurements;
}> {
  const measurements = await collectAllTimingMeasurements();
  const analysis = analyzeTimingMeasurements(measurements);
  return { findings: analysis.findings, measurements };
}

/**
 * Helper to retrieve raw timing measurements from detector raw results for JSON output.
 */
export function extractTimingMeasurements(
  rawResults: Record<string, unknown>
): TimingMeasurements | undefined {
  const raw = rawResults['checkTimingIntegrity'];
  if (
    raw &&
    typeof raw === 'object' &&
    'measurements' in (raw as object)
  ) {
    return (raw as { measurements: TimingMeasurements }).measurements;
  }
  return undefined;
}
