/**
 * Cross-realm consistency engine.
 *
 * Collects overlapping observations from multiple execution realms (main window,
 * same-origin iframe, blob iframe, worker, shared worker) and compares both
 * values and descriptors. Each probe declares the realms in which it is valid,
 * so a missing API in an unrelated realm is not treated as a mismatch.
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
  /** Realms in which this probe is valid and expected to produce a value. */
  realms: RealmContext[];
  /** Default expression used for any realm not overridden by `exprByRealm`. */
  expr?: string;
  /** Realm-specific expression overrides (e.g. OffscreenCanvas in workers). */
  exprByRealm?: Partial<Record<RealmContext, string>>;
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

export interface ProbeError {
  probe: CrossRealmProbe;
  realm: RealmContext;
  error: unknown;
}

function defaultCompare(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const WEBGL_DOM_EXPR = `(() => {
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
})()`;

const WEBGL_OFFSCREEN_EXPR = `(() => {
  try {
    if (typeof OffscreenCanvas === 'undefined') return { _notApplicable: true };
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return null;
    return { vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
  } catch (e) {
    return { _error: e.message };
  }
})()`;

const INTL_LOCALE_TZ_EXPR = `(() => {
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions();
    return { locale: opts.locale, timeZone: opts.timeZone };
  } catch (e) {
    return null;
  }
})()`;

const WEBDRIVER_DESCRIPTOR_EXPR = `(() => {
  try {
    const desc = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
    if (!desc) return { type: 'none' };
    if (desc.get) {
      return { type: 'getter', native: Function.prototype.toString.call(desc.get).includes('[native code]') };
    }
    return { type: 'data', value: desc.value };
  } catch (e) {
    return { _error: e.message };
  }
})()`;

const USERAGENT_DESCRIPTOR_EXPR = `(() => {
  try {
    const desc = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
    if (!desc) return { type: 'none' };
    if (desc.get) {
      return { type: 'getter', native: Function.prototype.toString.call(desc.get).includes('[native code]') };
    }
    return { type: 'data', value: desc.value };
  } catch (e) {
    return { _error: e.message };
  }
})()`;

const NAVIGATOR_TAG_EXPR = `(() => {
  try {
    return Object.prototype.toString.call(navigator);
  } catch (e) {
    return null;
  }
})()`;

const USER_AGENT_DATA_EXPR = `(() => {
  try {
    const uad = navigator.userAgentData;
    if (!uad) return { _notApplicable: true };
    return JSON.stringify({
      brands: uad.brands,
      platform: uad.platform,
      mobile: uad.mobile,
    });
  } catch (e) {
    return { _error: e.message };
  }
})()`;

export const DEFAULT_PROBES: CrossRealmProbe[] = [
  {
    id: 'navigator:userAgent',
    category: 'browser-integrity',
    severity: 'strong',
    realms: ['main', 'same-origin-iframe', 'blob-iframe', 'worker', 'shared-worker'],
    expr: 'navigator.userAgent',
    description: 'navigator.userAgent string',
  },
  {
    id: 'navigator:platform',
    category: 'browser-integrity',
    severity: 'medium',
    realms: ['main', 'same-origin-iframe', 'blob-iframe', 'worker', 'shared-worker'],
    expr: 'navigator.platform',
    description: 'navigator.platform string',
  },
  {
    id: 'navigator:languages',
    category: 'browser-integrity',
    severity: 'medium',
    realms: ['main', 'same-origin-iframe', 'blob-iframe', 'worker', 'shared-worker'],
    expr: 'JSON.stringify(navigator.languages || [])',
    description: 'navigator.languages array',
  },
  {
    id: 'navigator:hardwareConcurrency',
    category: 'browser-integrity',
    severity: 'medium',
    realms: ['main', 'same-origin-iframe', 'blob-iframe', 'worker', 'shared-worker'],
    expr: 'navigator.hardwareConcurrency',
    description: 'navigator.hardwareConcurrency',
  },
  {
    id: 'navigator:userAgentData',
    category: 'browser-integrity',
    severity: 'medium',
    realms: ['main', 'same-origin-iframe', 'blob-iframe', 'worker', 'shared-worker'],
    expr: USER_AGENT_DATA_EXPR,
    description: 'Low-entropy navigator.userAgentData',
  },
  {
    id: 'navigator:deviceMemory',
    category: 'browser-integrity',
    severity: 'medium',
    realms: ['main', 'same-origin-iframe', 'blob-iframe'],
    expr: 'navigator.deviceMemory',
    description: 'navigator.deviceMemory',
  },
  {
    id: 'navigator:maxTouchPoints',
    category: 'browser-integrity',
    severity: 'medium',
    realms: ['main', 'same-origin-iframe', 'blob-iframe'],
    expr: 'navigator.maxTouchPoints',
    description: 'navigator.maxTouchPoints',
  },
  {
    id: 'navigator:vendor',
    category: 'browser-integrity',
    severity: 'medium',
    realms: ['main', 'same-origin-iframe', 'blob-iframe'],
    expr: 'navigator.vendor',
    description: 'navigator.vendor',
  },
  {
    id: 'screen:width',
    category: 'fingerprint',
    severity: 'weak',
    realms: ['main', 'same-origin-iframe', 'blob-iframe'],
    expr: 'screen.width',
    description: 'screen.width',
  },
  {
    id: 'screen:height',
    category: 'fingerprint',
    severity: 'weak',
    realms: ['main', 'same-origin-iframe', 'blob-iframe'],
    expr: 'screen.height',
    description: 'screen.height',
  },
  {
    id: 'window:devicePixelRatio',
    category: 'fingerprint',
    severity: 'weak',
    realms: ['main', 'same-origin-iframe', 'blob-iframe'],
    expr: 'devicePixelRatio',
    description: 'window.devicePixelRatio',
  },
  {
    id: 'webgl:vendorRenderer',
    category: 'fingerprint',
    severity: 'medium',
    realms: ['main', 'same-origin-iframe', 'blob-iframe', 'worker', 'shared-worker'],
    expr: WEBGL_DOM_EXPR,
    exprByRealm: {
      worker: WEBGL_OFFSCREEN_EXPR,
      'shared-worker': WEBGL_OFFSCREEN_EXPR,
    },
    description: 'WebGL vendor and renderer',
  },
  {
    id: 'intl:localeTimezone',
    category: 'browser-integrity',
    severity: 'weak',
    realms: ['main', 'same-origin-iframe', 'blob-iframe', 'worker', 'shared-worker'],
    expr: INTL_LOCALE_TZ_EXPR,
    description: 'Intl locale and timezone',
  },
  {
    id: 'descriptor:navigator.webdriver',
    category: 'browser-integrity',
    severity: 'strong',
    realms: ['main', 'same-origin-iframe', 'blob-iframe', 'worker', 'shared-worker'],
    expr: WEBDRIVER_DESCRIPTOR_EXPR,
    description: 'navigator.webdriver property descriptor',
  },
  {
    id: 'descriptor:navigator.userAgent',
    category: 'browser-integrity',
    severity: 'medium',
    realms: ['main', 'same-origin-iframe', 'blob-iframe', 'worker', 'shared-worker'],
    expr: USERAGENT_DESCRIPTOR_EXPR,
    description: 'navigator.userAgent property descriptor',
  },
  {
    id: 'prototype:navigator',
    category: 'browser-integrity',
    severity: 'weak',
    realms: ['main', 'same-origin-iframe', 'blob-iframe'],
    expr: NAVIGATOR_TAG_EXPR,
    compare: (a, b) => {
      // WorkerNavigator instances may legitimately report a different tag than
      // a window Navigator, so this probe is only compared across window realms.
      const normalize = (v: unknown) => String(v).replace(/^\[object (?:Worker)?/, '[object ');
      return normalize(a) === normalize(b);
    },
    description: 'Navigator prototype tag',
  },
];

function probeExprForRealm(probe: CrossRealmProbe, realm: RealmContext): string | undefined {
  return probe.exprByRealm?.[realm] ?? probe.expr;
}

function isErrorValue(value: unknown): value is { _error: string } {
  return typeof value === 'object' && value !== null && '_error' in value;
}

function isNotApplicable(value: unknown): value is { _notApplicable: true } {
  return typeof value === 'object' && value !== null && '_notApplicable' in value;
}

function isValidObservation(snapshot: RealmSnapshot, probeId: string): boolean {
  if (!(probeId in snapshot.values)) return false;
  const value = snapshot.values[probeId];
  return !isErrorValue(value) && !isNotApplicable(value);
}

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
    if (!probe.realms.includes('main')) {
      values[probe.id] = { _notApplicable: true };
      continue;
    }
    const expr = probeExprForRealm(probe, 'main');
    if (!expr) {
      values[probe.id] = { _error: 'no expression for realm' };
    } else {
      values[probe.id] = runProbeExpr(expr);
    }
  }
  return { realm: 'main', values };
}

function patchJsdomCanvas(win: Window): void {
  try {
    const ua = ((win as Record<string, unknown>).navigator as { userAgent?: string } | undefined)?.userAgent || '';
    if (!ua.includes('jsdom')) return;
    const htmlCanvas = (win as Record<string, unknown>).HTMLCanvasElement as unknown as { prototype: { getContext?: unknown } } | undefined;
    if (htmlCanvas && htmlCanvas.prototype) {
      htmlCanvas.prototype.getContext = function () {
        throw new Error('canvas not supported in this environment');
      };
    }
  } catch {}
}

function collectFromWindow(win: Window, realm: RealmContext, probes = DEFAULT_PROBES): Record<string, unknown> {
  patchJsdomCanvas(win);
  const values: Record<string, unknown> = {};
  const fnCtor = (win as Record<string, unknown>).Function as typeof Function;
  for (const probe of probes) {
    if (!probe.realms.includes(realm)) {
      values[probe.id] = { _notApplicable: true };
      continue;
    }
    const expr = probeExprForRealm(probe, realm);
    if (!expr) {
      values[probe.id] = { _error: 'no expression for realm' };
      continue;
    }
    try {
      const fn = new fnCtor('return (' + expr + ')') as () => unknown;
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
          const values = collectFromWindow(win, 'same-origin-iframe', probes);
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
          const values = collectFromWindow(win, 'blob-iframe', probes);
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

function buildWorkerScript(realm: RealmContext, probes: CrossRealmProbe[]): string {
  const applicable = probes.filter((p) => p.realms.includes(realm));
  const collectors = applicable
    .map((p) => {
      const expr = probeExprForRealm(p, realm);
      if (!expr) return `  // no expression for ${p.id}`;
      const safeExpr = expr.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
      return `  values[${JSON.stringify(p.id)}] = (() => { try { return (${safeExpr}); } catch (e) { return { _error: e.message }; } })();`;
    })
    .join('\n');

  if (realm === 'shared-worker') {
    return `
self.onconnect = function(e) {
  const port = e.ports[0];
  const values = {};
${collectors}
  port.postMessage({ values, realm: ${JSON.stringify(realm)} });
};
`;
  }

  return `
self.onmessage = function(e) {
  const values = {};
${collectors}
  self.postMessage({ values, realm: ${JSON.stringify(realm)} });
};
`;
}

export function collectWorkerObservations(probes = DEFAULT_PROBES, timeoutMs = 2000): Promise<RealmSnapshot> {
  return new Promise((resolve) => {
    try {
      if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
        resolve({ realm: 'worker', values: {}, inconclusive: true, reason: 'workerUnsupported', description: 'Web Workers not supported' });
        return;
      }

      const workerCode = buildWorkerScript('worker', probes);
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

export function collectSharedWorkerObservations(probes = DEFAULT_PROBES, timeoutMs = 2000): Promise<RealmSnapshot> {
  return new Promise((resolve) => {
    try {
      if (typeof SharedWorker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
        resolve({ realm: 'shared-worker', values: {}, inconclusive: true, reason: 'sharedWorkerUnsupported', description: 'SharedWorker not supported' });
        return;
      }

      const workerCode = buildWorkerScript('shared-worker', probes);
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const worker = new SharedWorker(blobUrl);

      let resolved = false;
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        try { URL.revokeObjectURL(blobUrl); } catch {}
        try { worker.port.close(); } catch {}
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({ realm: 'shared-worker', values: {}, inconclusive: true, reason: 'sharedWorkerTimeout', description: 'SharedWorker probe timed out' });
      }, timeoutMs);

      worker.port.onmessage = (e) => {
        cleanup();
        clearTimeout(timeoutId);
        resolve({ realm: 'shared-worker', values: (e.data as { values: Record<string, unknown> }).values });
      };

      worker.port.onmessageerror = (e) => {
        cleanup();
        clearTimeout(timeoutId);
        resolve({ realm: 'shared-worker', values: {}, inconclusive: true, reason: 'sharedWorkerMessageError', description: `SharedWorker message error: ${(e as MessageEvent).data ?? 'unknown'}` });
      };

      worker.onerror = (e) => {
        cleanup();
        clearTimeout(timeoutId);
        resolve({ realm: 'shared-worker', values: {}, inconclusive: true, reason: 'sharedWorkerError', description: `SharedWorker error: ${e.message}` });
      };

      worker.port.start();
    } catch (e) {
      resolve({ realm: 'shared-worker', values: {}, inconclusive: true, reason: 'sharedWorkerException', description: `SharedWorker exception: ${(e as Error).message}` });
    }
  });
}

export interface CrossRealmConsistencyResult {
  snapshots: RealmSnapshot[];
  mismatches: Mismatch[];
  /** Snapshots that could not be collected at all. */
  inconclusive: RealmSnapshot[];
  /** Per-probe errors in otherwise-collected realms. */
  probeErrors?: ProbeError[];
}

export function compareSnapshots(snapshots: RealmSnapshot[], probes = DEFAULT_PROBES): { mismatches: Mismatch[]; inconclusive: RealmSnapshot[]; probeErrors: ProbeError[] } {
  const mismatches: Mismatch[] = [];
  const inconclusive = snapshots.filter((s) => s.inconclusive);
  const probeErrors: ProbeError[] = [];

  const comparable = snapshots.filter((s) => !s.inconclusive);

  for (const probe of probes) {
    const applicable = comparable.filter((s) => probe.realms.includes(s.realm));
    const valid: { snapshot: RealmSnapshot; value: unknown }[] = [];
    const errors: { snapshot: RealmSnapshot; value: { _error: string } }[] = [];

    for (const s of applicable) {
      const value = s.values[probe.id];
      if (isValidObservation(s, probe.id)) {
        valid.push({ snapshot: s, value });
      } else if (isErrorValue(value)) {
        errors.push({ snapshot: s, value });
      }
    }

    if (valid.length >= 2) {
      const compare = probe.compare ?? defaultCompare;
      const reference = valid[0];
      let mismatchFound = false;
      for (let i = 1; i < valid.length; i++) {
        if (!compare(reference.value, valid[i].value)) {
          mismatches.push({
            probe,
            referenceRealm: reference.snapshot.realm,
            otherRealm: valid[i].snapshot.realm,
            referenceValue: reference.value,
            otherValue: valid[i].value,
          });
          mismatchFound = true;
        }
      }
      if (!mismatchFound && errors.length > 0) {
        for (const e of errors) {
          probeErrors.push({ probe, realm: e.snapshot.realm, error: e.value });
        }
      }
    } else if (valid.length >= 1 && errors.length > 0) {
      for (const e of errors) {
        probeErrors.push({ probe, realm: e.snapshot.realm, error: e.value });
      }
    } else if (valid.length === 0 && errors.length > 0) {
      for (const e of errors) {
        probeErrors.push({ probe, realm: e.snapshot.realm, error: e.value });
      }
    }
  }

  return { mismatches, inconclusive, probeErrors };
}

export async function runCrossRealmConsistency(): Promise<CrossRealmConsistencyResult> {
  const [main, sameOrigin, blob, worker, sharedWorker] = await Promise.all([
    collectMainObservations(),
    collectSameOriginIframeObservations(),
    collectBlobIframeObservations(),
    collectWorkerObservations(),
    collectSharedWorkerObservations(),
  ]);

  const snapshots = [main, sameOrigin, blob, worker, sharedWorker];
  const { mismatches, inconclusive, probeErrors } = compareSnapshots(snapshots);

  return { snapshots, mismatches, inconclusive, probeErrors };
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

  const mismatchProbeIds = new Set<string>();
  const mismatchesByProbe = new Map<string, Mismatch[]>();
  for (const m of result.mismatches) {
    mismatchProbeIds.add(m.probe.id);
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

  for (const pe of result.probeErrors ?? []) {
    if (mismatchProbeIds.has(pe.probe.id)) continue;
    findings.push(
      inconclusive(
        'browser-integrity',
        `cross-realm:${pe.probe.id}`,
        pe.realm,
        'probe-error',
        `Could not evaluate ${pe.probe.description} in ${pe.realm}: ${(pe.error as { _error: string })._error ?? 'unknown'}`
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
