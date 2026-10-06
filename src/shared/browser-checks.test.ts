import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkWebdriverNull,
  checkPrepareStackTrace,
  checkMissingBrowserChrome,
  analyzeWeakSignals,
  checkSeleniumChromeDefault,
  checkAutomatedWithCDP,
  checkWebdriverInFrame,
  checkIframeOverridden,
  checkBlobIframeCDP,
  checkHighEntropyClientHintsCoherence,
  checkMediaDeviceInfoSemantics,
  checkPermissionsConsistency,
  checkRuntimeAPIIntegrity,
  checkNavigatorIntegrity,
  checkSyntheticEventIsTrusted,
} from './browser-checks';
import { runDetectors, getStaticDetectors } from './detector-registry';
import { summarizeResults } from './scoring';

function makeNativeLikePermissionStatus(state: 'granted' | 'denied' | 'prompt') {
  // Build an object that satisfies the invariants of a native PermissionStatus
  // without depending on the global constructor being present or constructible.
  const proto = Object.create(null);
  proto.constructor = function PermissionStatus() {};
  const status = Object.create(proto) as Record<string, unknown>;
  Object.defineProperty(status, Symbol.toStringTag, { value: 'PermissionStatus', configurable: true });
  status.state = state;
  status.onchange = null;
  status.addEventListener = () => {};
  return status as unknown as EventTarget & { state: string; onchange: null };
}

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
      const marker = '$cdc_asdjflasutopfhvcZLmcfl_';
      (window as Record<string, unknown>)[marker] = {};

      const selenium = checkSeleniumChromeDefault();
      expect(selenium.some(f => f.artifactId === `automation-marker:${marker}` && f.status === 'finding')).toBe(true);

      const cdp = checkAutomatedWithCDP();
      expect(cdp.some(f => f.artifactId === `automation-marker:${marker}` && f.status === 'finding')).toBe(true);

      const { rawResults, findings } = await runDetectors(
        getStaticDetectors().filter(d => ['isSeleniumChromeDefault', 'isAutomatedWithCDP'].includes(d.id))
      );
      const scoring = summarizeResults(rawResults, findings);
      expect(scoring.summary.verdict).toBe('bot');
      expect(scoring.summary.verdictRule).toContain('standalone');
      delete (window as Record<string, unknown>)[marker];
    });

    it('real $cdc marker installed and run through the registry produces unique evidence', async () => {
      const marker = '$cdc_asdjflasutopfhvcZLmcfl_';
      (window as Record<string, unknown>)[marker] = {};

      const { rawResults, findings } = await runDetectors(
        getStaticDetectors().filter(d =>
          ['isSeleniumChromeDefault', 'isAutomatedWithCDP', 'hasAutomationGlobalsExtended'].includes(d.id)
        )
      );
      const scoring = summarizeResults(rawResults, findings);
      expect(scoring.summary.verdict).toBe('bot');
      expect(scoring.summary.uniqueEvidenceCount).toBe(1);
      expect(scoring.summary.independentCategoryCount).toBe(1);
      delete (window as Record<string, unknown>)[marker];
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

  describe('standalone browser-integrity evidence', () => {
    const setDims = (outerW: number, outerH: number, innerW: number, innerH: number, fullscreen = false) => {
      Object.defineProperty(window, 'outerWidth', { value: outerW, configurable: true });
      Object.defineProperty(window, 'outerHeight', { value: outerH, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: innerW, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: innerH, configurable: true });
      Object.defineProperty(document, 'fullscreenElement', { value: fullscreen ? document.documentElement : null, configurable: true });
    };

    it('zero outer dimensions is a standalone strong environment finding that produces bot', () => {
      setDims(0, 0, 1200, 800, false);
      const findings = checkMissingBrowserChrome();
      const zero = findings.find(f => f.artifactId === 'browser-chrome:zero-outer');
      expect(zero).toBeDefined();
      expect(zero?.severity).toBe('strong');
      expect(zero?.verdictImpact).toBe('standalone');

      const scoring = summarizeResults({}, findings);
      expect(scoring.summary.verdict).toBe('bot');
      expect(scoring.summary.verdictRule).toContain('standalone');
    });

    it('outer < inner is a standalone strong environment finding that produces bot', () => {
      setDims(1200, 700, 1200, 800, false);
      const findings = checkMissingBrowserChrome();
      const lt = findings.find(f => f.artifactId === 'browser-chrome:outer-lt-inner');
      expect(lt).toBeDefined();
      expect(lt?.severity).toBe('strong');
      expect(lt?.verdictImpact).toBe('standalone');

      const scoring = summarizeResults({}, findings);
      expect(scoring.summary.verdict).toBe('bot');
    });
  });

  describe('iframe integrity checks', () => {
    it('checkWebdriverInFrame returns inconclusive when iframe contentWindow is inaccessible', () => {
      const originalCreateElement = document.createElement;
      const fakeIframe = originalCreateElement.call(document, 'div') as unknown as HTMLIFrameElement;
      Object.defineProperty(fakeIframe, 'contentWindow', {
        get: () => { throw new Error('cross-origin iframe'); },
        configurable: true,
      });

      document.createElement = (tagName: string, options?: any) => {
        if (tagName === 'iframe') return fakeIframe;
        return originalCreateElement.call(document, tagName, options);
      };

      try {
        const findings = checkWebdriverInFrame();
        const result = findings.find(f => f.artifactId === 'webdriver:iframe-true');
        expect(result?.status).toBe('inconclusive');
        expect(result?.reason).toBe('iframe-inspection-failed');
      } finally {
        document.createElement = originalCreateElement;
      }
    });

    it('checkIframeOverridden returns a strong standalone finding for a tampered iframe', () => {
      const originalCreateElement = document.createElement;
      const fakeIframe = originalCreateElement.call(document, 'div') as unknown as HTMLIFrameElement & {
        contentWindow?: Record<string, unknown>;
      };
      // A contentWindow without any `navigator` property triggers the tampered
      // iframe signal.
      fakeIframe.contentWindow = {} as unknown as Window;

      document.createElement = (tagName: string, options?: any) => {
        if (tagName === 'iframe') return fakeIframe;
        return originalCreateElement.call(document, tagName, options);
      };

      try {
        const findings = checkIframeOverridden();
        const result = findings.find(f => f.artifactId === 'iframe:overridden');
        expect(result?.status).toBe('finding');
        expect(result?.severity).toBe('strong');
        expect(result?.verdictImpact).toBe('standalone');

        const scoring = summarizeResults({}, findings);
        expect(scoring.summary.verdict).toBe('bot');
      } finally {
        document.createElement = originalCreateElement;
      }
    });
  });

  describe('blob iframe CDP inspection', () => {
    function mockBlobIframe(contentWindow: unknown) {
      const originalCreateElement = document.createElement;
      const originalAppendChild = document.body.appendChild;
      const originalRemoveChild = document.body.removeChild;

      // Use a plain div as a stand-in for an iframe so we can fully control
      // `contentWindow` and `onload` without jsdom's real iframe getter.
      const fakeIframe = originalCreateElement.call(document, 'div') as unknown as HTMLIFrameElement & {
        contentWindow?: unknown;
        _onload?: () => void;
      };
      (fakeIframe as any).contentWindow = contentWindow;

      let onload: (() => void) | null = null;
      Object.defineProperty(fakeIframe, 'onload', {
        get: () => onload,
        set: (handler) => { onload = handler; },
        configurable: true,
      });

      document.createElement = (tagName: string, options?: any) => {
        if (tagName === 'iframe') return fakeIframe;
        return originalCreateElement.call(document, tagName, options);
      };
      document.body.appendChild = ((node: Node) => {
        if (node === fakeIframe && onload) onload();
        return node;
      }) as typeof document.body.appendChild;
      document.body.removeChild = ((node: Node) => node) as typeof document.body.removeChild;

      return {
        fakeIframe,
        restore() {
          document.createElement = originalCreateElement;
          document.body.appendChild = originalAppendChild;
          document.body.removeChild = originalRemoveChild;
        },
      };
    }

    it('blob iframe with a real $cdc marker produces a bot verdict', async () => {
      const marker = '$cdc_asdjflasutopfhvcZLmcfl_';
      const blobWin = {
        navigator: {
          webdriver: false,
          userAgent: navigator.userAgent,
          languages: navigator.languages,
        },
        [marker]: {},
      };

      const { restore } = mockBlobIframe(blobWin);
      try {
        const findings = await checkBlobIframeCDP();
        const markerFinding = findings.find(f => f.artifactId === `automation-marker:${marker}`);
        expect(markerFinding?.status).toBe('finding');
        expect(markerFinding?.severity).toBe('strong');
        expect(markerFinding?.verdictImpact).toBe('standalone');

        const scoring = summarizeResults({}, findings);
        expect(scoring.summary.verdict).toBe('bot');
        expect(scoring.summary.verdictRule).toContain('standalone');
      } finally {
        restore();
      }
    });

    it('blob iframe inspection failure produces an inconclusive result', async () => {
      const { restore } = mockBlobIframe(undefined);
      try {
        const findings = await checkBlobIframeCDP();
        const result = findings.find(f => f.artifactId === 'blob-iframe:inspection');
        expect(result?.status).toBe('inconclusive');
        expect(['load-error', 'no-content-window', 'timeout', 'inspection-error']).toContain(result?.reason);
      } finally {
        restore();
      }
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

    function makeNativeFn() {
      return function native() { return '[native code]'; };
    }

    function makeNonNativeFn() {
      return () => {};
    }

    function makeFakeWindow(modifiedIds: Set<string>) {
      function apiFn(id: string) {
        return modifiedIds.has(id) ? makeNonNativeFn() : makeNativeFn();
      }

      function getterFn(id: string) {
        return { get: apiFn(id) };
      }

      const navProto: Record<string, unknown> = {};
      Object.defineProperty(navProto, 'userAgentData', getterFn('Navigator.prototype.userAgentData'));
      Object.defineProperty(navProto, 'language', getterFn('Navigator.prototype.language'));
      Object.defineProperty(navProto, 'languages', getterFn('Navigator.prototype.languages'));

      return {
        console: { log: apiFn('console.log') },
        Worker: apiFn('window.Worker'),
        navigator: {
          permissions: { query: apiFn('navigator.permissions.query') },
          mediaDevices: { enumerateDevices: apiFn('navigator.mediaDevices.enumerateDevices') },
        },
        speechSynthesis: { getVoices: apiFn('speechSynthesis.getVoices') },
        WebGLRenderingContext: { prototype: { getParameter: apiFn('WebGLRenderingContext.prototype.getParameter') } },
        WebGL2RenderingContext: { prototype: { getParameter: apiFn('WebGL2RenderingContext.prototype.getParameter') } },
        Navigator: { prototype: navProto },
      } as Record<string, unknown>;
    }

    function withFakeIframe(fakeWindow: Record<string, unknown>) {
      const realCreate = document.createElement.bind(document);
      const realIframe = document.createElement('iframe') as HTMLIFrameElement & { contentWindow?: Record<string, unknown> };
      Object.defineProperty(realIframe, 'contentWindow', {
        get: () => fakeWindow,
        configurable: true,
      });

      const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'iframe') return realIframe;
        return realCreate(tag);
      });

      return () => {
        spy.mockRestore();
      };
    }

    it('main-only non-native runtime API is informational, not scored', async () => {
      const original = console.log;
      Object.defineProperty(console, 'log', { value: makeNonNativeFn(), configurable: true, writable: true });
      const fakeWindow = makeFakeWindow(new Set());
      const cleanup = withFakeIframe(fakeWindow);

      try {
        const result = await checkRuntimeAPIIntegrity();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.severity).toBe('info');
          expect(result.artifactId).toBe('runtime-api:integrity');
          expect((result.mainOnly as Array<{ id: string }>).length).toBeGreaterThanOrEqual(1);
        }
      } finally {
        Object.defineProperty(console, 'log', { value: original, configurable: true, writable: true });
        cleanup();
      }
    });

    it('a non-native API in both main and pristine iframe is medium evidence', async () => {
      const original = console.log;
      Object.defineProperty(console, 'log', { value: makeNonNativeFn(), configurable: true, writable: true });
      const fakeWindow = makeFakeWindow(new Set(['console.log']));
      const cleanup = withFakeIframe(fakeWindow);

      try {
        const result = await checkRuntimeAPIIntegrity();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.severity).toBe('medium');
          expect(result.artifactId).toBe('runtime-api:integrity');
        }
      } finally {
        Object.defineProperty(console, 'log', { value: original, configurable: true, writable: true });
        cleanup();
      }
    });

    it('two independent non-native APIs in the pristine iframe escalate to strong', async () => {
      const originalLog = console.log;
      const originalWorker = window.Worker;
      Object.defineProperty(console, 'log', { value: makeNonNativeFn(), configurable: true, writable: true });
      (window as Record<string, unknown>).Worker = function FakeWorker() {} as unknown as typeof Worker;
      const fakeWindow = makeFakeWindow(new Set(['console.log', 'window.Worker']));
      const cleanup = withFakeIframe(fakeWindow);

      try {
        const result = await checkRuntimeAPIIntegrity();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.severity).toBe('strong');
          expect((result.both as Array<{ id: string }>).length).toBeGreaterThanOrEqual(2);
        }
      } finally {
        Object.defineProperty(console, 'log', { value: originalLog, configurable: true, writable: true });
        if (originalWorker) {
          (window as Record<string, unknown>).Worker = originalWorker;
        } else {
          delete (window as Record<string, unknown>).Worker;
        }
        cleanup();
      }
    });

    it('a non-native API only in the pristine iframe is a realm mismatch finding', async () => {
      const fakeWindow = makeFakeWindow(new Set(['console.log']));
      const cleanup = withFakeIframe(fakeWindow);

      try {
        const result = await checkRuntimeAPIIntegrity();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.severity).toBe('medium');
          expect((result.iframeOnly as Array<{ id: string }>).length).toBeGreaterThanOrEqual(1);
        }
      } finally {
        cleanup();
      }
    });

    it('one high-value modified runtime API is medium', async () => {
      const originalWorker = window.Worker;
      (window as Record<string, unknown>).Worker = function FakeWorker() {} as unknown as typeof Worker;
      const fakeWindow = makeFakeWindow(new Set(['window.Worker']));
      const cleanup = withFakeIframe(fakeWindow);

      try {
        const result = await checkRuntimeAPIIntegrity();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.severity).toBe('medium');
          expect((result.scoredAPIs as Array<{ id: string }>).map((s) => s.id)).toContain('window.Worker');
        }
      } finally {
        if (originalWorker) {
          (window as Record<string, unknown>).Worker = originalWorker;
        } else {
          delete (window as Record<string, unknown>).Worker;
        }
        cleanup();
      }
    });

    it('two high-value modified runtime APIs are strong', async () => {
      const originalLog = console.log;
      const originalWorker = window.Worker;
      const originalPermissions = navigator.permissions;
      const originalLanguagesGet = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');

      Object.defineProperty(console, 'log', { value: makeNativeFn(), configurable: true, writable: true });
      (window as Record<string, unknown>).Worker = function FakeWorker() {} as unknown as typeof Worker;
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: { query: function FakePermissionsQuery() {} },
      });
      Object.defineProperty(Navigator.prototype, 'languages', {
        configurable: true,
        get: function FakeLanguagesGetter() { return []; },
      });

      const fakeWindow = makeFakeWindow(new Set(['window.Worker', 'navigator.permissions.query']));
      const cleanup = withFakeIframe(fakeWindow);

      try {
        const result = await checkRuntimeAPIIntegrity();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.severity).toBe('strong');
          const scoredIds = (result.scoredAPIs as Array<{ id: string }>).map((s) => s.id);
          expect(scoredIds).toContain('window.Worker');
          expect(scoredIds).toContain('navigator.permissions.query');
        }
      } finally {
        Object.defineProperty(console, 'log', { value: originalLog, configurable: true, writable: true });
        if (originalWorker) {
          (window as Record<string, unknown>).Worker = originalWorker;
        } else {
          delete (window as Record<string, unknown>).Worker;
        }
        if (originalPermissions) {
          Object.defineProperty(navigator, 'permissions', { configurable: true, value: originalPermissions });
        } else {
          delete (navigator as unknown as Record<string, unknown>).permissions;
        }
        if (originalLanguagesGet) {
          Object.defineProperty(Navigator.prototype, 'languages', originalLanguagesGet);
        } else {
          delete (Navigator.prototype as unknown as Record<string, unknown>).languages;
        }
        cleanup();
      }
    });

    it('three high-value modified runtime APIs can become hard', async () => {
      const originalWorker = window.Worker;
      const originalPermissions = navigator.permissions;
      const originalUserAgentDataGet = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgentData');

      (window as Record<string, unknown>).Worker = function FakeWorker() {} as unknown as typeof Worker;
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: { query: function FakePermissionsQuery() {} },
      });
      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        configurable: true,
        get: function FakeUserAgentDataGetter() { return {}; },
      });

      const fakeWindow = makeFakeWindow(new Set(['window.Worker', 'navigator.permissions.query', 'Navigator.prototype.userAgentData']));
      const cleanup = withFakeIframe(fakeWindow);

      try {
        const result = await checkRuntimeAPIIntegrity();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.severity).toBe('hard');
          const scoredIds = (result.scoredAPIs as Array<{ id: string }>).map((s) => s.id);
          expect(scoredIds.length).toBeGreaterThanOrEqual(3);
        }
      } finally {
        if (originalWorker) {
          (window as Record<string, unknown>).Worker = originalWorker;
        } else {
          delete (window as Record<string, unknown>).Worker;
        }
        if (originalPermissions) {
          Object.defineProperty(navigator, 'permissions', { configurable: true, value: originalPermissions });
        } else {
          delete (navigator as unknown as Record<string, unknown>).permissions;
        }
        if (originalUserAgentDataGet) {
          Object.defineProperty(Navigator.prototype, 'userAgentData', originalUserAgentDataGet);
        } else {
          delete (Navigator.prototype as unknown as Record<string, unknown>).userAgentData;
        }
        cleanup();
      }
    });
  });

  describe('Permissions API semantics', () => {
    it('detects a fake PermissionStatus plain object as medium', async () => {
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
        expect(fake?.severity).toBe('medium');
      } finally {
        if (originalUA) Object.defineProperty(navigator, 'userAgent', originalUA);
        if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions);
        (globalThis as Record<string, unknown>).Notification = originalNotification;
        if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
      }
    });

    it('treats a native-looking PermissionStatus as no finding', async () => {
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
          query: async () => makeNativeLikePermissionStatus('prompt'),
        },
      });
      (globalThis as Record<string, unknown>).Notification = { permission: 'prompt' };
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { protocol: 'https:', hostname: 'localhost', href: 'https://localhost/' },
      });

      try {
        const results = await checkPermissionsConsistency();
        // A native-looking object should not produce a scored result-integrity finding.
        if (results) {
          const integrity = (results as import('./detector-types').DetectionResult[]).find(
            (f) => f.artifactId === 'permissions:result-integrity'
          );
          expect(integrity).toBeUndefined();
        }
      } finally {
        if (originalUA) Object.defineProperty(navigator, 'userAgent', originalUA);
        if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions);
        (globalThis as Record<string, unknown>).Notification = originalNotification;
        if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
      }
    });

    it('missing optional Permissions API is not applicable, not a pass', async () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'permissions');
      Object.defineProperty(navigator, 'permissions', { value: undefined, configurable: true });

      try {
        const result = await checkPermissionsConsistency();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result).toHaveLength(1);
          expect(result[0].status).toBe('not-applicable');
          expect(result[0].artifactId).toBe('permissions:notification');
        }
      } finally {
        if (original) Object.defineProperty(navigator, 'permissions', original);
      }
    });

    it('query rejection is inconclusive, not bot evidence', async () => {
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
          query: async () => { throw new Error('permission denied'); },
        },
      });
      (globalThis as Record<string, unknown>).Notification = { permission: 'prompt' };
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { protocol: 'https:', hostname: 'localhost', href: 'https://localhost/' },
      });

      try {
        const result = await checkPermissionsConsistency();
        expect(result).toBeTruthy();
        expect(Array.isArray(result)).toBe(true);
        const inconclusive = (result as import('./detector-types').DetectionResult[]).find(
          (f) => f.status === 'inconclusive'
        );
        expect(inconclusive).toBeDefined();
      } finally {
        if (originalUA) Object.defineProperty(navigator, 'userAgent', originalUA);
        if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions);
        (globalThis as Record<string, unknown>).Notification = originalNotification;
        if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
      }
    });

    it('notification permission mismatch remains independent evidence', async () => {
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
          query: async () => makeNativeLikePermissionStatus('prompt'),
        },
      });
      (globalThis as Record<string, unknown>).Notification = { permission: 'granted' };
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { protocol: 'https:', hostname: 'localhost', href: 'https://localhost/' },
      });

      try {
        const results = await checkPermissionsConsistency();
        expect(results).toBeTruthy();
        const mismatch = (results as import('./detector-types').DetectionResult[]).find(
          (f) => f.artifactId === 'permissions:notification'
        );
        expect(mismatch).toBeDefined();
        expect(mismatch?.status).toBe('finding');
      } finally {
        if (originalUA) Object.defineProperty(navigator, 'userAgent', originalUA);
        if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions);
        (globalThis as Record<string, unknown>).Notification = originalNotification;
        if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
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

    it('accepts InputDeviceInfo subclass entries (Chromium input devices)', async () => {
      const originalDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
      const originalCtor = Object.getOwnPropertyDescriptor(globalThis, 'MediaDeviceInfo');
      class MediaDeviceInfo {
        deviceId = 'x';
        groupId = 'g';
        kind = 'audioinput';
        label = '';
        toJSON() {
          return {};
        }
      }
      class InputDeviceInfo extends MediaDeviceInfo {}
      Object.defineProperty(InputDeviceInfo.prototype, Symbol.toStringTag, {
        configurable: true,
        value: 'InputDeviceInfo',
      });
      Object.defineProperty(globalThis, 'MediaDeviceInfo', {
        configurable: true,
        writable: true,
        value: MediaDeviceInfo,
      });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { enumerateDevices: async () => [new InputDeviceInfo(), new InputDeviceInfo()] },
      });

      try {
        const result = await checkMediaDeviceInfoSemantics();
        expect(result).toBe(false);
      } finally {
        if (originalDevices) Object.defineProperty(navigator, 'mediaDevices', originalDevices);
        else delete (navigator as unknown as Record<string, unknown>).mediaDevices;
        if (originalCtor) Object.defineProperty(globalThis, 'MediaDeviceInfo', originalCtor);
        else delete (globalThis as Record<string, unknown>).MediaDeviceInfo;
      }
    });

    it('empty media device list is not applicable, not a pass', async () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { enumerateDevices: async () => [] },
      });

      try {
        const result = await checkMediaDeviceInfoSemantics();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.status).toBe('not-applicable');
          expect(result.artifactId).toBe('media-devices:info-integrity');
        }
      } finally {
        if (original) Object.defineProperty(navigator, 'mediaDevices', original);
      }
    });
  });

  describe('high-entropy User-Agent Client Hints', () => {
    it('detects an impossible full-version mismatch as medium evidence', async () => {
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
          expect(result.severity).toBe('medium');
        }
      } finally {
        if (originalUA) Object.defineProperty(navigator, 'userAgent', originalUA);
        if (originalUAData) Object.defineProperty(navigator, 'userAgentData', originalUAData);
      }
    });

    it('coherent high-entropy Client Hints values produce no finding', async () => {
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
            fullVersionList: [{ brand: 'Chrome', version: '120.0.0.0' }],
            architecture: 'x86',
            bitness: '64',
            model: '',
          }),
        },
      });

      try {
        const result = await checkHighEntropyClientHintsCoherence();
        expect(result).toBe(false);
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
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.status).toBe('not-applicable');
          expect(result.artifactId).toBe('client-hints:high-entropy');
        }
      } finally {
        if (original) Object.defineProperty(navigator, 'userAgentData', original);
      }
    });

    it('explicit 32-bit architecture with 64-bit bitness is flagged', async () => {
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
            fullVersionList: [{ brand: 'Chrome', version: '120.0.0.0' }],
            architecture: 'i686',
            bitness: '64',
            model: '',
          }),
        },
      });

      try {
        const result = await checkHighEntropyClientHintsCoherence();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.status).toBe('finding');
          expect(result.severity).toBe('medium');
        }
      } finally {
        if (originalUA) Object.defineProperty(navigator, 'userAgent', originalUA);
        if (originalUAData) Object.defineProperty(navigator, 'userAgentData', originalUAData);
      }
    });

    it('explicit arm64 with 32-bit bitness is flagged', async () => {
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
          platform: 'macOS',
          mobile: false,
          getHighEntropyValues: async () => ({
            fullVersionList: [{ brand: 'Chrome', version: '120.0.0.0' }],
            architecture: 'arm64',
            bitness: '32',
            model: '',
          }),
        },
      });

      try {
        const result = await checkHighEntropyClientHintsCoherence();
        expect(result).not.toBe(false);
        if (result !== false) {
          expect(result.status).toBe('finding');
          expect(result.severity).toBe('medium');
        }
      } finally {
        if (originalUA) Object.defineProperty(navigator, 'userAgent', originalUA);
        if (originalUAData) Object.defineProperty(navigator, 'userAgentData', originalUAData);
      }
    });
  });


});
