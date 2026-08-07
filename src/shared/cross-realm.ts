/**
 * Cross-realm consistency engine.
 *
 * Collects overlapping observations from multiple execution realms (main window,
 * same-origin iframe, blob iframe, worker) and compares both values and
 * descriptors. The goal is to detect environments that patch individual
 * properties but fail to keep the fake state coherent across realms.
 */
import { finding, inconclusive, pass, type DetectionResult } from './detector-types';

export type RealmContext =
  | 'main'
  | 'same-origin-iframe'
  | 'blob-iframe'
  | 'sandboxed-iframe'
  | 'worker'
  | 'shared-worker'
  | 'offscreen-canvas';

export interface CrossRealmProbe {
  /** Stable probe identifier. */
  id: string;
  /** Category for scoring when this probe mismatches. */
  category: 'browser-integrity' | 'fingerprint' | 'worker' | 'other';
  /** Severity of a mismatch. */
  severity: 'weak' | 'medium' | 'strong';
  /** JavaScript expression that returns a JSON-serializable value in the realm. */
  expr: string;
  /** Optional comparator. Default is deep equality on the serialized value. */
  compare?: (a: unknown, b: unknown) => boolean;
  /** Human-readable description of what this probe measures. */
  description: string;
}

export interface RealmSnapshot {
  realm: RealmContext;
  /** Probe values collected in this realm. */
  values: Record<string, unknown>;
  /** Whether collection could not complete. */
  inconclusive?: boolean;
  /** Reason if collection failed. */
  reason?: string;
  /** Human-readable failure description. */
  description?: string;
}

export interface Mismatch {
  probe: CrossRealmProbe;
  referenceRealm: RealmContext;
  otherRealm: RealmContext;
  referenceValue: unknown;
  otherValue: unknown;
}

function defaultCompare(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const DEFAULT_PROBES: CrossRealmProbe[] = [
  { id: 'navigator:userAgent', category: 'browser-integrity', severity: 'strong', expr: 'navigator.userAgent', description: 'navigator.userAgent string' },
  { id: 'navigator:platform', category: 'browser-integrity', severity: 'medium', expr: 'navigator.platform', description: 'navigator.platform string' },
  { id: 'navigator:languages', category: 'browser-integrity', severity: 'medium', expr: 'JSON.stringify(navigator.languages || [])', description: 'navigator.languages array' },
  { id: 'navigator:hardwareConcurrency', category: 'browser-integrity', severity: 'medium', expr: 'navigator.hardwareConcurrency', description: 'navigator.hardwareConcurrency' },
  { id: 'navigator:deviceMemory', category: 'browser-integrity', severity: 'medium', expr: 'navigator.deviceMemory', description: 'navigator.deviceMemory' },
  { id: 'navigator:maxTouchPoints', category: 'browser-integrity', severity: 'medium', expr: 'navigator.maxTouchPoints', description: 'navigator.maxTouchPoints' },
  { id: 'navigator:vendor', category: 'browser-integrity', severity: 'medium', expr: 'navigator.vendor', description: 'navigator.vendor' },
  { id: 'screen:width', category: 'fingerprint', severity: 'weak', expr: 'screen.width', description: 'screen.width' },
  { id: 'screen:height', category: 'fingerprint', severity: 'weak', expr: 'screen.height', description: 'screen.height' },
  { id: 'window:devicePixelRatio', category: 'fingerprint', severity: 'weak', expr: 'devicePixelRatio', description: 'window.devicePixelRatio' },
  {
    id: 'webgl:vendorRenderer',
    category: 'fingerprint',
    severity: 'medium',
    expr: `(() => {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return null;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (!ext) return null;
        return { vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
      } catch (e) {
        return null;
      }
    })()`,
    description: 'WebGL vendor and renderer',
  },
  {
    id: 'intl:localeTimezone',
    category: 'browser-integrity',
    severity: 'weak',
    expr: `(() => {
      try {
        const opts = Intl.DateTimeFormat().resolvedOptions();
        return { locale: opts.locale, timeZone: opts.timeZone };
      } catch (e) {
        return null;
      }
    })()`,
    description: 'Intl locale and timezone',
  },
  {
    id: 'descriptor:navigator.webdriver',
    category: 'browser-integrity',
    severity: 'strong',
    expr: `(() => {
      try {
        const desc = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
        if (!desc) return { type: 'none' };
        if (desc.get) {
          return { type: 'getter', native: Function.prototype.toString.call(desc.get).includes('[native code]') };
        }
        return { type: 'data', value: desc.value };
      } catch (e) {
        return null;
      }
    })()`,
    description: 'navigator.webdriver property descriptor',
  },
  {
    id: 'descriptor:navigator.userAgent',
    category: 'browser-integrity',
    severity: 'medium',
    expr: `(() => {
      try {
        const desc = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
        if (!desc) return { type: 'none' };
        if (desc.get) {
          return { type: 'getter', native: Function.prototype.toString.call(desc.get).includes('[native code]') };
        }
        return { type: 'data', value: desc.value };
      } catch (e) {
        return null;
      }
    })()`,
    description: 'navigator.userAgent property descriptor',
  },
  {
    id: 'prototype:navigator',
    category: 'browser-integrity',
    severity: 'weak',
    expr: `(() => {
      try {
        return Object.prototype.toString.call(navigator);
      } catch (e) {
        return null;
      }
    })()`,
    description: 'Navigator prototype tag',
  },
];

function runProbeExpr(expr: string, globalObj: object = globalThis): unknown {
  try {
    const Fn = (globalObj as Record<string, unknown>).Function as typeof Function;
    const fn = new Fn('return (' + expr + ')') as () => unknown;
    return fn();
  } catch (e) {
    return { _error: (e as Error).message };
  }
}

export function collectMainObservations(probes = DEFAULT_PROBES): RealmSnapshot {
  const values: Record<string, unknown> = {};
  for (const probe of probes) {
    values[probe.id] = runProbeExpr(probe.expr);
  }
  return { realm: 'main', values };
}

function patchJsdomCanvas(win: Window): void {
  try {
    const ua = ((win as Record<string, unknown>).navigator as { userAgent?: string } | undefined)?.userAgent || '';
    if (!ua.includes('jsdom')) return;
    const htmlCanvas = (win as Record<string, unknown>).HTMLCanvasElement as unknown as { prototype: { getContext?: unknown } } | undefined;
    if (htmlCanvas && htmlCanvas.prototype) {
      htmlCanvas.prototype.getContext = function() {
        throw new Error('canvas not supported in this environment');
      };
    }
  } catch {}
}

function collectFromWindow(win: Window, probes = DEFAULT_PROBES): Record<string, unknown> {
  patchJsdomCanvas(win);
  const values: Record<string, unknown> = {};
  const fnCtor = (win as Record<string, unknown>).Function as typeof Function;
  for (const probe of probes) {
    try {
      const fn = new fnCtor('return (' + probe.expr + ')') as () => unknown;
      values[probe.id] = fn();
    } catch (e) {
      values[probe.id] = { _error: (e as Error).message };
    }
  }
  return values;
}

export function collectSameOriginIframeObservations(probes = DEFAULT_PROBES, timeoutMs = 2000): Promise<RealmSnapshot> {
  return new Promise((resolve) => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = 'about:blank';

      let resolved = false;
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        try { document.body.removeChild(iframe); } catch {}
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({ realm: 'same-origin-iframe', values: {}, inconclusive: true, reason: 'iframeTimeout', description: 'Same-origin iframe probe timed out' });
      }, timeoutMs);

      iframe.onload = () => {
        clearTimeout(timeoutId);
        try {
          const win = iframe.contentWindow;
          if (!win) throw new Error('iframe contentWindow is null');
          const values = collectFromWindow(win, probes);
          cleanup();
          resolve({ realm: 'same-origin-iframe', values });
        } catch (e) {
          cleanup();
          resolve({ realm: 'same-origin-iframe', values: {}, inconclusive: true, reason: 'iframeAccessError', description: `Same-origin iframe access failed: ${(e as Error).message}` });
        }
      };

      iframe.onerror = () => {
        clearTimeout(timeoutId);
        cleanup();
        resolve({ realm: 'same-origin-iframe', values: {}, inconclusive: true, reason: 'iframeLoadError', description: 'Same-origin iframe failed to load' });
      };

      document.body.appendChild(iframe);
    } catch (e) {
      resolve({ realm: 'same-origin-iframe', values: {}, inconclusive: true, reason: 'iframeException', description: `Same-origin iframe exception: ${(e as Error).message}` });
    }
  });
}

export function collectBlobIframeObservations(probes = DEFAULT_PROBES, timeoutMs = 2000): Promise<RealmSnapshot> {
  return new Promise((resolve) => {
    try {
      const html = '<!DOCTYPE html><html><head></head><body></body></html>';
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;

      let resolved = false;
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        try { URL.revokeObjectURL(url); } catch {}
        try { document.body.removeChild(iframe); } catch {}
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({ realm: 'blob-iframe', values: {}, inconclusive: true, reason: 'iframeTimeout', description: 'Blob iframe probe timed out' });
      }, timeoutMs);

      iframe.onload = () => {
        clearTimeout(timeoutId);
        try {
          const win = iframe.contentWindow;
          if (!win) throw new Error('blob iframe contentWindow is null');
          const values = collectFromWindow(win, probes);
          cleanup();
          resolve({ realm: 'blob-iframe', values });
        } catch (e) {
          cleanup();
          resolve({ realm: 'blob-iframe', values: {}, inconclusive: true, reason: 'iframeAccessError', description: `Blob iframe access failed: ${(e as Error).message}` });
        }
      };

      iframe.onerror = () => {
        clearTimeout(timeoutId);
        cleanup();
        resolve({ realm: 'blob-iframe', values: {}, inconclusive: true, reason: 'iframeLoadError', description: 'Blob iframe failed to load' });
      };

      document.body.appendChild(iframe);
    } catch (e) {
      resolve({ realm: 'blob-iframe', values: {}, inconclusive: true, reason: 'iframeException', description: `Blob iframe exception: ${(e as Error).message}` });
    }
  });
}

function buildWorkerScript(probes: CrossRealmProbe[]): string {
  const collectors = probes.map(p => {
    const safeExpr = p.expr.replace(/\/\*/g, '').replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    return `probes['${p.id}'] = (() => { try { return (${safeExpr}); } catch (e) { return { _error: e.message }; } })();`;
  }).join('\n');

  return `
    const probes = {};
    ${collectors}
    self.postMessage({ values: probes, realm: 'worker' });
  `;
}

export function collectWorkerObservations(probes = DEFAULT_PROBES, timeoutMs = 2000): Promise<RealmSnapshot> {
  return new Promise((resolve) => {
    try {
      if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
        resolve({ realm: 'worker', values: {}, inconclusive: true, reason: 'workerUnsupported', description: 'Web Workers not supported' });
        return;
      }

      const workerCode = buildWorkerScript(probes);
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const worker = new Worker(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const timeoutId = setTimeout(() => {
        worker.terminate();
        resolve({ realm: 'worker', values: {}, inconclusive: true, reason: 'workerTimeout', description: 'Worker probe timed out' });
      }, timeoutMs);

      worker.onmessage = (e) => {
        clearTimeout(timeoutId);
        worker.terminate();
        resolve({ realm: 'worker', values: (e.data as { values: Record<string, unknown> }).values });
      };

      worker.onerror = (e) => {
        clearTimeout(timeoutId);
        worker.terminate();
        resolve({ realm: 'worker', values: {}, inconclusive: true, reason: 'workerError', description: `Worker error: ${e.message}` });
      };

      worker.postMessage('start');
    } catch (e) {
      resolve({ realm: 'worker', values: {}, inconclusive: true, reason: 'workerException', description: `Worker exception: ${(e as Error).message}` });
    }
  });
}

export interface CrossRealmConsistencyResult {
  snapshots: RealmSnapshot[];
  mismatches: Mismatch[];
  /** Snapshots that could not be collected. */
  inconclusive: RealmSnapshot[];
}

function compareSnapshots(snapshots: RealmSnapshot[]): { mismatches: Mismatch[]; inconclusive: RealmSnapshot[] } {
  const mismatches: Mismatch[] = [];
  const inconclusive = snapshots.filter(s => s.inconclusive);

  // Use the first non-inconclusive snapshot as the reference. If all are main, that's fine.
  const reference = snapshots.find(s => !s.inconclusive);
  if (!reference) return { mismatches, inconclusive };

  for (const other of snapshots) {
    if (other === reference || other.inconclusive) continue;

    for (const probe of DEFAULT_PROBES) {
      const compare = probe.compare ?? defaultCompare;
      const a = reference.values[probe.id];
      const b = other.values[probe.id];
      if (!compare(a, b)) {
        mismatches.push({
          probe,
          referenceRealm: reference.realm,
          otherRealm: other.realm,
          referenceValue: a,
          otherValue: b,
        });
      }
    }
  }

  return { mismatches, inconclusive };
}

export async function runCrossRealmConsistency(): Promise<CrossRealmConsistencyResult> {
  const [main, sameOrigin, blob, worker] = await Promise.all([
    collectMainObservations(),
    collectSameOriginIframeObservations(),
    collectBlobIframeObservations(),
    collectWorkerObservations(),
  ]);

  const snapshots = [main, sameOrigin, blob, worker];
  const { mismatches, inconclusive } = compareSnapshots(snapshots);

  return { snapshots, mismatches, inconclusive };
}

export function crossRealmMismatchesToFindings(result: CrossRealmConsistencyResult): DetectionResult[] {
  const findings: DetectionResult[] = [];

  for (const snapshot of result.inconclusive) {
    findings.push(
      inconclusive(
        'browser-integrity',
        `cross-realm:${snapshot.realm}`,
        snapshot.realm,
        snapshot.reason ?? 'inconclusive',
        snapshot.description ?? `Could not collect ${snapshot.realm} observations`
      )
    );
  }

  const mismatchesByProbe = new Map<string, Mismatch[]>();
  for (const m of result.mismatches) {
    const list = mismatchesByProbe.get(m.probe.id) ?? [];
    list.push(m);
    mismatchesByProbe.set(m.probe.id, list);
  }

  for (const [probeId, mismatches] of mismatchesByProbe) {
    const probe = mismatches[0].probe;
    const involvedRealms = new Set<RealmContext>();
    for (const m of mismatches) {
      involvedRealms.add(m.referenceRealm);
      involvedRealms.add(m.otherRealm);
    }

    const evidence: Record<string, unknown> = {};
    for (const m of mismatches) {
      evidence[`${m.referenceRealm}->${m.otherRealm}`] = {
        reference: m.referenceValue,
        other: m.otherValue,
      };
    }

    findings.push(
      finding(
        probe.severity,
        probe.category,
        `cross-realm:${probeId}`,
        'main',
        'cross-realm-mismatch',
        `Cross-realm inconsistency in ${probe.description} across ${Array.from(involvedRealms).join(', ')}`,
        evidence
      )
    );
  }

  if (findings.length === 0) {
    findings.push(
      pass('browser-integrity', 'cross-realm:consistent', 'main', 'cross-realm-consistent', 'Cross-realm observations are consistent')
    );
  }

  return findings;
}
