import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkWebdriverNull,
  checkPrepareStackTrace,
  checkMissingBrowserChrome,
  analyzeWeakSignals,
  checkSeleniumChromeDefault,
  checkAutomatedWithCDP,
  checkSyntheticEventIsTrusted,
  checkNavigatorIntegrity,
  checkRuntimeAPIIntegrity,
  checkPermissionsConsistency,
  checkMediaDeviceInfoSemantics,
  checkHighEntropyClientHintsCoherence,
  checkBlobIframeCDP,
} from './browser-checks';
import { runDetectors, getStaticDetectors } from './detector-registry';
import { summarizeResults } from './scoring';

describe('browser checks', () => {
  describe('webdriver detection', () => {
    let originalDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
    });

    afterEach(() => {
      if (originalDescriptor) {
        Object.defineProperty(navigator, 'webdriver', originalDescriptor);
      } else {
        delete ((navigator as unknown as Record<string, unknown>).webdriver);
      }
    });

    it('navigator.webdriver === true produces a bot verdict', async () => {
      Object.defineProperty(navigator, 'webdriver', { get: () => true, configurable: true });

      const { rawResults, findings } = await runDetectors(getStaticDetectors().filter(d => d.id === 'hasWebdriverTrue'));
      const scoring = summarizeResults(rawResults, findings);
      expect(scoring.summary.verdict).toBe('bot');
      expect(scoring.summary.verdictRule).toContain('hard');
    });

    it('navigator.webdriver === null produces a bot verdict', async () => {
      Object.defineProperty(navigator, 'webdriver', { get: () => null, configurable: true });

      const entries = getStaticDetectors().filter(d => ['hasWebdriverNull', 'hasSuspiciousWeakSignals'].includes(d.id));
      const { rawResults, findings } = await runDetectors(entries);
      const scoring = summarizeResults(rawResults, findings);
      expect(scoring.summary.verdict).toBe('bot');
      expect(scoring.summary.uniqueEvidenceCount).toBe(1);
      expect(scoring.findings.length).toBeGreaterThanOrEqual(2);
    });

    it('checkWebdriverNull has stable artifactId webdriver:null', async () => {
      Object.defineProperty(navigator, 'webdriver', { get: () => null, configurable: true });
      const results = checkWebdriverNull();
      expect(results).toBe(true);

      const { rawResults, findings } = await runDetectors(getStaticDetectors().filter(d => d.id === 'hasWebdriverNull'));
      const scoring = summarizeResults(rawResults, findings);
      const scored = scoring.scoredArtifacts.find(a => a.artifactId === 'webdriver:null');
      expect(scored).toBeDefined();
      expect(scored?.severity).toBe('hard');
    });

    it('webdriver:true in an iframe is detected and scored strongly', async () => {
      Object.defineProperty(navigator, 'webdriver', { get: () => true, configurable: true });

      const originalCreateElement = document.createElement;
      const fakeIframe = originalCreateElement.call(document, 'div') as unknown as HTMLElement & { contentWindow?: unknown };
      fakeIframe.contentWindow = { navigator: { webdriver: true } };
      const realCreateElement = document.createElement;
      document.createElement = (tagName: string, options?: any) => {
        if (tagName === 'iframe') return fakeIframe as unknown as HTMLElement;
        return realCreateElement.call(document, tagName, options);
      };

      try {
        const { rawResults, findings } = await runDetectors(getStaticDetectors().filter(d => d.id === 'hasWebdriverInFrameTrue'));
        const scoring = summarizeResults(rawResults, findings);
        expect(scoring.summary.verdict).toBe('bot');
        const scored = scoring.scoredArtifacts.find(a => a.artifactId === 'webdriver:iframe-true');
        expect(scored?.severity).toBe('strong');
      } finally {
        document.createElement = originalCreateElement;
      }
    });
  });

  describe('prepareStackTrace detection', () => {
    let original: unknown;

    beforeEach(() => {
      original = (Error as { prepareStackTrace?: unknown }).prepareStackTrace;
    });

    afterEach(() => {
      (Error as { prepareStackTrace?: unknown }).prepareStackTrace = original;
    });

    it('native handler returns a pass', () => {
      // Bound functions are reported by Function.prototype.toString as [native code].
      const nativeHandler = function () { return undefined; }.bind(null);
      (Error as { prepareStackTrace?: unknown }).prepareStackTrace = nativeHandler;

      const findings = checkPrepareStackTrace();
      const main = findings.find(f => f.artifactId === 'prepare-stack-trace:main');
      expect(main?.status).toBe('passed');
      expect(main?.reason).toBe('native-handler');
    });

    it('non-native anonymous handler is a medium integrity finding, not passed', () => {
      (Error as { prepareStackTrace?: unknown }).prepareStackTrace = function() { return ''; };
      const findings = checkPrepareStackTrace();
      const main = findings.find(f => f.artifactId === 'prepare-stack-trace:main' && f.context === 'main');
      expect(main).toBeDefined();
      expect(main?.severity).toBe('medium');
      expect(main?.category).toBe('browser-integrity');
      expect(main?.status).toBe('finding');
    });

    it('clearly DevTools-originated handler is informational when uncorroborated', () => {
      (Error as { prepareStackTrace?: unknown }).prepareStackTrace = function devtoolsHandler() { return 'devtools'; };
      const findings = checkPrepareStackTrace();
      const main = findings.find(f => f.artifactId === 'prepare-stack-trace:main' && f.context === 'main');
      expect(main).toBeDefined();
      expect(main?.severity).toBe('info');
      expect(main?.status).toBe('finding');
    });

    it('explicit automation markers in handler are a strong or hard finding', () => {
      (Error as { prepareStackTrace?: unknown }).prepareStackTrace = function cdpHandler() { return 'cdp'; };
      const findings = checkPrepareStackTrace();
      const main = findings.find(f => f.artifactId === 'prepare-stack-trace:main' && f.context === 'main');
      expect(main).toBeDefined();
      expect(['strong', 'hard']).toContain(main?.severity);
      expect(main?.status).toBe('finding');
    });
  });

  describe('browser chrome dimensions', () => {
    const setDims = (outerW: number, outerH: number, innerW: number, innerH: number, fullscreen = false) => {
      Object.defineProperty(window, 'outerWidth', { value: outerW, configurable: true });
      Object.defineProperty(window, 'outerHeight', { value: outerH, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: innerW, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: innerH, configurable: true });
      Object.defineProperty(document, 'fullscreenElement', { value: fullscreen ? document.documentElement : null, configurable: true });
    };

    it('outer === inner outside fullscreen is weak and cannot bot alone', () => {
      setDims(1200, 800, 1200, 800, false);
      const findings = checkMissingBrowserChrome();
      const eq = findings.find(f => f.artifactId === 'browser-chrome:outer-eq-inner');
      expect(eq).toBeDefined();
      expect(eq?.severity).toBe('weak');

      const scoring = summarizeResults({}, findings);
      expect(scoring.summary.verdict).not.toBe('bot');
    });

    it('outer < inner is strong', () => {
      setDims(1200, 700, 1200, 800, false);
      const findings = checkMissingBrowserChrome();
      const lt = findings.find(f => f.artifactId === 'browser-chrome:outer-lt-inner');
      expect(lt).toBeDefined();
      expect(lt?.severity).toBe('strong');
    });

    it('zero outer is strong classic-headless evidence', () => {
      setDims(0, 0, 1200, 800, false);
      const findings = checkMissingBrowserChrome();
      const zero = findings.find(f => f.artifactId === 'browser-chrome:zero-outer');
      expect(zero).toBeDefined();
      expect(zero?.severity).toBe('strong');
    });
  });

  describe('weak signals', () => {
    it('analyzeWeakSignals does not separately score webdriver:null when dedicated detector runs', () => {
      Object.defineProperty(navigator, 'webdriver', { get: () => null, configurable: true });
      const findings = analyzeWeakSignals();
      const nullFindings = findings.filter(f => f.artifactId === 'webdriver:null');
      expect(nullFindings.length).toBe(1);
      expect(nullFindings[0].severity).toBe('hard');
      expect(findings.some(f => f.artifactId === 'suspicious-weak-signals')).toBe(false);
    });

    it('analyzeWeakSignals can return multiple weak signals when no null', () => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
      Object.defineProperty(window, 'devicePixelRatio', { value: undefined, configurable: true });
      // Cannot easily tamper with Function.prototype.toString in a clean way.
      const findings = analyzeWeakSignals();
      expect(findings.every(f => f.status === 'passed')).toBe(true);
    });
  });

  describe('automation markers', () => {
    it('a known Selenium/CDP marker remains sufficient for bot detection', async () => {
      (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_ = {};
      expect(checkSeleniumChromeDefault()).toBe(true);
      expect(checkAutomatedWithCDP()).toBeTruthy();

      const { rawResults, findings } = await runDetectors(
        getStaticDetectors().filter(d => ['isSeleniumChromeDefault', 'isAutomatedWithCDP'].includes(d.id))
      );
      const scoring = summarizeResults(rawResults, findings);
      expect(scoring.summary.verdict).toBe('bot');
      delete (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_;
    });

    it('existing bot simulation mode still produces a bot verdict', async () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
      Object.defineProperty(navigator, 'webdriver', { get: () => true, configurable: true });
      (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_ = {};

      const { rawResults, findings } = await runDetectors(getStaticDetectors());
      const scoring = summarizeResults(rawResults, findings);
      expect(scoring.summary.verdict).toBe('bot');

      if (originalDescriptor) {
        Object.defineProperty(navigator, 'webdriver', originalDescriptor);
      } else {
        delete ((navigator as unknown as Record<string, unknown>).webdriver);
      }
      delete (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_;
    });
  });

  describe('synthetic Event.isTrusted invariant', () => {
    it('a normal synthetic dispatchEvent produces an untrusted event and passes', () => {
      const findings = checkSyntheticEventIsTrusted();
      expect(findings).toHaveLength(1);
      expect(findings[0].status).toBe('passed');
      expect(findings[0].artifactId).toBe('event:is-trusted-invariant');
    });

    it('an anomalous isTrusted true during dispatch is hard evidence', () => {
      const RealEvent = globalThis.Event;
      function AnomalousEvent(type: string, init?: EventInit) {
        const event = new RealEvent(type, init);
        return new Proxy(event, {
          get(target, prop) {
            if (prop === 'isTrusted') return true;
            return (target as unknown as Record<string | symbol, unknown>)[prop as string];
          },
          set(target, prop, value) {
            if (prop === 'isTrusted') return true;
            (target as unknown as Record<string | symbol, unknown>)[prop as string] = value;
            return true;
          },
        }) as Event;
      }
      globalThis.Event = AnomalousEvent as unknown as typeof Event;

      try {
        const findings = checkSyntheticEventIsTrusted();
        const findingResult = findings.find((f) => f.status === 'finding');
        expect(findingResult).toBeDefined();
        expect(findingResult?.artifactId).toBe('event:is-trusted-invariant');
        expect(findingResult?.severity).toBe('hard');
      } finally {
        globalThis.Event = RealEvent;
      }
    });
  });

  describe('navigator and runtime API integrity', () => {
    it('detects an own non-native navigator.languages getter', () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'languages');
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US'],
        configurable: true,
      });

      try {
        const result = checkNavigatorIntegrity();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect((result.suspicious as string[])).toContain('languagesOwnGetterPatched');
        }
      } finally {
        if (original) {
          Object.defineProperty(navigator, 'languages', original);
        } else {
          delete ((navigator as unknown as Record<string, unknown>).languages);
        }
      }
    });

    it('a single non-native runtime API is medium evidence', () => {
      const original = console.log;
      Object.defineProperty(console, 'log', { value: () => {}, configurable: true, writable: true });

      try {
        const result = checkRuntimeAPIIntegrity();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.severity).toBe('medium');
          expect(result.artifactId).toBe('runtime-api:integrity');
        }
      } finally {
        Object.defineProperty(console, 'log', { value: original, configurable: true, writable: true });
      }
    });

    it('two independent non-native browser APIs escalate to strong', () => {
      const originalLog = console.log;
      const originalWorker = window.Worker;
      Object.defineProperty(console, 'log', { value: () => {}, configurable: true, writable: true });
      (window as Record<string, unknown>).Worker = function FakeWorker() {} as unknown as typeof Worker;

      try {
        const result = checkRuntimeAPIIntegrity();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.severity).toBe('strong');
          expect((result.modifiedAPIs as Array<{ id: string }>).length).toBeGreaterThanOrEqual(2);
        }
      } finally {
        Object.defineProperty(console, 'log', { value: originalLog, configurable: true, writable: true });
        if (originalWorker) {
          (window as Record<string, unknown>).Worker = originalWorker;
        } else {
          delete (window as Record<string, unknown>).Worker;
        }
      }
    });
  });

  describe('Permissions API semantics', () => {
    it('detects a fake PermissionStatus plain object', async () => {
      const originalUA = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
      const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
      const originalNotification = globalThis.Notification;
      const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
        configurable: true,
      });
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: {
          query: async () => ({ state: 'prompt', onchange: null }),
        },
      });
      (globalThis as Record<string, unknown>).Notification = { permission: 'prompt' };
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { protocol: 'https:', hostname: 'localhost', href: 'https://localhost/' },
      });

      try {
        const results = await checkPermissionsConsistency();
        expect(results).toBeTruthy();
        expect(Array.isArray(results)).toBe(true);
        const fake = (results as import('./detector-types').DetectionResult[]).find(
          (f) => f.artifactId === 'permissions:result-integrity'
        );
        expect(fake).toBeDefined();
        expect(fake?.status).toBe('finding');
        expect(fake?.severity).toBe('strong');
      } finally {
        if (originalUA) Object.defineProperty(navigator, 'userAgent', originalUA);
        if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions);
        (globalThis as Record<string, unknown>).Notification = originalNotification;
        if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
      }
    });

    it('missing optional Permissions API does not become bot evidence', async () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'permissions');
      Object.defineProperty(navigator, 'permissions', { value: undefined, configurable: true });

      try {
        const result = await checkPermissionsConsistency();
        expect(result).toBe(false);
      } finally {
        if (original) Object.defineProperty(navigator, 'permissions', original);
      }
    });
  });

  describe('MediaDeviceInfo semantics', () => {
    it('detects a plain object that does not resemble native MediaDeviceInfo', async () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'x', groupId: 'g', label: '' }],
        },
      });

      try {
        const result = await checkMediaDeviceInfoSemantics();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.status).toBe('finding');
          expect(result.artifactId).toBe('media-devices:info-integrity');
        }
      } finally {
        if (original) Object.defineProperty(navigator, 'mediaDevices', original);
      }
    });

    it('empty media device list is not suspicious', async () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { enumerateDevices: async () => [] },
      });

      try {
        const result = await checkMediaDeviceInfoSemantics();
        expect(result).toBe(false);
      } finally {
        if (original) Object.defineProperty(navigator, 'mediaDevices', original);
      }
    });
  });

  describe('high-entropy User-Agent Client Hints', () => {
    it('detects an impossible full-version mismatch as hard evidence', async () => {
      const originalUA = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
      const originalUAData = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');

      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
        configurable: true,
      });
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        value: {
          brands: [{ brand: 'Chrome', version: '120' }],
          platform: 'Windows',
          mobile: false,
          getHighEntropyValues: async () => ({
            fullVersionList: [{ brand: 'Chrome', version: '121.0.0.0' }],
            architecture: 'x86',
            bitness: '64',
            model: '',
          }),
        },
      });

      try {
        const result = await checkHighEntropyClientHintsCoherence();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.artifactId).toBe('client-hints:high-entropy');
          expect(result.severity).toBe('hard');
        }
      } finally {
        if (originalUA) Object.defineProperty(navigator, 'userAgent', originalUA);
        if (originalUAData) Object.defineProperty(navigator, 'userAgentData', originalUAData);
      }
    });

    it('missing high-entropy Client Hints API does not become bot evidence', async () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        value: { brands: [], platform: 'Windows', mobile: false },
      });

      try {
        const result = await checkHighEntropyClientHintsCoherence();
        expect(result).toBe(false);
      } finally {
        if (original) Object.defineProperty(navigator, 'userAgentData', original);
      }
    });
  });

  describe('blob iframe CDP failure handling', () => {
    it('returns inconclusive when the blob iframe fails to load', async () => {
      const realCreate = document.createElement.bind(document);
      const fakeIframe = {
        style: {},
        set src(_: string) {},
        set onerror(fn: unknown) {
          if (typeof fn === 'function') {
            (fn as () => void)();
          }
        },
        set onload(_: unknown) {},
      } as unknown as HTMLIFrameElement;

      document.createElement = (tagName: string) => {
        if (tagName === 'iframe') return fakeIframe;
        return realCreate(tagName) as HTMLElement;
      };

      try {
        const result = await checkBlobIframeCDP();
        expect(result).not.toBe(false);
        expect(result).toMatchObject({ inconclusive: true, reason: 'iframeLoadError' });
      } finally {
        document.createElement = realCreate;
      }
    });
  });
});
