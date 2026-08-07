/**
 * Browser fingerprinting and bot detection checks
 */
import {
  finding,
  inconclusive,
  pass,
  type DetectionCategory,
  type DetectionResult,
  type DetectionSeverity,
} from './detector-types';

// Bot user agent patterns with confidence levels
const BOT_UA_PATTERNS = [
  {
    name: 'automation-framework',
    pattern: /\b(?:headlesschrome|phantomjs|slimerjs|selenium|puppeteer|playwright|webdriver|nightmare|chrome-lighthouse|headless)\b/i,
    confidence: 'high'
  },
  {
    name: 'search-social-crawler',
    pattern: /\b(?:googlebot|bingbot|duckduckbot|baiduspider|yandexbot|applebot|facebookexternalhit|facebot|twitterbot|linkedinbot|slurp|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|bytespider|adsbot-google|mediapartners-google|google-inspectiontool|googleother|googleother-image|googleother-video|storebot-google|pinterestbot|discordbot|slackbot|telegrambot|redditbot|whatsapp|skypeuripreview)\b/i,
    confidence: 'high'
  },
  {
    name: 'ai-crawler',
    pattern: /\b(?:gptbot|chatgpt-user|oai-searchbot|ccbot|claudebot|claude-user|claude-searchbot|anthropic-ai|perplexitybot|perplexity-user|amazonbot|meta-externalagent|facebookbot|google-extended|turnitin|screaming frog|siteauditbot)\b/i,
    confidence: 'high'
  },
  {
    name: 'http-client',
    pattern: /\b(?:curl|wget|python-requests|python-urllib|python-httpx|httpx|aiohttp|go-http-client|okhttp|java\/|node-fetch|undici|axios|got|php-curl|ruby|restsharp|powershell|winhttp|libcurl|httpie|reqwest|hackney|fasthttp|apachebench|ab\/)\b/i,
    confidence: 'high'
  },
  {
    name: 'scraper-tool',
    pattern: /\b(?:scrapy|guzzlehttp|faraday|mechanize|libwww-perl|apache-httpclient|postmanruntime|insomnia|httpclient)\b/i,
    confidence: 'high'
  },
  {
    name: 'generic-bot-term',
    pattern: /\b(?:crawler|spider|scraper)(?:\b|[_-])/i,
    confidence: 'medium'
  }
];

// Headless default screen resolutions
const HEADLESS_RESOLUTIONS = [
  { width: 800, height: 600 }
];

/** Check if user agent matches bot patterns */
export function checkBotUserAgent(): { rule: string; confidence: string; match: string; description: string } | false {
  const ua = navigator.userAgent || '';

  for (const rule of BOT_UA_PATTERNS) {
    const match = ua.match(rule.pattern);
    if (match) {
      return {
        rule: rule.name,
        confidence: rule.confidence,
        match: match[0],
        description: `User-Agent matched ${rule.name}: ${match[0]} (${rule.confidence} confidence)`
      };
    }
  }

  return false;
}

/** Check navigator.webdriver property */
export function checkWebdriver(): boolean {
  return navigator.webdriver === true;
}

/**
 * Check whether navigator.webdriver is null.
 *
 * In a normal, unpatched browser `navigator.webdriver` is either `undefined`
 * (not present) or, when under automation, `true`. It is not `null`. A patched
 * Chromium build that changes the IDL type to a nullable boolean and returns
 * C++ `std::nullopt` produces JavaScript `null` — a known anti-detection
 * fingerprint.
 */
export function checkWebdriverNull(): boolean {
  return navigator.webdriver === null;
}

/** Check for webdriver in iframe */
export function checkWebdriverInFrame(): boolean {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  try {
    const frameWindow = iframe.contentWindow;
    return frameWindow !== null && frameWindow.navigator.webdriver === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(iframe);
  }
}

/** Check for Playwright globals */
export function checkPlaywright(): boolean {
  return typeof (window as Record<string, unknown>).__pwInitScripts !== 'undefined' ||
         typeof (window as Record<string, unknown>).__playwright__binding__ !== 'undefined' ||
         typeof (window as Record<string, unknown>)._playwrightBinding !== 'undefined';
}

/** Check for inconsistent chrome object */
export function checkInconsistentChrome(): { reason: string; description: string; weak?: boolean } | false {
  const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
  if (!isChrome) return false;

  if (typeof (window as Record<string, unknown>).chrome === 'undefined') {
    return { reason: 'chromeMissing', description: 'window.chrome missing on Chromium browser' };
  }

  // Modern stealth environments often provide window.chrome but with shallow or malformed subobjects
  const chromeObj = (window as Record<string, unknown>).chrome;
  const expectedKeys = ['runtime', 'app', 'csi', 'loadTimes'];
  const presentKeys = expectedKeys.filter(k => k in (chromeObj as Record<string, unknown> || {}));
  // All can be legitimately absent in modern Chrome (csi/loadTimes removed),
  // but `runtime` and `app` are usually present.
  if (typeof chromeObj === 'object' && presentKeys.length === 0) {
    return {
      reason: 'chromeShallow',
      description: 'window.chrome exists but has no expected subobjects — likely spoofed',
      weak: true
    };
  }

  return false;
}

/** Check for PhantomJS */
export function checkPhantomJS(): boolean {
  return typeof (window as Record<string, unknown>).callPhantom !== 'undefined' ||
         typeof (window as Record<string, unknown>)._phantom !== 'undefined' ||
         typeof (window as Record<string, unknown>).phantom !== 'undefined';
}

/** Check for Nightmare.js */
export function checkNightmare(): boolean {
  return typeof (window as Record<string, unknown>).__nightmare !== 'undefined';
}

/** Check for Sequentum */
export function checkSequentum(): boolean {
  try {
    return window.external && window.external.toString &&
           window.external.toString().indexOf('Sequentum') !== -1;
  } catch {
    return false;
  }
}

/** Check for Selenium Chrome default marker */
export function checkSeleniumChromeDefault(): boolean {
  const cdcKeys = [
    'cdc_adoQpoasnfa76pfcZLmcfl_',
    '$cdc_asdjflasutopfhvcZLmcfl_',
    'cdc_asdjflasutopfhvcZLmcfl_Array',
    'cdc_asdjflasutopfhvcZLmcfl_Promise',
    'cdc_asdjflasutopfhvcZLmcfl_Symbol'
  ];
  for (const key of cdcKeys) {
    if (key in window || key in document) {
      return true;
    }
  }
  return false;
}

/** Check for headless Chrome indicators */
export function checkHeadlessChrome(): { indicators: string[]; description: string } | false {
  const indicators: string[] = [];

  if (!navigator.languages || navigator.languages.length === 0) {
    indicators.push('noLanguages');
  }

  if (/HeadlessChrome/.test(navigator.userAgent)) {
    indicators.push('headlessInUA');
  }

  if (window.outerWidth === 0 || window.outerHeight === 0) {
    indicators.push('zeroOuterDimensions');
  }

  if (indicators.length > 0) {
    return {
      indicators,
      description: `Headless Chrome detected: ${indicators.slice(0, 2).join(', ')}${indicators.length > 2 ? '...' : ''}`
    };
  }

  return false;
}

/** Check client hints consistency */
export function checkInconsistentClientHints(): { inconsistencies: string[]; hintPlatform?: string; description: string } | false {
  if (!navigator.userAgentData) {
    return false;
  }

  const hints = navigator.userAgentData;
  const ua = navigator.userAgent;
  const inconsistencies: string[] = [];

  if (hints.brands) {
    const hasChromeBrand = hints.brands.some(b =>
      b.brand.includes('Chrome') || b.brand.includes('Chromium')
    );
    const uaHasChrome = /Chrome/.test(ua) || /Chromium/.test(ua);

    if (hasChromeBrand !== uaHasChrome) {
      inconsistencies.push('brandMismatch');
    }
  }

  const platform = hints.platform;
  if (platform) {
    const platformMap: Record<string, RegExp> = {
      'Windows': /Windows|Win/,
      'macOS': /Mac/,
      'Linux': /Linux/,
      'Android': /Android/,
      'iOS': /iPhone|iPad|iPod/
    };

    let platformMatch = false;
    for (const [hintPlatform, uaPattern] of Object.entries(platformMap)) {
      if (platform.includes(hintPlatform) && uaPattern.test(ua)) {
        platformMatch = true;
        break;
      }
    }

    if (platform.includes('Android') && /Linux/.test(ua) && /Android/.test(ua)) {
      platformMatch = true;
    }

    if (!platformMatch) {
      inconsistencies.push('platformMismatch');
    }
  }

  if (inconsistencies.length > 0) {
    return {
      inconsistencies,
      hintPlatform: hints.platform ?? undefined,
      description: `Client hints inconsistent: ${inconsistencies.join(', ')} - possible UA spoofing`
    };
  }

  return false;
}

/** Check WebGL for inconsistencies */
export function checkWebGLInconsistent(): Record<string, unknown> | false {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;

    if (!gl) return false;

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return false;

    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

    const suspiciousRenderers = ['SwiftShader', 'llvmpipe', 'software', 'Google SwiftShader'];

    if (suspiciousRenderers.some(r => renderer && renderer.includes(r))) {
      return {
        vendor,
        renderer,
        reason: 'softwareRenderer',
        description: `Software renderer detected: ${renderer}`
      };
    }

    if (!vendor || !renderer) {
      return {
        vendor: vendor || 'null',
        renderer: renderer || 'null',
        reason: 'missingInfo',
        description: 'Missing WebGL vendor/renderer info'
      };
    }

    return false;
  } catch (e) {
    const err = e as Error;
    return { reason: 'exception', message: err.message, description: `WebGL error: ${err.message}` };
  }
}

/** Check for inconsistent GPU features */
export function checkInconsistentGPUFeatures(): Record<string, unknown> | false {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (!gl) return false;

    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);

    if (maxTextureSize < 1024 || (maxViewportDims && maxViewportDims[0] < 1024)) {
      return {
        maxTextureSize,
        maxViewportDims: maxViewportDims ? `${maxViewportDims[0]}x${maxViewportDims[1]}` : 'N/A',
        reason: 'veryLowLimits',
        description: `Very low GPU limits (texture: ${maxTextureSize}) suggest software rendering`
      };
    }

    return false;
  } catch (e) {
    const err = e as Error;
    return { reason: 'exception', message: err.message, description: 'Error accessing WebGL' };
  }
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return hash;
}

interface PrepareStackTraceInfo {
  source: string;
  sourceHash: number;
  sourcePreview: string;
  isNative: boolean;
  descriptorOwner: string;
  isDataProperty: boolean;
  isGetter: boolean;
}

function getPrepareStackTraceInfo(ErrorCtor: unknown): PrepareStackTraceInfo | null {
  try {
    if (typeof ErrorCtor !== 'function') return null;

    let owner = 'Error';
    let descriptor = Object.getOwnPropertyDescriptor(ErrorCtor, 'prepareStackTrace');
    if (!descriptor && (ErrorCtor as { prototype?: unknown }).prototype) {
      descriptor = Object.getOwnPropertyDescriptor(
        (ErrorCtor as { prototype: Record<string, unknown> }).prototype,
        'prepareStackTrace'
      );
      owner = 'Error.prototype';
    }

    const handler = descriptor?.value ?? descriptor?.get?.();
    if (typeof handler !== 'function') return null;

    const source = Function.prototype.toString.call(handler);
    const isNative = source.includes('[native code]');

    return {
      source,
      sourceHash: hashString(source),
      sourcePreview: source.slice(0, 80).replace(/\s+/g, ' '),
      isNative,
      descriptorOwner: owner,
      isDataProperty: descriptor ? 'value' in descriptor : false,
      isGetter: descriptor ? typeof descriptor.get === 'function' : false,
    };
  } catch {
    return null;
  }
}

function classifyPrepareStackTraceSource(source: string): {
  severity: DetectionSeverity;
  category: DetectionCategory;
  reason: string;
  description: string;
} {
  const lower = source.toLowerCase();

  const automationKeywords = [
    'selenium',
    'webdriver',
    'playwright',
    'puppeteer',
    'cdp',
    'chrome devtools protocol',
    'chromedevtools',
  ];
  const devtoolsKeywords = ['devtools', 'chrome-extension', 'inspector'];

  const hasAutomation = automationKeywords.some(k => lower.includes(k));
  const hasDevTools = devtoolsKeywords.some(k => lower.includes(k));

  if (hasAutomation) {
    return {
      severity: 'strong',
      category: 'automation-global',
      reason: 'non-native-automation-handler',
      description: 'Error.prepareStackTrace handler contains explicit automation framework markers',
    };
  }

  if (hasDevTools) {
    return {
      severity: 'info',
      category: 'api-integrity',
      reason: 'non-native-devtools-handler',
      description: 'Error.prepareStackTrace handler appears to originate from browser DevTools or an extension',
    };
  }

  return {
    severity: 'medium',
    category: 'browser-integrity',
    reason: 'non-native-unknown-handler',
    description: 'Error.prepareStackTrace handler is non-native with unknown or obfuscated source',
  };
}

/**
 * Inspect Error.prepareStackTrace across the main realm and a clean same-origin
 * iframe. Non-native handlers are classified by source. A mismatch between the
 * main realm and the iframe is recorded as separate integrity evidence.
 */
export function checkPrepareStackTrace(): DetectionResult[] {
  const results: DetectionResult[] = [];

  try {
    const mainInfo = getPrepareStackTraceInfo(Error);
    if (!mainInfo) {
      results.push(
        pass('browser-integrity', 'prepare-stack-trace:main', 'main', 'no-handler', 'Error.prepareStackTrace is not defined')
      );
    } else if (mainInfo.isNative) {
      results.push(
        pass('browser-integrity', 'prepare-stack-trace:main', 'main', 'native-handler', 'Error.prepareStackTrace is native')
      );
    } else {
      const classification = classifyPrepareStackTraceSource(mainInfo.source);
      results.push(
        finding(
          classification.severity,
          classification.category,
          'prepare-stack-trace:main',
          'main',
          classification.reason,
          classification.description,
          {
            sourceHash: mainInfo.sourceHash,
            sourcePreview: mainInfo.sourcePreview,
            sourceLength: mainInfo.source.length,
            descriptorOwner: mainInfo.descriptorOwner,
            isDataProperty: mainInfo.isDataProperty,
            isGetter: mainInfo.isGetter,
          }
        )
      );
    }

    // Cross-realm comparison using a clean same-origin iframe.
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = 'about:blank';
    document.body.appendChild(iframe);

    try {
      const frameWindow = iframe.contentWindow;
      if (frameWindow) {
        const frameError = (frameWindow as unknown as Record<string, unknown>).Error;
        const frameInfo = getPrepareStackTraceInfo(frameError);
        if (frameInfo) {
          const mainNative = mainInfo?.isNative ?? false;
          const frameNative = frameInfo.isNative;
          const mismatch = mainNative !== frameNative || (mainInfo && frameInfo.sourceHash !== mainInfo.sourceHash);

          if (mismatch) {
            results.push(
              finding(
                'medium',
                'browser-integrity',
                'prepare-stack-trace:realm-mismatch',
                'iframe',
                'realm-mismatch',
                'Error.prepareStackTrace handler or descriptor differs between main realm and clean iframe',
                {
                  mainNative,
                  frameNative,
                  mainHash: mainInfo?.sourceHash,
                  frameHash: frameInfo.sourceHash,
                }
              )
            );
          }
        }
      }
    } catch {
      // iframe inspection failed — do not convert to a pass.
      results.push(
        inconclusive(
          'browser-integrity',
          'prepare-stack-trace:realm-mismatch',
          'iframe',
          'iframe-inspection-failed',
          'Could not inspect Error.prepareStackTrace in clean same-origin iframe'
        )
      );
    } finally {
      document.body.removeChild(iframe);
    }
  } catch (e) {
    results.push(
      inconclusive(
        'browser-integrity',
        'prepare-stack-trace:main',
        'main',
        'inspection-exception',
        `Error.prepareStackTrace inspection failed: ${(e as Error).message}`
      )
    );
  }

  return results;
}

/**
 * @deprecated Use `checkPrepareStackTrace` for the new structured result model.
 */
export function checkCDPViaStackTrace(): DetectionResult[] {
  return checkPrepareStackTrace();
}

/** Check audio fingerprint for headless indicators */
export function checkAudioFingerprint(): Promise<Record<string, unknown> | false> {
  return new Promise((resolve) => {
    try {
      const AC = window.AudioContext || ((window as unknown) as Record<string, unknown>).webkitAudioContext as typeof AudioContext | undefined;
      const OAC = window.OfflineAudioContext || ((window as unknown) as Record<string, unknown>).webkitOfflineAudioContext as typeof OfflineAudioContext | undefined;

      if (!AC || !OAC) {
        resolve(false);
        return;
      }

      const ctx = new OAC(1, 44100, 44100);
      const osc = ctx.createOscillator();
      const compressor = ctx.createDynamicsCompressor();

      osc.type = 'triangle';
      osc.frequency.value = 10000;

      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;

      osc.connect(compressor);
      compressor.connect(ctx.destination);
      osc.start(0);

      ctx.startRendering();
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ reason: 'timeout', description: 'Audio fingerprint timed out' });
        }
      }, 2000);

      ctx.oncomplete = function(e: { renderedBuffer: AudioBuffer }) {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        try {
          const buffer = e.renderedBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 4500; i < 5000; i++) {
            sum += Math.abs(buffer[i]);
          }

          if (sum === 0 || sum < 0.001) {
            resolve({
              sum: sum.toFixed(6),
              reason: 'suspiciousSum',
              description: `Audio fingerprint sum (${sum.toFixed(6)}) indicates headless/sandboxed environment`
            });
          } else {
            resolve(false);
          }
        } catch (_err) {
          resolve({ reason: 'processingError', description: 'Error processing audio data' });
        }
      };
    } catch (e) {
      const err = e as Error;
      resolve({ reason: 'exception', description: `Audio fingerprint error: ${err.message}` });
    }
  });
}

/** Check canvas API availability */
export function checkCanvasAvailability(): Record<string, unknown> | false {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return { reason: 'no2DContext', weak: true, description: 'Canvas 2D context unavailable' };
    }

    ctx.rect(0, 0, 10, 10);
    ctx.rect(2, 2, 6, 6);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.font = '11pt no-real-font-123';
    ctx.fillText('Cwm fjordbank glyphs vext quiz, 😃', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.2)';
    ctx.font = '18pt Arial';
    ctx.fillText('Cwm fjordbank glyphs vext quiz, 😃', 4, 45);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(255,0,255)';
    ctx.beginPath();
    ctx.arc(50, 50, 50, 0, 2 * Math.PI, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgb(0,255,255)';
    ctx.beginPath();
    ctx.arc(100, 50, 50, 0, 2 * Math.PI, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgb(255,255,0)';
    ctx.beginPath();
    ctx.arc(75, 100, 50, 0, 2 * Math.PI, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgb(255,0,255)';
    ctx.arc(75, 75, 75, 0, 2 * Math.PI, true);
    ctx.arc(75, 75, 25, 0, 2 * Math.PI, true);
    ctx.fill('evenodd');

    const data = canvas.toDataURL();
    if (!data || data.length < 100) {
      return { reason: 'emptyOrMalformedCanvasData', weak: true, description: 'Canvas returned empty or malformed data URL' };
    }

    return false;
  } catch (e) {
    const err = e as Error;
    return { reason: 'exception', description: `Canvas error: ${err.message}` };
  }
}

/** Check for CDP automation in main context */
export function checkAutomatedWithCDP(): { marker: string; description: string } | false {
  const cdpMarkers = [
    '__cdp_eval', '__cdp_js_executor', '__selenium_eval',
    '__fxdriver_eval', '__webdriver_eval', 'cdc_adoQpoasnfa76pfcZLmcfl_',
    '$cdc_asdjflasutopfhvcZLmcfl_'
  ];

  for (const marker of cdpMarkers) {
    if (marker in window) {
      return { marker, description: `CDP marker found: ${marker}` };
    }
  }

  return false;
}

/** Check for iframe behavior being overridden */
export function checkIframeOverridden(): { reason: string; description: string } | false {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  try {
    const contentWindow = iframe.contentWindow;

    if (contentWindow && !('navigator' in contentWindow)) {
      return { reason: 'noNavigator', description: 'Iframe navigator missing - anti-detection script likely active' };
    }

    if (contentWindow && contentWindow.toString && contentWindow.toString.toString().indexOf('[native code]') === -1) {
      return { reason: 'toStringModified', description: 'Iframe toString modified - anti-detection evasion detected' };
    }

    return false;
  } catch {
    return false;
  } finally {
    document.body.removeChild(iframe);
  }
}

/** Check hardware concurrency */
export function checkHighHardwareConcurrency(): { cores: number; threshold: number; description: string } | false {
  const cores = navigator.hardwareConcurrency;

  if (!cores || cores === 0) {
    return false;
  }

  if (cores > 16) {
    return {
      cores,
      threshold: 16,
      description: `${cores} CPU cores detected (high for consumer device) - possible VM/cloud environment`
    };
  }

  return false;
}

/** Check for headless Chrome default screen resolution */
export function checkHeadlessResolution(): Record<string, unknown> | false {
  const width = window.screen.width;
  const height = window.screen.height;

  for (const res of HEADLESS_RESOLUTIONS) {
    if (width === res.width && height === res.height) {
      return {
        width,
        height,
        match: res,
        description: `Resolution ${width}x${height} matches headless Chrome default`
      };
    }
  }

  const aspectRatio = width / height;
  if (aspectRatio < 0.4 || aspectRatio > 3.5) {
    return {
      width,
      height,
      aspectRatio: aspectRatio.toFixed(2),
      reason: 'extremeAspect',
      description: `Extreme aspect ratio ${aspectRatio.toFixed(2)} detected - may indicate emulation`
    };
  }

  return false;
}

/**
 * Check browser chrome dimensions.
 *
 * - Zero outer dimensions are a strong classic-headless signal.
 * - outer < inner is a strong browser-consistency violation.
 * - outer === inner outside fullscreen is a weak contextual observation.
 */
export function checkMissingBrowserChrome(): DetectionResult[] {
  const results: DetectionResult[] = [];
  const outerWidth = window.outerWidth;
  const outerHeight = window.outerHeight;
  const innerWidth = window.innerWidth;
  const innerHeight = window.innerHeight;

  if (outerWidth === 0 || outerHeight === 0) {
    results.push(
      finding(
        'strong',
        'environment',
        'browser-chrome:zero-outer',
        'main',
        'zero-outer',
        `outerWidth/Height is 0 — classic headless browser indicator`,
        { outerWidth, outerHeight }
      )
    );
    return results;
  }

  if (document.fullscreenElement) {
    results.push(
      pass('environment', 'browser-chrome', 'main', 'fullscreen', 'Fullscreen active — chrome equality expected')
    );
    return results;
  }

  if (outerWidth < innerWidth || outerHeight < innerHeight) {
    results.push(
      finding(
        'strong',
        'environment',
        'browser-chrome:outer-lt-inner',
        'main',
        'outer-lt-inner',
        `outer < inner (outer: ${outerWidth}x${outerHeight}, inner: ${innerWidth}x${innerHeight}) — impossible in real browser`,
        { outerWidth, outerHeight, innerWidth, innerHeight }
      )
    );
    return results;
  }

  if (outerWidth > 0 && outerWidth === innerWidth && outerHeight === innerHeight) {
    results.push(
      finding(
        'weak',
        'environment',
        'browser-chrome:outer-eq-inner',
        'main',
        'outer-eq-inner',
        'outerWidth/Height equals innerWidth/Height outside fullscreen — weak headless/emulation context',
        { outerWidth, outerHeight, innerWidth, innerHeight }
      )
    );
    return results;
  }

  results.push(
    pass('environment', 'browser-chrome', 'main', 'no-anomaly', 'Browser chrome dimensions look normal')
  );
  return results;
}

/** Check screen availability */
export function checkScreenAvailability(): Record<string, unknown> | false {
  const isWindows = /Win/.test(navigator.platform) || /Windows/.test(navigator.userAgent);
  if (!isWindows) return false;

  const isMobile = /Mobile|Android|iPhone|iPad/.test(navigator.userAgent);
  if (isMobile) return false;

  if (window.screen.availHeight === window.screen.height &&
      window.screen.availWidth === window.screen.width) {
    return {
      reason: 'noTaskbar',
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      description: `screen.avail === screen dimensions on Windows — no taskbar detected (${window.screen.width}x${window.screen.height})`
    };
  }

  return false;
}

/** Check for touch support inconsistencies */
export function checkTouchInconsistency(): Record<string, unknown> | false {
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const hasTouchEvent = 'ontouchstart' in window;
  const isMobileUA = /Mobile|Android|iPhone|iPad/.test(navigator.userAgent);
  const hasCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  if (isMobileUA && maxTouchPoints === 0 && !hasTouchEvent) {
    return {
      reason: 'mobileUANoTouch',
      maxTouchPoints,
      description: 'Mobile UA string but no touch support — UA spoofing likely'
    };
  }

  if (hasCoarsePointer && maxTouchPoints === 0) {
    return {
      reason: 'coarsePointerNoTouchPoints',
      description: 'Media query reports coarse pointer but maxTouchPoints is 0 — inconsistent'
    };
  }

  return false;
}

/** Check Navigator prototype chain integrity */
export function checkNavigatorIntegrity(): Record<string, unknown> | false {
  const suspicious: string[] = [];
  const descriptors: Array<{ property: string; location: string; type: string; native?: boolean }> = [];

  function isNative(fn: unknown): boolean {
    if (typeof fn !== 'function') return false;
    try {
      return Function.prototype.toString.call(fn).indexOf('[native code]') !== -1;
    } catch {
      return false;
    }
  }

  function recordDescriptor(property: string, location: string, desc: PropertyDescriptor | undefined, native?: boolean) {
    const type = !desc ? 'none' : ('value' in desc ? 'data' : ('get' in desc || 'set' in desc ? 'accessor' : 'other'));
    descriptors.push({ property, location, type, native });
  }

  const wdOwn = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
  const wdProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
  recordDescriptor('navigator.webdriver', 'own', wdOwn, wdOwn?.get ? isNative(wdOwn.get) : undefined);
  recordDescriptor('navigator.webdriver', 'prototype', wdProto, wdProto?.get ? isNative(wdProto.get) : undefined);
  if (wdOwn) {
    if (!wdOwn.get && wdOwn.value === false) {
      suspicious.push('webdriverForcedFalse');
    }
    if (wdOwn.get && !isNative(wdOwn.get)) {
      suspicious.push('webdriverGetterPatched');
    }
  }
  if (wdProto && wdProto.get && !isNative(wdProto.get)) {
    suspicious.push('webdriverProtoGetterPatched');
  }

  const uaOwn = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  recordDescriptor('navigator.userAgent', 'own', uaOwn, uaOwn?.get ? isNative(uaOwn.get) : undefined);
  if (uaOwn && uaOwn.get && !isNative(uaOwn.get)) {
    suspicious.push('userAgentGetterPatched');
  }
  const uaProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
  recordDescriptor('navigator.userAgent', 'prototype', uaProto, uaProto?.get ? isNative(uaProto.get) : undefined);
  if (uaProto && uaProto.get && !isNative(uaProto.get)) {
    suspicious.push('userAgentProtoGetterPatched');
  }

  const langProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
  recordDescriptor('navigator.languages', 'prototype', langProto, langProto?.get ? isNative(langProto.get) : undefined);
  if (langProto && langProto.get && !isNative(langProto.get)) {
    suspicious.push('languagesProtoGetterPatched');
  }
  const langOwn = Object.getOwnPropertyDescriptor(navigator, 'languages');
  recordDescriptor('navigator.languages', 'own', langOwn, langOwn?.get ? isNative(langOwn.get) : undefined);
  if (langOwn && langOwn.get && !isNative(langOwn.get)) {
    suspicious.push('languagesOwnGetterPatched');
  }

  const languageProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'language');
  recordDescriptor('navigator.language', 'prototype', languageProto, languageProto?.get ? isNative(languageProto.get) : undefined);
  if (languageProto && languageProto.get && !isNative(languageProto.get)) {
    suspicious.push('languageProtoGetterPatched');
  }
  const languageOwn = Object.getOwnPropertyDescriptor(navigator, 'language');
  recordDescriptor('navigator.language', 'own', languageOwn, languageOwn?.get ? isNative(languageOwn.get) : undefined);
  if (languageOwn && languageOwn.get && !isNative(languageOwn.get)) {
    suspicious.push('languageOwnGetterPatched');
  }

  const pluginsProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'plugins');
  recordDescriptor('navigator.plugins', 'prototype', pluginsProto, pluginsProto?.get ? isNative(pluginsProto.get) : undefined);
  if (pluginsProto && pluginsProto.get && !isNative(pluginsProto.get)) {
    suspicious.push('pluginsProtoGetterPatched');
  }

  if (suspicious.length > 0) {
    return {
      suspicious,
      descriptors,
      description: `Navigator property tampering: ${suspicious.join(', ')}`
    };
  }

  return false;
}

/** Normalize notification permission values */
export function normalizeNotificationPermission(value: string): string {
  return value === 'default' ? 'prompt' : value;
}

function isChromiumLike(): boolean {
  return /Chrome|Chromium|Edg\//.test(navigator.userAgent);
}

function isReliablePermissionOrigin(): boolean {
  return window.location.protocol === 'https:' ||
         window.location.hostname === 'localhost' ||
         window.location.hostname === '127.0.0.1';
}

function looksLikeNativePermissionStatus(status: PermissionStatus): { looksNative: boolean; tag: string; constructorName: string; hasAddEventListener: boolean } {
  const Constructor = typeof PermissionStatus !== 'undefined' ? PermissionStatus : null;
  const tag = Object.prototype.toString.call(status);
  const proto = Object.getPrototypeOf(status);
  const constructorName = proto && proto.constructor && proto.constructor.name ? proto.constructor.name : '';
  const hasAddEventListener = typeof (status as EventTarget & { addEventListener?: unknown }).addEventListener === 'function';

  const looksNative =
    tag === '[object PermissionStatus]' &&
    constructorName === 'PermissionStatus' &&
    hasAddEventListener &&
    (!Constructor || status instanceof Constructor);

  return { looksNative, tag, constructorName, hasAddEventListener };
}

/** Check permissions consistency and PermissionStatus object integrity */
export async function checkPermissionsConsistency(): Promise<DetectionResult[] | false> {
  if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
    return false;
  }

  const findings: DetectionResult[] = [];
  const canCompareNotificationPermission = isChromiumLike() && isReliablePermissionOrigin();

  try {
    if (typeof Notification !== 'undefined' && canCompareNotificationPermission) {
      const permissionStatus = await navigator.permissions.query({ name: 'notifications' as PermissionName });
      const notificationPermission = normalizeNotificationPermission(Notification.permission);
      const permissionState = normalizeNotificationPermission(permissionStatus.state);

      if (notificationPermission !== permissionState) {
        findings.push(
          finding(
            'weak',
            'permissions',
            'permissions:notification',
            'main',
            'notification-permission-mismatch',
            `Notification permission state mismatch: Notification.permission=${notificationPermission}, PermissionStatus.state=${permissionState}`,
            { notificationPermission, permissionState }
          )
        );
      }

      const integrity = looksLikeNativePermissionStatus(permissionStatus);
      if (!integrity.looksNative) {
        const severity = integrity.tag === '[object Object]' ? 'strong' : 'medium';
        findings.push(
          finding(
            severity,
            'permissions',
            'permissions:result-integrity',
            'main',
            'permission-status-fake',
            'PermissionStatus result does not appear to be a native object',
            integrity
          )
        );
      }
    }
  } catch {
    // Unsupported/blocked Permissions APIs are N/A, not bot evidence.
    return false;
  }

  if (findings.length > 0) {
    return findings;
  }
  return false;
}

/** Check plugins and MIME types consistency */
export function checkPluginsMimeTypes(): Record<string, unknown> | false {
  const isChromeDesktop = /Chrome/.test(navigator.userAgent) &&
                          /Google Inc/.test(navigator.vendor) &&
                          !/Mobile|Android|iPhone|iPad/.test(navigator.userAgent);

  const plugins = navigator.plugins;
  const mimeTypes = navigator.mimeTypes;

  if (!plugins || !mimeTypes) {
    return false;
  }

  if (isChromeDesktop && plugins.length === 0) {
    return {
      reason: 'zeroPluginsChromeDesktop',
      weak: true,
      description: 'Desktop Chrome reports zero plugins — possible incognito/headless/privacy mode'
    };
  }

  try {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'plugins');
    if (desc && desc.get) {
      const str = Function.prototype.toString.call(desc.get);
      if (str.indexOf('[native code]') === -1) {
        return {
          reason: 'pluginsGetterPatched',
          severity: 'medium',
          description: 'navigator.plugins getter has been tampered with'
        };
      }
    }
  } catch {}

  if (plugins.length > 0 && mimeTypes.length === 0) {
    return {
      reason: 'pluginsWithoutMimeTypes',
      weak: true,
      description: 'navigator.plugins exists but navigator.mimeTypes is empty'
    };
  }

  try {
    const pluginTag = Object.prototype.toString.call(plugins);
    const mimeTag = Object.prototype.toString.call(mimeTypes);
    const tagIssues: string[] = [];

    if (pluginTag !== '[object PluginArray]') {
      tagIssues.push('invalidPluginArrayTag');
    }
    if (mimeTag !== '[object MimeTypeArray]') {
      tagIssues.push('invalidMimeTypeArrayTag');
    }
    if (tagIssues.length > 0) {
      return {
        reason: tagIssues[0],
        issues: tagIssues,
        weak: true,
        description: `Prototype tag mismatch: ${tagIssues.join(', ')}`
      };
    }
  } catch {}

  return false;
}

/** Check locale, timezone, and Intl coherence */
export function checkLocaleTimezoneIntl(): Record<string, unknown> | false {
  const issues: string[] = [];

  try {
    const dtf = Intl.DateTimeFormat().resolvedOptions();
    const nf = Intl.NumberFormat().resolvedOptions();
    const coll = Intl.Collator().resolvedOptions();
    const tz = dtf.timeZone;
    const locale = dtf.locale;

    const navLang = (navigator.language || '').toLowerCase();
    if (locale && !locale.toLowerCase().startsWith(navLang.split('-')[0])) {
      issues.push('intlLocaleMismatch');
    }

    const isEn = navLang.startsWith('en');
    if (!isEn && (tz === 'UTC' || tz === 'GMT' || tz === 'Etc/UTC')) {
      issues.push('nonEnglishBrowserInUTC');
    }

    const langs = navigator.languages || [];
    if (langs.length > 0 && !langs.some(l => l.toLowerCase().startsWith(navLang.split('-')[0]))) {
      issues.push('languagesListMismatch');
    }

    const nfLocale = nf.locale || '';
    const collLocale = coll.locale || '';
    if (locale && nfLocale && locale !== nfLocale) {
      issues.push('intlLocaleInconsistent');
    }
    if (locale && collLocale && locale !== collLocale) {
      issues.push('intlCollatorLocaleInconsistent');
    }
  } catch {
    // Intl not supported
  }

  if (issues.length > 0) {
    return {
      issues,
      weak: true,
      description: `Locale/timezone/Intl coherence issues: ${issues.join(', ')}`
    };
  }
  return false;
}

/** Check viewport, screen, DPR, and orientation coherence */
export function checkViewportScreenCoherence(): Record<string, unknown> | false {
  const issues: string[] = [];
  const ua = navigator.userAgent || '';
  const isMobileUA = /Mobile|Android|iPhone|iPad/.test(ua);

  const dpr = window.devicePixelRatio || 1;
  const sw = window.screen.width || 0;
  const sh = window.screen.height || 0;
  const iw = window.innerWidth || 0;
  const ih = window.innerHeight || 0;

  if (isMobileUA && dpr === 1 && sw >= 375) {
    issues.push('mobileUANoRetinaDpr');
  }

  if (!document.fullscreenElement && (window.outerWidth > 0 && iw > window.outerWidth * 1.5)) {
    issues.push('innerMuchLargerThanOuter');
  }

  if (screen.orientation && screen.orientation.type) {
    const isPortrait = screen.orientation.type.startsWith('portrait');
    if (isPortrait && sw > sh) {
      issues.push('portraitOrientationLandscapeDimensions');
    }
    if (!isPortrait && sh > sw) {
      issues.push('landscapeOrientationPortraitDimensions');
    }
  }

  if (window.visualViewport) {
    const vv = window.visualViewport;

    if (vv.scale <= 0 || vv.scale > 10) {
      issues.push('invalidVisualViewportScale');
    }

    if (vv.scale === 1 && Math.abs(vv.width - iw) > 2) {
      issues.push('visualViewportWidthMismatch');
    }

    if (vv.scale === 1 && Math.abs(vv.height - ih) > 2) {
      issues.push('visualViewportHeightMismatch');
    }
  }

  if (issues.length > 0) {
    return {
      issues,
      weak: true,
      description: `Viewport/screen coherence issues: ${issues.join(', ')}`
    };
  }
  return false;
}

/** Extended automation-specific globals check */
export function checkAutomationGlobalsExtended(): Record<string, unknown> | false {
  const markers = [
    'domAutomation', 'domAutomationController',
    '__webdriver_script_fn', '__driver_evaluate',
    '__webdriver_evaluate', '__selenium_unwrapped',
    '__fxdriver_unwrapped', '_Selenium_IDE_Recorder',
    'cdc_adoQpoasnfa76pfcZLmcfl_',
    '$cdc_asdjflasutopfhvcZLmcfl_'
  ];

  const found: string[] = [];
  for (const marker of markers) {
    if (marker in window || marker in document) {
      found.push(marker);
    }
  }

  if (found.length > 0) {
    return {
      markers: found,
      description: `Automation globals detected: ${found.join(', ')}`
    };
  }
  return false;
}

/**
 * Analyze weak signals collectively.
 *
 * Each signal is preserved in the raw observation, but scoring fuses them into
 * a single `suspicious-weak-signals` artifact. `navigator.webdriver === null`
 * is emitted as the dedicated `webdriver:null` artifact so it is never double
 * scored.
 */
export function analyzeWeakSignals(): DetectionResult[] {
  const signals: string[] = [];

  if (typeof window.devicePixelRatio === 'undefined') {
    signals.push('noDevicePixelRatio');
  }

  if (navigator.vendor === '' && /Chrome/.test(navigator.userAgent)) {
    signals.push('noVendor');
  }

  if (navigator.webdriver === false && /Chrome/.test(navigator.userAgent)) {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
    if (descriptor && !descriptor.get && descriptor.value === false) {
      signals.push('fakeWebdriverFalse');
    }
  }

  if (navigator.webdriver === null) {
    signals.push('webdriverIsNull');
  }

  const nativeToString = Function.prototype.toString.call(Function.prototype.toString);
  if (nativeToString.indexOf('[native code]') === -1) {
    signals.push('toStringTampered');
  }

  const results: DetectionResult[] = [];
  const descriptions: Record<string, string> = {
    'noDevicePixelRatio': 'Missing devicePixelRatio',
    'noVendor': 'Missing navigator.vendor',
    'fakeWebdriverFalse': 'navigator.webdriver set to false (should not be a data property)',
    'webdriverIsNull': 'navigator.webdriver is null — not a normal unpatched browser value',
    'toStringTampered': 'Function.prototype.toString has been modified'
  };

  if (navigator.webdriver === null) {
    results.push(
      finding(
        'hard',
        'webdriver',
        'webdriver:null',
        'main',
        'webdriver-is-null',
        'navigator.webdriver is null — patched Chromium IDL returning std::nullopt',
        { signal: 'webdriverIsNull' }
      )
    );
  }

  const nonWebdriverSignals = signals.filter(s => s !== 'webdriverIsNull');
  if (nonWebdriverSignals.length >= 2) {
    results.push(
      finding(
        'weak',
        'browser-integrity',
        'suspicious-weak-signals',
        'main',
        'multiple-weak-signals',
        `Weak signals: ${nonWebdriverSignals.slice(0, 2).map(s => descriptions[s] || s).join(', ')}${nonWebdriverSignals.length > 2 ? '...' : ''}`,
        { signals: nonWebdriverSignals }
      )
    );
  }

  if (results.length === 0) {
    results.push(
      pass('browser-integrity', 'suspicious-weak-signals', 'main', 'no-weak-signals', 'No weak signals detected')
    );
  }

  return results;
}

/** Check Event.isTrusted invariant for synthetic events */
export function checkSyntheticEventIsTrusted(): DetectionResult[] {
  const artifactId = 'event:is-trusted-invariant';
  try {
    if (typeof Event === 'undefined' || typeof EventTarget === 'undefined') {
      return [inconclusive('browser-integrity', artifactId, 'main', 'event-api-missing', 'Event or EventTarget API is not available')];
    }

    const target = new EventTarget();
    const eventName = 'synthetic-trusted-invariant-' + Math.random().toString(36).slice(2);
    let observed: boolean | undefined;
    const handler = (e: Event) => { observed = e.isTrusted; };
    target.addEventListener(eventName, handler);

    const synthetic = new Event(eventName);
    const constructedIsTrusted = synthetic.isTrusted;
    target.dispatchEvent(synthetic);
    target.removeEventListener(eventName, handler);

    if (constructedIsTrusted === true || observed === true) {
      return [
        finding(
          'hard',
          'browser-integrity',
          artifactId,
          'main',
          'synthetic-event-reported-trusted',
          'A script-created/dispatched Event reported isTrusted === true',
          { constructedIsTrusted, observed }
        )
      ];
    }

    if (constructedIsTrusted === false && observed === false) {
      return [
        pass('browser-integrity', artifactId, 'main', 'synthetic-event-untrusted', 'Synthetic Event is not trusted')
      ];
    }

    return [
      inconclusive(
        'browser-integrity',
        artifactId,
        'main',
        'untrusted-check-incomplete',
        'Could not determine Event.isTrusted for synthetic event',
        { constructedIsTrusted, observed }
      )
    ];
  } catch (e) {
    return [
      inconclusive(
        'browser-integrity',
        artifactId,
        'main',
        'exception',
        `Synthetic event trust check failed: ${(e as Error).message}`
      )
    ];
  }
}

interface RuntimeAPIModification {
  id: string;
  owner: 'own' | 'prototype' | 'none';
  descriptorType: string;
  functionName: string;
  functionLength: number;
  toStringPreview: string;
  toStringHash: number;
  toStringNative: boolean;
}

function checkOwnAndPrototype(obj: object, prop: string): PropertyDescriptor | undefined {
  let own = Object.getOwnPropertyDescriptor(obj, prop);
  if (own) return own;
  let proto = Object.getPrototypeOf(obj);
  while (proto) {
    own = Object.getOwnPropertyDescriptor(proto, prop);
    if (own) return own;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

function isNativeFunction(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  try {
    return Function.prototype.toString.call(fn).includes('[native code]');
  } catch {
    return false;
  }
}

function getFunctionNameAndLength(fn: unknown): { name: string; length: number } {
  try {
    return { name: (fn as { name?: string }).name ?? '', length: (fn as { length?: number }).length ?? 0 };
  } catch {
    return { name: '', length: 0 };
  }
}

function describeDescriptorType(desc: PropertyDescriptor | undefined): string {
  if (!desc) return 'none';
  if ('value' in desc) return 'data';
  if (desc.get && desc.set) return 'accessor-get-set';
  if (desc.get) return 'accessor-get';
  if (desc.set) return 'accessor-set';
  return 'other';
}

interface RuntimeAPIEntry {
  id: string;
  obj: object;
  prop: string;
  fn: () => unknown;
}

function buildRuntimeAPIEntries(): RuntimeAPIEntry[] {
  const entries: RuntimeAPIEntry[] = [];

  entries.push({ id: 'console.log', obj: console as unknown as object, prop: 'log', fn: () => (console as unknown as Record<string, unknown>).log });

  if (typeof window !== 'undefined') {
    entries.push({ id: 'window.Worker', obj: window, prop: 'Worker', fn: () => window.Worker });
  }

  if (navigator.permissions) {
    entries.push({
      id: 'navigator.permissions.query',
      obj: navigator.permissions as unknown as object,
      prop: 'query',
      fn: () => navigator.permissions.query,
    });
  }

  if (navigator.mediaDevices) {
    entries.push({
      id: 'navigator.mediaDevices.enumerateDevices',
      obj: navigator.mediaDevices as unknown as object,
      prop: 'enumerateDevices',
      fn: () => navigator.mediaDevices.enumerateDevices,
    });
  }

  const speechSynth = typeof window !== 'undefined' ? window.speechSynthesis : (typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined);
  if (speechSynth) {
    entries.push({
      id: 'speechSynthesis.getVoices',
      obj: speechSynth as unknown as object,
      prop: 'getVoices',
      fn: () => speechSynth.getVoices,
    });
  }

  if (typeof WebGLRenderingContext !== 'undefined') {
    entries.push({
      id: 'WebGLRenderingContext.prototype.getParameter',
      obj: WebGLRenderingContext.prototype as unknown as object,
      prop: 'getParameter',
      fn: () => WebGLRenderingContext.prototype.getParameter,
    });
  }

  if (typeof WebGL2RenderingContext !== 'undefined') {
    entries.push({
      id: 'WebGL2RenderingContext.prototype.getParameter',
      obj: WebGL2RenderingContext.prototype as unknown as object,
      prop: 'getParameter',
      fn: () => WebGL2RenderingContext.prototype.getParameter,
    });
  }

  if (typeof Navigator !== 'undefined') {
    entries.push({
      id: 'Navigator.prototype.userAgentData',
      obj: Navigator.prototype as unknown as object,
      prop: 'userAgentData',
      fn: () => Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgentData')?.get,
    });
  }

  return entries;
}

/** Check runtime API integrity across multiple browser APIs */
export function checkRuntimeAPIIntegrity(): Record<string, unknown> | false {
  const suspicious: RuntimeAPIModification[] = [];

  for (const entry of buildRuntimeAPIEntries()) {
    try {
      const fn = entry.fn();
      if (typeof fn !== 'function') continue;
      if (isNativeFunction(fn)) continue;

      const desc = checkOwnAndPrototype(entry.obj, entry.prop);
      const ownDesc = Object.getOwnPropertyDescriptor(entry.obj, entry.prop);
      const owner = ownDesc === desc ? 'own' : 'prototype';
      const { name, length } = getFunctionNameAndLength(fn);
      const source = Function.prototype.toString.call(fn);

      suspicious.push({
        id: entry.id,
        owner,
        descriptorType: describeDescriptorType(desc),
        functionName: name,
        functionLength: length,
        toStringPreview: source.slice(0, 80).replace(/\s+/g, ' '),
        toStringHash: hashString(source),
        toStringNative: source.includes('[native code]'),
      });
    } catch {
      // Skip APIs that cannot be inspected.
    }
  }

  if (suspicious.length === 0) return false;

  const severity: 'medium' | 'strong' | 'hard' =
    suspicious.length === 1 ? 'medium' : suspicious.length === 2 ? 'strong' : 'hard';

  return {
    artifactId: 'runtime-api:integrity',
    category: 'api-integrity',
    severity,
    reason: 'runtime-api-tampering',
    description: `${suspicious.length} browser runtime API(s) appear to be non-native: ${suspicious.map((s) => s.id).join(', ')}`,
    modifiedAPIs: suspicious,
  };
}

/** Check MediaDeviceInfo object semantics */
export async function checkMediaDeviceInfoSemantics(): Promise<DetectionResult | false> {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
    return false;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (!Array.isArray(devices) || devices.length === 0) {
      return false;
    }

    const fakes: Array<{ index: number; toStringTag: string; constructorName: string; hasToJSON: boolean }> = [];
    const globalConstructor = typeof MediaDeviceInfo !== 'undefined' ? MediaDeviceInfo : null;

    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      const toStringTag = Object.prototype.toString.call(d);
      const proto = Object.getPrototypeOf(d);
      const constructorName = proto && proto.constructor && proto.constructor.name ? proto.constructor.name : '';
      const hasToJSON = typeof (d as { toJSON?: unknown }).toJSON === 'function';
      const looksNative =
        toStringTag === '[object MediaDeviceInfo]' &&
        constructorName === 'MediaDeviceInfo' &&
        hasToJSON &&
        (!globalConstructor || d instanceof globalConstructor);

      if (!looksNative) {
        fakes.push({ index: i, toStringTag, constructorName, hasToJSON });
      }
    }

    if (fakes.length === 0) return false;

    return finding(
      'medium',
      'api-integrity',
      'media-devices:info-integrity',
      'main',
      'media-device-info-fake',
      `${fakes.length} MediaDeviceInfo entry/entries do not resemble native objects`,
      { fakes, total: devices.length }
    );
  } catch {
    // Permission denied or unsupported — not bot evidence.
    return false;
  }
}

/** Check high-entropy User-Agent Client Hints coherence */
export async function checkHighEntropyClientHintsCoherence(): Promise<DetectionResult | false> {
  const uaData = navigator.userAgentData;
  if (!uaData || typeof uaData.getHighEntropyValues !== 'function') {
    return false;
  }

  try {
    const high = await uaData.getHighEntropyValues(['architecture', 'bitness', 'platformVersion', 'fullVersionList', 'model']);
    if (!high || typeof high !== 'object') {
      return false;
    }

    const issues: string[] = [];
    const ua = navigator.userAgent;

    const fullVersionList = (high.fullVersionList as Array<{ brand: string; version: string }> | undefined) || [];
    const chromeEntry = fullVersionList.find((b) => /Chrome|Chromium/.test(b.brand));
    const uaMatch = ua.match(/(?:Chrome|Chromium)\/(\d+)/);
    if (chromeEntry && uaMatch) {
      const highMajor = parseInt(chromeEntry.version.split('.')[0], 10);
      const uaMajor = parseInt(uaMatch[1], 10);
      if (!isNaN(highMajor) && !isNaN(uaMajor) && highMajor !== uaMajor) {
        issues.push('fullVersionMajorMismatch');
      }
    }

    const arch = (high.architecture as string | undefined) || '';
    const bitness = (high.bitness as string | undefined) || '';
    if (arch && bitness) {
      const is64Arch = /\b(x86_64|x86-64|amd64|em64t)\b/i.test(arch);
      const is32Arch = /\b(x86|i[36]86|i686)\b/i.test(arch) && !is64Arch;
      if ((is64Arch && bitness !== '64') || (is32Arch && bitness === '64')) {
        issues.push('architectureBitnessMismatch');
      }
    }

    const model = (high.model as string | undefined) || '';
    if (model && uaData.mobile === false) {
      issues.push('modelOnNonMobile');
    }

    if (issues.length === 0) return false;

    const severity: 'medium' | 'hard' = issues.some((i) => i === 'fullVersionMajorMismatch' || i === 'architectureBitnessMismatch') ? 'hard' : 'medium';

    return finding(
      severity,
      'api-integrity',
      'client-hints:high-entropy',
      'main',
      'high-entropy-client-hints-inconsistent',
      'High-entropy Client Hints contradict the User-Agent or low-entropy Client Hints',
      {
        issues,
        lowEntropy: { brands: uaData.brands, platform: uaData.platform, mobile: uaData.mobile },
        highEntropy: high,
      }
    );
  } catch {
    // Unsupported or blocked high-entropy hints are not bot evidence.
    return false;
  }
}

/** Check for CDP/automation leaks via blob URL iframe */
export function checkBlobIframeCDP(): Promise<Record<string, unknown> | false> {
  return new Promise((resolve) => {
    try {
      const html = '<!DOCTYPE html><html><head></head><body></body></html>';
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;

      let resolved = false;
      function cleanup() {
        if (resolved) return;
        resolved = true;
        try { URL.revokeObjectURL(url); } catch {}
        try { document.body.removeChild(iframe); } catch {}
      }

      iframe.onload = function() {
        try {
          const win = iframe.contentWindow;
          if (!win) {
            cleanup();
            resolve({ inconclusive: true, reason: 'iframeAccessError', description: 'Blob iframe contentWindow is null' });
            return;
          }

          const issues: Array<{ reason: string; description: string }> = [];

          const mainWebdriver = navigator.webdriver;
          const frameWebdriver = win.navigator.webdriver;
          if (mainWebdriver !== frameWebdriver) {
            issues.push({
              reason: 'webdriverMismatch',
              description: `navigator.webdriver mismatch: main=${mainWebdriver}, iframe=${frameWebdriver}`
            });
          }

          const cdpMarkers = [
            '__cdp_eval', '__cdp_js_executor', '__selenium_eval',
            '__fxdriver_eval', '__webdriver_eval', 'cdc_adoQpoasnfa76pfcZLmcfl_'
          ];
          for (const marker of cdpMarkers) {
            if (marker in win) {
              issues.push({
                reason: 'cdpMarkerInIframe',
                description: `CDP marker ${marker} found in blob iframe`
              });
            }
          }

          if (navigator.userAgent !== win.navigator.userAgent) {
            issues.push({
              reason: 'userAgentMismatch',
              description: 'User-Agent mismatch between main frame and blob iframe'
            });
          }

          const mainLangs = JSON.stringify(navigator.languages || []);
          const frameLangs = JSON.stringify(win.navigator.languages || []);
          if (mainLangs !== frameLangs) {
            issues.push({
              reason: 'languagesMismatch',
              description: 'navigator.languages mismatch between main frame and blob iframe'
            });
          }

          const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
          if (isChrome && typeof (win as Record<string, unknown>).chrome === 'undefined') {
            issues.push({
              reason: 'chromeMissingInIframe',
              description: 'window.chrome missing in blob iframe on Chromium browser'
            });
          }

          cleanup();

          if (issues.length > 0) {
            resolve({
              artifactId: 'cdp:blob-iframe-mismatch',
              category: 'cdp',
              reason: 'cdp-blob-iframe-mismatch',
              severity: 'medium',
              issues: issues.map(i => i.reason),
              description: issues.map(i => i.description).join('; ')
            });
          } else {
            resolve(false);
          }
        } catch (e) {
          cleanup();
          resolve({ inconclusive: true, reason: 'iframeAccessError', description: `Blob iframe inspection failed: ${(e as Error).message}` });
        }
      };

      iframe.onerror = function() {
        cleanup();
        resolve({ inconclusive: true, reason: 'iframeLoadError', description: 'Blob iframe failed to load' });
      };

      setTimeout(() => {
        cleanup();
        resolve({ inconclusive: true, reason: 'iframeTimeout', description: 'Blob iframe probe timed out' });
      }, 2000);

      document.body.appendChild(iframe);
    } catch (e) {
      resolve({ inconclusive: true, reason: 'iframeException', description: `Blob iframe exception: ${(e as Error).message}` });
    }
  });
}
