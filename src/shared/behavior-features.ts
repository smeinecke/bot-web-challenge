/**
 * Behavioral feature extraction and fusion for interaction-based detection.
 *
 * This module turns raw pointer, keyboard, form, and session observations into
 * a multi-dimensional feature vector. Each dimension returns a 0-1 anomaly
 * score and a set of flags. The scoring functions require corroboration across
 * multiple behavioral dimensions before producing a strong bot finding.
 */
import type { TrackingState } from './interaction-checks';

export interface DimensionScore {
  /** 0-1 anomaly score for this dimension. 0 is human-like, 1 is bot-like. */
  score: number;
  /** Human-readable flags that contributed to the score. */
  flags: string[];
}

export interface BehavioralFeatureVector {
  pointer: DimensionScore;
  keyboard: DimensionScore;
  form: DimensionScore;
  session: DimensionScore;
  cdp: DimensionScore;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length);
}

function entropy(values: number[]): number {
  if (values.length < 2) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const buckets = new Map<number, number>();
  for (const v of sorted) {
    // 5ms buckets to avoid treating tiny differences as distinct
    const b = Math.round(v / 5) * 5;
    buckets.set(b, (buckets.get(b) || 0) + 1);
  }
  const total = values.length;
  let h = 0;
  for (const count of buckets.values()) {
    const p = count / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Estimate sample distribution uniformity. 0 is perfectly uniform, higher is more variable. */
function coefficientOfVariation(values: number[]): number {
  const avg = mean(values);
  if (avg === 0) return 0;
  return stdDev(values) / avg;
}

export function extractPointerFeatures(state: TrackingState): DimensionScore {
  const flags: string[] = [];
  let score = 0;

  const moveEvents = state.mouseEvents.filter(e => e.type === 'move') as Array<{ x: number; y: number; time: number; screenX: number; screenY: number }>;
  const downEvents = state.mouseEvents.filter(e => e.type === 'down') as Array<{ x: number; y: number; time: number; isTrusted: boolean }>;

  if (moveEvents.length >= 3) {
    const velocities: number[] = [];
    const curvatures: number[] = [];
    const pauses: number[] = [];
    const straightSegments: number[] = [];
    let overshoots = 0;

    for (let i = 1; i < moveEvents.length; i++) {
      const p0 = moveEvents[i - 1];
      const p1 = moveEvents[i];
      const dt = Math.max(1, p1.time - p0.time);
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      velocities.push(dist / dt);

      const pause = p1.time - p0.time;
      if (pause > 100) pauses.push(pause);

      if (i >= 2) {
        const p2 = moveEvents[i - 2];
        const a = { x: p1.x - p0.x, y: p1.y - p0.y };
        const b = { x: p0.x - p2.x, y: p0.y - p2.y };
        const cross = a.x * b.y - a.y * b.x;
        const dot = a.x * b.x + a.y * b.y;
        const angle = Math.atan2(Math.abs(cross), dot);
        curvatures.push(angle);

        const segmentDist = Math.hypot(p2.x - p0.x, p2.y - p0.y);
        const deviation = Math.abs(cross) / Math.max(1, segmentDist);
        const threshold = Math.max(50, segmentDist * 0.1);
        straightSegments.push(deviation < threshold ? 1 : 0);

        // Simple overshoot heuristic: direction reversals
        if ((p1.x - p0.x) * (p0.x - p2.x) < 0 || (p1.y - p0.y) * (p0.y - p2.y) < 0) {
          if (Math.hypot(p1.x - p2.x, p1.y - p2.y) > segmentDist * 1.2) {
            overshoots++;
          }
        }
      }
    }

    if (straightSegments.length > 0) {
      const straightRatio = straightSegments.reduce((a, b) => a + b, 0) / straightSegments.length;
      if (straightRatio > 0.9) {
        flags.push('tooManyStraightLines');
        score += 0.25;
      }
    }

    if (velocities.length > 0) {
      const velStd = stdDev(velocities);
      const velMean = mean(velocities);
      if (velMean > 0 && velStd / velMean < 0.1) {
        flags.push('uniformPointerVelocity');
        score += 0.25;
      }
    }

    if (pauses.length === 0 && moveEvents.length > 10) {
      flags.push('noPointerPauses');
      score += 0.15;
    }

    if (overshoots === 0 && moveEvents.length > 30) {
      flags.push('noOvershoots');
      score += 0.15;
    }
  }

  if (moveEvents.length > 10) {
    const times = moveEvents.map(e => e.time);
    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
    if (intervals.length >= 10) {
      const cv = coefficientOfVariation(intervals);
      if (cv < 0.1) {
        flags.push('uniformEventTiming');
        score += 0.2;
      }
    }
  }

  const totalClicks = downEvents.length;
  if (totalClicks >= 2) {
    const centerRatio = state.clicksAtExactCenter / totalClicks;
    const zeroRatio = state.clicksAtZero / totalClicks;
    if (centerRatio >= 0.8) {
      flags.push('exactCenterClicks');
      score += 0.15;
    }
    if (zeroRatio > 0.2) {
      flags.push('zeroCoordinateClicks');
      score += 0.15;
    }
  }

  const suspiciousCdp = state.cdpLeakChecks.filter(r => (r as { suspicious?: boolean }).suspicious === true).length;
  const totalCdp = state.cdpLeakChecks.length;
  if (totalCdp > 20) {
    const ratio = suspiciousCdp / totalCdp;
    if (ratio > 0.8) {
      flags.push('cdpScreenCoordinateLeak');
      score += 0.25;
    }
  }

  if (moveEvents.length < 10 && state.totalKeystrokes > 0) {
    flags.push('insufficientMouseMovement');
    score += 0.1;
  }

  return { score: Math.min(1, score), flags };
}

export function extractKeyboardFeatures(state: TrackingState): DimensionScore {
  const flags: string[] = [];
  let score = 0;

  const downTimes: number[] = [];
  const upTimes: number[] = [];
  for (const e of state.keyEvents) {
    if (e.type === 'down') downTimes.push(e.time as number);
    if (e.type === 'up') upTimes.push(e.time as number);
  }

  const intervals: number[] = [];
  for (let i = 1; i < state.keystrokeTimes.length; i++) {
    intervals.push(state.keystrokeTimes[i] - state.keystrokeTimes[i - 1]);
  }

  const firstFocus = state.firstFocusTime;
  const submitTime = state.submitTime;
  const totalTime = firstFocus && submitTime ? submitTime - firstFocus : 0;

  if (state.totalKeystrokes > 0 && totalTime > 0) {
    const cps = state.totalKeystrokes / (totalTime / 1000);
    if (cps > 15) {
      flags.push('superHumanCps');
      score += 0.3;
    } else if (cps > 12) {
      flags.push('veryFastTyping');
      score += 0.15;
    }

    if (totalTime < 500 && state.totalKeystrokes > 5) {
      flags.push('tooFastCompletion');
      score += 0.25;
    }
  }

  if (intervals.length >= 5) {
    const avg = mean(intervals);
    const std = stdDev(intervals);
    const h = entropy(intervals);

    if (std < 10 && avg < 100) {
      flags.push('uniformKeystrokeTiming');
      score += 0.25;
    }

    if (h < 1.5 && intervals.length > 10) {
      flags.push('lowKeystrokeEntropy');
      score += 0.15;
    }

    const burstCount = intervals.filter(v => v < 30).length;
    if (burstCount / intervals.length > 0.7) {
      flags.push('burstTyping');
      score += 0.15;
    }

    const pauseCount = intervals.filter(v => v > 300).length;
    if (state.totalKeystrokes > 10 && pauseCount === 0) {
      flags.push('noTypingPauses');
      score += 0.1;
    }
  }

  if (state.suspiciousKeyEvents > 0) {
    flags.push('syntheticKeyEvents');
    score += 0.2;
  }

  return { score: Math.min(1, score), flags };
}

export function extractFormFeatures(state: TrackingState): DimensionScore {
  const flags: string[] = [];
  let score = 0;

  const firstFocus = state.firstFocusTime;
  const submitTime = state.submitTime;
  const formStart = state.formStartTime;
  const formDuration = firstFocus && submitTime ? submitTime - firstFocus : 0;
  const sessionDuration = formStart && submitTime ? submitTime - formStart : 0;

  const populated = (() => {
    try {
      const email = document.getElementById('email') as HTMLInputElement | null;
      const password = document.getElementById('password') as HTMLInputElement | null;
      return Boolean((email?.value && email.value.length > 0) || (password?.value && password.value.length > 0));
    } catch {
      return false;
    }
  })();

  const hasTrustedInput = state.hasTrustedInput;
  const hasTrustedFocus = state.hasTrustedFocus;
  const hasUntrustedInput = state.inputEvents.some(e => e.isTrusted === false);

  const autofillLike =
    populated &&
    hasTrustedFocus &&
    hasTrustedInput &&
    formDuration >= 1000 &&
    state.totalKeystrokes === 0 &&
    state.inputEvents.some(e => e.inputType === 'insertReplacementText');

  if (autofillLike) {
    // Autofill is a legitimate baseline; do not score it as anomalous.
    return { score: 0, flags: ['autofillLike'] };
  }

  if (populated && !hasTrustedInput) {
    flags.push('populatedWithoutTrustedInput');
    score += 0.25;
  }

  if (populated && !hasTrustedFocus) {
    flags.push('noTrustedFocus');
    score += 0.2;
  }

  if (hasUntrustedInput) {
    flags.push('untrustedInputEvent');
    score += 0.2;
  }

  if (formDuration > 0 && formDuration < 200 && state.totalKeystrokes === 0 && populated) {
    flags.push('instantSubmitNoKeystrokes');
    score += 0.25;
  }

  if (state.totalKeystrokes === 0 && formDuration > 1000 && populated && !hasTrustedInput) {
    flags.push('noInputSequence');
    score += 0.2;
  }

  if (state.mouseEvents.length === 0 && sessionDuration < 1000 && populated) {
    flags.push('noPointerActivityShortSession');
    score += 0.15;
  }

  return { score: Math.min(1, score), flags };
}

export function extractSessionFeatures(state: TrackingState): DimensionScore {
  const flags: string[] = [];
  let score = 0;

  const formStart = state.formStartTime;
  const submitTime = state.submitTime;
  const sessionDuration = formStart && submitTime ? submitTime - formStart : 0;

  if (state.hasUntrustedEvent) {
    flags.push('untrustedEvent');
    score += 0.2;
  }

  const totalEvents = state.mouseEvents.length + state.keyEvents.length + state.inputEvents.length;
  if (sessionDuration > 0) {
    const density = totalEvents / (sessionDuration / 1000);
    if (density > 100) {
      flags.push('veryHighEventDensity');
      score += 0.2;
    }
  }

  const allTimes: number[] = [
    ...state.mouseEvents.map(e => e.time as number),
    ...state.keyEvents.map(e => e.time as number),
    ...state.inputEvents.map(e => e.time as number),
  ].filter(t => typeof t === 'number').sort((a, b) => a - b);

  if (allTimes.length >= 10) {
    const intervals: number[] = [];
    for (let i = 1; i < allTimes.length; i++) intervals.push(allTimes[i] - allTimes[i - 1]);
    const cv = coefficientOfVariation(intervals);
    if (cv < 0.05) {
      flags.push('suspiciouslyRegularSampling');
      score += 0.2;
    }
  }

  const hadMouse = state.mouseEvents.length > 0;
  const hadKeyboard = state.keyEvents.length > 0;
  if (hadMouse && hadKeyboard && state.totalKeystrokes === 0) {
    flags.push('pointerWithoutKeystrokes');
    score += 0.1;
  }

  return { score: Math.min(1, score), flags };
}

export function extractCDPFeatures(state: TrackingState): DimensionScore {
  const flags: string[] = [];
  let score = 0;

  if (state.mouseEvents.length < 20) {
    return { score: 0, flags: ['insufficientMouseData'] };
  }

  const suspicious = state.cdpLeakChecks.filter(r => (r as { suspicious?: boolean }).suspicious === true).length;
  const total = state.cdpLeakChecks.length;
  if (total > 20) {
    const ratio = suspicious / total;
    if (ratio > 0.8) {
      flags.push('cdpScreenCoordinateLeak');
      score = 1;
    } else if (ratio > 0.5) {
      flags.push('someCdpScreenCoordinateAnomalies');
      score = 0.5;
    }
  }

  return { score, flags };
}

export function computeBehavioralFeatureVector(state: TrackingState): BehavioralFeatureVector {
  return {
    pointer: extractPointerFeatures(state),
    keyboard: extractKeyboardFeatures(state),
    form: extractFormFeatures(state),
    session: extractSessionFeatures(state),
    cdp: extractCDPFeatures(state),
  };
}

export interface BehavioralAnomalySummary {
  /** Number of dimensions with a non-trivial anomaly score (>= 0.25). */
  corroboratingDimensions: number;
  /** Maximum anomaly score across dimensions. */
  maxScore: number;
  /** Average anomaly score across dimensions. */
  meanScore: number;
  /** Combined list of all flags. */
  allFlags: string[];
  /** Dimensional breakdown. */
  vector: BehavioralFeatureVector;
}

export function summarizeBehavioralAnomaly(vector: BehavioralFeatureVector): BehavioralAnomalySummary {
  const dimensions = [vector.pointer, vector.keyboard, vector.form, vector.session, vector.cdp];
  const active = dimensions.filter(d => d.score >= 0.25);
  const allFlags = active.flatMap(d => d.flags);
  const scores = dimensions.map(d => d.score);
  const maxScore = Math.max(...scores);
  const meanScore = mean(scores);

  return {
    corroboratingDimensions: active.length,
    maxScore,
    meanScore,
    allFlags,
    vector,
  };
}
