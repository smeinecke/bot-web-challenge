/**
 * Shared detector registry.
 *
 * The registry is the single source of truth for which detectors run on each
 * page, their stable IDs, categories, contexts, severity, and execution
 * metadata. The runner normalizes every result to a `DetectionResult`, handles
 * timeouts and exceptions, and never silently converts failures to a pass.
 */
import type {
  DetectionCategory,
  DetectionContext,
  DetectionEvidence,
  DetectionResult,
  DetectionSeverity,
  DetectorResults,
  RawObjectFinding,
  RawDetectorValue,
} from './detector-types';
import { finding, inconclusive, pass } from './detector-types';
import * as browserChecks from './browser-checks';
import * as workerChecks from './worker-checks';
import * as interactionChecks from './interaction-checks';
import * as crossRealm from './cross-realm';
import * as gpuCoherence from './gpu-coherence';

export interface DetectorRegistryEntry {
  id: string;
  /** Stable artifact ID used for evidence-fusion. */
  artifactId: string;
  /** Logical category for independent-category scoring. */
  category: DetectionCategory;
  /** Realm/context where the detector runs. */
  context: DetectionContext;
  /** Whether this check is critical for coverage confidence. */
  critical: boolean;
  /** True if the check is async. */
  isAsync: boolean;
  /** Optional timeout in milliseconds. */
  timeoutMs?: number;
  /** Detector-specific description used when a boolean/object has no description. */
  description?: string;
  /** Default severity for a boolean `true` result. */
  defaultSeverity?: DetectionSeverity;
  /**
   * What to do when the detector reports an unsupported API.
   * `pass` means "not applicable"; `inconclusive` (default) means coverage reduced.
   */
  unsupportedPolicy?: 'pass' | 'inconclusive';
  /** The detection function. May return the old boolean/object shape or new structured results. */
  run: () => RawDetectorValue | Promise<RawDetectorValue>;
  /** Optional custom normalization. If omitted, `defaultNormalize` is used. */
  normalize?: (value: unknown, entry: DetectorRegistryEntry) => DetectionResult[];
}

type RawObjectValue = boolean | RawObjectFinding | null | undefined;

function isDetectionResult(value: unknown): value is DetectionResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'severity' in value &&
    'artifactId' in value &&
    'context' in value &&
    'reason' in value &&
    'description' in value
  );
}

function normalizeSeverity(
  severity: unknown,
  weak?: boolean,
  fallback: DetectionSeverity = 'medium'
): DetectionSeverity {
  const knownSeverities: DetectionSeverity[] = ['info', 'weak', 'medium', 'strong', 'hard'];
  if (typeof severity === 'string' && knownSeverities.includes(severity as DetectionSeverity)) {
    return severity as DetectionSeverity;
  }
  if (weak === true) return 'weak';
  return fallback;
}

function evidenceFromObject(obj: RawObjectFinding): DetectionEvidence {
  const evidence: DetectionEvidence = {};
  const skip = new Set([
    'reason',
    'description',
    'weak',
    'severity',
    'category',
    'inconclusive',
    'confidence',
    'evidence',
    'findings',
    'artifactId',
  ]);
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k)) continue;
    evidence[k] = v;
  }
  return evidence;
}

function looksLikeFailure(value: RawObjectValue): boolean {
  if (!value || typeof value !== 'object') return false;
  const obj = value as RawObjectFinding;
  return (
    obj.inconclusive === true ||
    obj.reason === 'exception' ||
    obj.reason === 'timeout' ||
    obj.reason === 'workerError' ||
    obj.reason === 'workerTimeout' ||
    obj.reason === 'processingError' ||
    (obj.notSupported === true)
  );
}

/**
 * Default normalization for legacy detectors.
 *
 * - Boolean `true` -> finding with the registry's default severity.
 * - `false`/`null`/`undefined` -> passed.
 * - Object with `findings: DetectionResult[]` -> those findings.
 * - Object with failure reason -> inconclusive.
 * - Other objects -> finding, using explicit severity/category/artifactId if present.
 */
export function defaultNormalize(value: unknown, entry: DetectorRegistryEntry): DetectionResult[] {
  if (Array.isArray(value) && value.every(isDetectionResult)) {
    return (value as DetectionResult[]).map(f => ({ ...f, detectorId: entry.id }));
  }

  if (isDetectionResult(value)) {
    return [{ ...value, detectorId: entry.id }];
  }

  if (value === true) {
    const severity = entry.defaultSeverity ?? 'medium';
    return [
      finding(
        severity,
        entry.category,
        entry.artifactId,
        entry.context,
        'detected',
        entry.description ?? `${entry.id} detected`
      ),
    ];
  }

  if (value === false || value === null || value === undefined) {
    return [
      pass(
        entry.category,
        entry.artifactId,
        entry.context,
        'no-finding',
        entry.description ?? `${entry.id} passed`
      ),
    ];
  }

  if (typeof value === 'object' && value !== null) {
    const obj = value as RawObjectFinding;

    if (Array.isArray(obj.findings) && obj.findings.every(isDetectionResult)) {
      return obj.findings.map(f => ({ ...f, detectorId: entry.id }));
    }

    const unsupported = obj.notSupported === true || obj.reason === 'notSupported';
    if (unsupported && entry.unsupportedPolicy === 'pass') {
      return [
        pass(
          entry.category,
          entry.artifactId,
          entry.context,
          'not-applicable',
          `${entry.id} not applicable in this environment`
        ),
      ];
    }

    if (looksLikeFailure(obj)) {
      return [
        inconclusive(
          entry.category,
          entry.artifactId,
          entry.context,
          (obj.reason as string) ?? 'inconclusive',
          obj.description ?? `${entry.id} could not complete`
        ),
      ];
    }

    const severity = normalizeSeverity(obj.severity, obj.weak, entry.defaultSeverity ?? 'medium');
    const category = (obj.category as DetectionCategory | undefined) ?? entry.category;
    const artifactId = (obj.artifactId as string | undefined) ?? entry.artifactId;
    const reason = (obj.reason as string | undefined) ?? 'detected';

    return [
      finding(
        severity,
        category,
        artifactId,
        entry.context,
        reason,
        obj.description ?? `${entry.id} detected`,
        evidenceFromObject(obj)
      ),
    ];
  }

  return [
    pass(
      entry.category,
      entry.artifactId,
      entry.context,
      'no-finding',
      entry.description ?? `${entry.id} passed`
    ),
  ];
}

function headlessResolutionNormalize(value: unknown, entry: DetectorRegistryEntry): DetectionResult[] {
  if (!value || typeof value !== 'object') return defaultNormalize(value, entry);
  const obj = value as RawObjectFinding;
  if (obj.match || obj.match === 0) {
    return [
      finding(
        'medium',
        'environment',
        'screen-resolution:default',
        'main',
        'default-headless-resolution',
        obj.description as string ?? 'Screen resolution matches a known headless default',
        evidenceFromObject(obj)
      ),
    ];
  }
  if (obj.reason === 'extremeAspect') {
    return [
      finding(
        'weak',
        'environment',
        'screen-resolution:extreme-aspect',
        'main',
        'extreme-aspect-ratio',
        obj.description as string ?? 'Screen aspect ratio is extreme',
        evidenceFromObject(obj)
      ),
    ];
  }
  return defaultNormalize(value, entry);
}

function webGLNormalize(value: unknown, entry: DetectorRegistryEntry): DetectionResult[] {
  if (!value || typeof value !== 'object') return defaultNormalize(value, entry);
  const obj = value as RawObjectFinding;
  if (obj.reason === 'softwareRenderer') {
    return [
      finding(
        'medium',
        'fingerprint',
        'webgl:software-renderer',
        'main',
        'software-renderer',
        obj.description as string ?? 'Software WebGL renderer detected',
        evidenceFromObject(obj)
      ),
    ];
  }
  if (obj.reason === 'missingInfo') {
    return [
      finding(
        'weak',
        'fingerprint',
        'webgl:missing-info',
        'main',
        'missing-webgl-info',
        obj.description as string ?? 'WebGL vendor/renderer info missing',
        evidenceFromObject(obj)
      ),
    ];
  }
  return defaultNormalize(value, entry);
}

function gpuFeaturesNormalize(value: unknown, entry: DetectorRegistryEntry): DetectionResult[] {
  if (!value || typeof value !== 'object') return defaultNormalize(value, entry);
  const obj = value as RawObjectFinding;
  if (obj.reason === 'veryLowLimits') {
    return [
      finding(
        'medium',
        'fingerprint',
        'gpu-features:low-limits',
        'main',
        'very-low-limits',
        obj.description as string ?? 'Very low GPU limits suggest software rendering',
        evidenceFromObject(obj)
      ),
    ];
  }
  return defaultNormalize(value, entry);
}

function audioNormalize(value: unknown, entry: DetectorRegistryEntry): DetectionResult[] {
  if (!value || typeof value !== 'object') return defaultNormalize(value, entry);
  const obj = value as RawObjectFinding;
  if (obj.reason === 'suspiciousSum') {
    return [
      finding(
        'weak',
        'fingerprint',
        'audio:suspicious-sum',
        'main',
        'suspicious-audio-sum',
        obj.description as string ?? 'Audio fingerprint indicates a headless/sandboxed environment',
        evidenceFromObject(obj)
      ),
    ];
  }
  return defaultNormalize(value, entry);
}

function canvasNormalize(value: unknown, entry: DetectorRegistryEntry): DetectionResult[] {
  if (!value || typeof value !== 'object') return defaultNormalize(value, entry);
  const obj = value as RawObjectFinding;
  if (obj.weak === true) {
    return [
      finding(
        'weak',
        'fingerprint',
        'canvas:availability',
        'main',
        (obj.reason as string) ?? 'canvas-issue',
        obj.description as string ?? 'Canvas API availability issue',
        evidenceFromObject(obj)
      ),
    ];
  }
  return defaultNormalize(value, entry);
}

function pluginsNormalize(value: unknown, entry: DetectorRegistryEntry): DetectionResult[] {
  if (!value || typeof value !== 'object') return defaultNormalize(value, entry);
  const obj = value as RawObjectFinding;
  if (obj.reason === 'pluginsGetterPatched') {
    return [
      finding(
        'medium',
        'browser-integrity',
        'plugins:getter-patched',
        'main',
        'plugins-getter-patched',
        obj.description as string ?? 'navigator.plugins getter has been tampered with',
        evidenceFromObject(obj)
      ),
    ];
  }
  if (obj.reason) {
    return [
      finding(
        'weak',
        'browser-integrity',
        'plugins:anomaly',
        'main',
        (obj.reason as string),
        obj.description as string ?? 'navigator.plugins/mimeTypes anomaly',
        evidenceFromObject(obj)
      ),
    ];
  }
  return defaultNormalize(value, entry);
}

function chromeObjectNormalize(value: unknown, entry: DetectorRegistryEntry): DetectionResult[] {
  if (!value || typeof value !== 'object') return defaultNormalize(value, entry);
  const obj = value as RawObjectFinding;
  if (obj.reason === 'chromeMissing') {
    return [
      finding(
        'medium',
        'browser-integrity',
        'chrome-object:missing',
        'main',
        'chrome-missing',
        obj.description as string ?? 'window.chrome missing on Chromium browser',
        evidenceFromObject(obj)
      ),
    ];
  }
  if (obj.reason === 'chromeShallow') {
    return [
      finding(
        'weak',
        'browser-integrity',
        'chrome-object:shallow',
        'main',
        'chrome-shallow',
        obj.description as string ?? 'window.chrome exists but has no expected subobjects',
        evidenceFromObject(obj)
      ),
    ];
  }
  return defaultNormalize(value, entry);
}

function headlessChromeNormalize(value: unknown, entry: DetectorRegistryEntry): DetectionResult[] {
  if (!value || typeof value !== 'object') return defaultNormalize(value, entry);
  const obj = value as RawObjectFinding;
  if (obj.indicators && Array.isArray(obj.indicators) && obj.indicators.length > 0) {
    return [
      finding(
        'medium',
        'environment',
        'headless-chrome',
        'main',
        'headless-chrome-indicators',
        obj.description as string ?? 'Headless Chrome indicators detected',
        evidenceFromObject(obj)
      ),
    ];
  }
  return defaultNormalize(value, entry);
}

function userAgentNormalize(value: unknown, entry: DetectorRegistryEntry): DetectionResult[] {
  if (!value || typeof value !== 'object') return defaultNormalize(value, entry);
  const obj = value as RawObjectFinding;
  if (obj.confidence === 'high' || obj.confidence === 'medium') {
    return [
      finding(
        'strong',
        'automation-global',
        'user-agent:automation',
        'main',
        (obj.rule as string) ?? 'bot-user-agent',
        obj.description as string ?? 'User-Agent matches a known bot pattern',
        evidenceFromObject(obj)
      ),
    ];
  }
  return defaultNormalize(value, entry);
}

export interface DetectorRunResults {
  rawResults: DetectorResults;
  findings: DetectionResult[];
}

export async function runDetectors(entries: DetectorRegistryEntry[]): Promise<DetectorRunResults> {
  const rawResults: DetectorResults = {};
  const findings: DetectionResult[] = [];

  await Promise.all(
    entries.map(async (entry) => {
      let raw: RawDetectorValue = false;
      let entryFindings: DetectionResult[] = [];

      try {
        const start = performance.now();
        const promiseOrValue = entry.run();
        let value: unknown;

        if (promiseOrValue instanceof Promise) {
          const timeoutMs = entry.timeoutMs ?? 3000;
          value = await Promise.race([
            promiseOrValue,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('detector-timeout')), timeoutMs)
            ),
          ]);
        } else {
          value = promiseOrValue;
        }

        raw = value as RawDetectorValue;

        const normalize = entry.normalize ?? defaultNormalize;
        entryFindings = normalize(raw, entry).map(f => ({
          ...f,
          detectorId: entry.id,
          critical: entry.critical,
          raw,
        }));

        const elapsed = performance.now() - start;
        if (elapsed > 500 && !entryFindings.some(f => f.status !== 'passed')) {
          // Long running detectors that passed are still valid.
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        entryFindings = [
          {
            ...inconclusive(
              entry.category,
              entry.artifactId,
              entry.context,
              'detector-exception',
              `${entry.id} threw an exception: ${message}`
            ),
            detectorId: entry.id,
            critical: entry.critical,
          },
        ];
        raw = { inconclusive: true, reason: 'exception', description: message };
      }

      rawResults[entry.id] = raw;
      findings.push(...entryFindings);
    })
  );

  return { rawResults, findings };
}

const STATIC_REGISTRY: DetectorRegistryEntry[] = [
  {
    id: 'hasBotUserAgent',
    artifactId: 'user-agent:automation',
    category: 'automation-global',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'User-Agent matches a known bot pattern',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkBotUserAgent(),
    normalize: userAgentNormalize,
  },
  {
    id: 'hasWebdriverTrue',
    artifactId: 'webdriver:true',
    category: 'webdriver',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'navigator.webdriver === true',
    defaultSeverity: 'hard',
    run: () => browserChecks.checkWebdriver(),
  },
  {
    id: 'hasWebdriverNull',
    artifactId: 'webdriver:null',
    category: 'webdriver',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'navigator.webdriver === null',
    defaultSeverity: 'hard',
    run: () => browserChecks.checkWebdriverNull(),
  },
  {
    id: 'hasWebdriverInFrameTrue',
    artifactId: 'webdriver:iframe-true',
    category: 'webdriver',
    context: 'iframe',
    critical: true,
    isAsync: false,
    description: 'navigator.webdriver === true inside a same-origin iframe',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkWebdriverInFrame(),
  },
  {
    id: 'isPlaywright',
    artifactId: 'automation-global:playwright',
    category: 'automation-global',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'Playwright-specific globals detected',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkPlaywright(),
  },
  {
    id: 'hasInconsistentChromeObject',
    artifactId: 'chrome-object',
    category: 'browser-integrity',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Inconsistent window.chrome object on Chromium',
    defaultSeverity: 'weak',
    run: () => browserChecks.checkInconsistentChrome(),
    normalize: chromeObjectNormalize,
  },
  {
    id: 'isPhantom',
    artifactId: 'automation-global:phantomjs',
    category: 'automation-global',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'PhantomJS globals detected',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkPhantomJS(),
  },
  {
    id: 'isNightmare',
    artifactId: 'automation-global:nightmare',
    category: 'automation-global',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'Nightmare.js global detected',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkNightmare(),
  },
  {
    id: 'isSequentum',
    artifactId: 'automation-global:sequentum',
    category: 'automation-global',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'Sequentum scraping platform detected',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkSequentum(),
  },
  {
    id: 'isSeleniumChromeDefault',
    artifactId: 'automation-marker:selenium-chrome-default',
    category: 'cdp',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'Selenium ChromeDriver CDC markers detected',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkSeleniumChromeDefault(),
  },
  {
    id: 'isHeadlessChrome',
    artifactId: 'headless-chrome',
    category: 'environment',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Headless Chrome indicators',
    defaultSeverity: 'medium',
    run: () => browserChecks.checkHeadlessChrome(),
    normalize: headlessChromeNormalize,
  },
  {
    id: 'isWebGLInconsistent',
    artifactId: 'webgl',
    category: 'fingerprint',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'WebGL vendor/renderer inconsistency',
    defaultSeverity: 'medium',
    run: () => browserChecks.checkWebGLInconsistent(),
    normalize: webGLNormalize,
  },
  {
    id: 'isAutomatedWithCDP',
    artifactId: 'automation-marker:cdp-global',
    category: 'cdp',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'CDP automation globals detected',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkAutomatedWithCDP(),
  },
  {
    id: 'hasInconsistentClientHints',
    artifactId: 'client-hints:inconsistent',
    category: 'api-integrity',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'User-Agent Client Hints inconsistent with User-Agent string',
    defaultSeverity: 'medium',
    run: () => browserChecks.checkInconsistentClientHints(),
  },
  {
    id: 'hasInconsistentGPUFeatures',
    artifactId: 'gpu-features',
    category: 'fingerprint',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'GPU feature limits inconsistent with real hardware',
    defaultSeverity: 'medium',
    run: () => browserChecks.checkInconsistentGPUFeatures(),
    normalize: gpuFeaturesNormalize,
  },
  {
    id: 'isIframeOverridden',
    artifactId: 'iframe:overridden',
    category: 'browser-integrity',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'Anti-detection script overriding iframe behavior',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkIframeOverridden(),
  },
  {
    id: 'hasHighHardwareConcurrency',
    artifactId: 'hardware:high-concurrency',
    category: 'environment',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Unusually high CPU core count',
    defaultSeverity: 'weak',
    run: () => browserChecks.checkHighHardwareConcurrency(),
  },
  {
    id: 'hasHeadlessChromeDefaultScreenResolution',
    artifactId: 'screen-resolution',
    category: 'environment',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Screen resolution matches known headless default or has extreme aspect',
    defaultSeverity: 'medium',
    run: () => browserChecks.checkHeadlessResolution(),
    normalize: headlessResolutionNormalize,
  },
  {
    id: 'hasMissingBrowserChrome',
    artifactId: 'browser-chrome',
    category: 'environment',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Browser chrome dimension anomalies',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkMissingBrowserChrome(),
  },
  {
    id: 'hasScreenAvailabilityAnomaly',
    artifactId: 'screen:avail-anomaly',
    category: 'environment',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Screen availability dimensions anomalous',
    defaultSeverity: 'weak',
    run: () => browserChecks.checkScreenAvailability(),
  },
  {
    id: 'hasTouchInconsistency',
    artifactId: 'touch:inconsistent',
    category: 'browser-integrity',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Touch capability inconsistent with User-Agent',
    defaultSeverity: 'weak',
    run: () => browserChecks.checkTouchInconsistency(),
  },
  {
    id: 'hasNavigatorIntegrityViolation',
    artifactId: 'navigator:integrity',
    category: 'browser-integrity',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'navigator object getters appear to be tampered',
    defaultSeverity: 'medium',
    run: () => browserChecks.checkNavigatorIntegrity(),
  },
  {
    id: 'isAutomatedWithCDPInWebWorker',
    artifactId: 'worker:cdp',
    category: 'cdp',
    context: 'worker',
    critical: true,
    isAsync: true,
    timeoutMs: 3000,
    description: 'CDP automation markers in Web Worker',
    defaultSeverity: 'strong',
    run: () => workerChecks.checkAutomatedWithCDPInWorker(),
  },
  {
    id: 'hasBlobIframeCDPIssue',
    artifactId: 'blob-iframe:inspection',
    category: 'cdp',
    context: 'blob-iframe',
    critical: true,
    isAsync: true,
    timeoutMs: 3000,
    description: 'CDP/automation leaks across blob URL iframe',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkBlobIframeCDP(),
  },
  {
    id: 'hasCrossRealmInconsistency',
    artifactId: 'cross-realm:consistency',
    category: 'browser-integrity',
    context: 'main',
    critical: true,
    isAsync: true,
    timeoutMs: 6000,
    description: 'Cross-realm consistency between main, iframe, blob iframe, and worker',
    defaultSeverity: 'medium',
    run: () => crossRealm.runCrossRealmConsistency().then(crossRealm.crossRealmMismatchesToFindings),
  },
  {
    id: 'hasSuspiciousWeakSignals',
    artifactId: 'suspicious-weak-signals',
    category: 'browser-integrity',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Collective weak signal analysis',
    defaultSeverity: 'weak',
    run: () => browserChecks.analyzeWeakSignals(),
  },
  {
    id: 'isAutomatedViaStackTrace',
    artifactId: 'prepare-stack-trace:main',
    category: 'browser-integrity',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'Error.prepareStackTrace handler inspection',
    defaultSeverity: 'medium',
    run: () => browserChecks.checkPrepareStackTrace(),
  },
  {
    id: 'hasCanvasAvailabilityIssue',
    artifactId: 'canvas:availability',
    category: 'fingerprint',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Canvas API availability or output anomalies',
    defaultSeverity: 'weak',
    run: () => browserChecks.checkCanvasAvailability(),
    normalize: canvasNormalize,
  },
  {
    id: 'hasAudioFingerprintIssue',
    artifactId: 'audio:suspicious-sum',
    category: 'fingerprint',
    context: 'main',
    critical: false,
    isAsync: true,
    timeoutMs: 3000,
    description: 'Audio fingerprint indicates a headless or sandboxed environment',
    defaultSeverity: 'weak',
    run: () => browserChecks.checkAudioFingerprint(),
    normalize: audioNormalize,
  },
  {
    id: 'hasPermissionsInconsistency',
    artifactId: 'permissions:notification',
    category: 'permissions',
    context: 'main',
    critical: false,
    isAsync: true,
    timeoutMs: 3000,
    description: 'Permissions API inconsistent with Notification.permission',
    defaultSeverity: 'weak',
    run: () => browserChecks.checkPermissionsConsistency(),
    unsupportedPolicy: 'pass',
  },
  {
    id: 'hasPluginsMimeTypesIssue',
    artifactId: 'plugins:anomaly',
    category: 'browser-integrity',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'navigator.plugins/mimeTypes anomalies',
    defaultSeverity: 'weak',
    run: () => browserChecks.checkPluginsMimeTypes(),
    normalize: pluginsNormalize,
  },
  {
    id: 'hasLocaleTimezoneIntlIssue',
    artifactId: 'locale:incoherence',
    category: 'browser-integrity',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Locale/timezone/Intl coherence issues',
    defaultSeverity: 'weak',
    run: () => browserChecks.checkLocaleTimezoneIntl(),
  },
  {
    id: 'hasViewportScreenCoherenceIssue',
    artifactId: 'viewport:incoherence',
    category: 'browser-integrity',
    context: 'main',
    critical: false,
    isAsync: false,
    description: 'Viewport/screen/DPR coherence issues',
    defaultSeverity: 'weak',
    run: () => browserChecks.checkViewportScreenCoherence(),
  },
  {
    id: 'hasAutomationGlobalsExtended',
    artifactId: 'automation-marker:globals',
    category: 'automation-global',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'Extended automation globals detected',
    defaultSeverity: 'strong',
    run: () => browserChecks.checkAutomationGlobalsExtended(),
  },
  {
    id: 'hasSyntheticEventTrustedInvariant',
    artifactId: 'event:is-trusted-invariant',
    category: 'browser-integrity',
    context: 'main',
    critical: true,
    isAsync: false,
    description: 'Synthetic Event.isTrusted invariant',
    defaultSeverity: 'hard',
    run: () => browserChecks.checkSyntheticEventIsTrusted(),
  },
  {
    id: 'hasRuntimeAPIIntegrityViolation',
    artifactId: 'runtime-api:integrity',
    category: 'api-integrity',
    context: 'main',
    critical: false,
    isAsync: true,
    timeoutMs: 3000,
    description: 'Runtime API integrity against a pristine same-origin iframe',
    defaultSeverity: 'medium',
    run: () => browserChecks.checkRuntimeAPIIntegrity(),
  },
  {
    id: 'hasMediaDeviceInfoIntegrity',
    artifactId: 'media-devices:info-integrity',
    category: 'api-integrity',
    context: 'main',
    critical: false,
    isAsync: true,
    timeoutMs: 3000,
    description: 'MediaDeviceInfo entries do not resemble native objects',
    defaultSeverity: 'medium',
    run: () => browserChecks.checkMediaDeviceInfoSemantics(),
    unsupportedPolicy: 'pass',
  },
  {
    id: 'hasHighEntropyClientHintsCoherence',
    artifactId: 'client-hints:high-entropy',
    category: 'api-integrity',
    context: 'main',
    critical: false,
    isAsync: true,
    timeoutMs: 3000,
    description: 'High-entropy User-Agent Client Hints coherence',
    defaultSeverity: 'medium',
    run: () => browserChecks.checkHighEntropyClientHintsCoherence(),
    unsupportedPolicy: 'pass',
  },
  {
    id: 'hasWebGLWebGPUCoherence',
    artifactId: 'gpu:webgl-webgpu',
    category: 'fingerprint',
    context: 'main',
    critical: false,
    isAsync: true,
    timeoutMs: 3000,
    description: 'WebGL and WebGPU adapter coherence',
    defaultSeverity: 'medium',
    run: () => gpuCoherence.checkWebGLWebGPUCoherence(),
    unsupportedPolicy: 'pass',
  },
];

const INTERACTION_REGISTRY: DetectorRegistryEntry[] = [
  {
    id: 'insufficientObservationWindow',
    artifactId: 'insufficient-observation-window',
    category: 'interaction',
    context: 'interaction',
    critical: true,
    isAsync: false,
    description: 'Insufficient interaction observation window',
    defaultSeverity: 'info',
    run: () => interactionChecks.analyzeInsufficientObservationWindow(),
  },
  {
    id: 'lowObservationSubmission',
    artifactId: 'low-observation-submission',
    category: 'interaction',
    context: 'interaction',
    critical: false,
    isAsync: false,
    description: 'Low-observation scripted submission patterns',
    defaultSeverity: 'weak',
    run: () => interactionChecks.analyzeLowObservationSubmission(),
  },
  {
    id: 'suspiciousClientSideBehavior',
    artifactId: 'suspicious-client-side-behavior',
    category: 'interaction',
    context: 'interaction',
    critical: false,
    isAsync: false,
    description: 'Suspicious client-side interaction patterns',
    defaultSeverity: 'weak',
    run: () => interactionChecks.analyzeSuspiciousClientSideBehavior(),
  },
  {
    id: 'superHumanSpeed',
    artifactId: 'super-human-speed',
    category: 'interaction',
    context: 'interaction',
    critical: false,
    isAsync: false,
    description: 'Super-human typing or completion speed',
    defaultSeverity: 'medium',
    run: () => interactionChecks.analyzeSuperHumanSpeed(),
  },
  {
    id: 'hasCDPMouseLeak',
    artifactId: 'cdp:mouse-leak',
    category: 'cdp',
    context: 'interaction',
    critical: true,
    isAsync: false,
    description: 'CDP screen coordinate leak from mouse events',
    defaultSeverity: 'medium',
    run: () => interactionChecks.analyzeCDPMouseLeak(),
  },
  {
    id: 'hasAdvancedBotSignals',
    artifactId: 'advanced-bot-signals',
    category: 'interaction',
    context: 'interaction',
    critical: false,
    isAsync: false,
    description: 'Advanced interaction bot signals',
    defaultSeverity: 'medium',
    run: () => interactionChecks.analyzeAdvancedInteractionSignals(),
  },
];

export function getStaticDetectors(): DetectorRegistryEntry[] {
  return STATIC_REGISTRY;
}

export function getAllDetectors(): DetectorRegistryEntry[] {
  return [...STATIC_REGISTRY, ...INTERACTION_REGISTRY];
}

export function getInteractionDetectors(): DetectorRegistryEntry[] {
  return getAllDetectors();
}
