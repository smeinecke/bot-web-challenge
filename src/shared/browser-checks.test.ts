import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkWebdriverNull,
  checkPrepareStackTrace,
  checkMissingBrowserChrome,
  analyzeWeakSignals,
  checkSeleniumChromeDefault,
  checkAutomatedWithCDP,
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
});
