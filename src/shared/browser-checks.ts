/**
 * Browser fingerprinting and bot detection checks
 */

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

/** Check CDP via Error.prepareStackTrace */
export function checkCDPViaStackTrace(): Record<string, unknown> | false {
  try {
    const handler = (Error as { prepareStackTrace?: unknown }).prepareStackTrace;
    if (typeof handler === 'undefined') return false;

    const handlerString = (handler as (...args: unknown[]) => unknown).toString();
    if (handlerString.includes('[native code]')) return false;

    const handlerLower = handlerString.toLowerCase();
    let likelySource = 'unknown-script';

    if (handlerLower.includes('devtools') || handlerLower.includes('chrome-extension') || handlerLower.includes('inspector')) {
      likelySource = 'devtools';
    } else if (handlerLower.includes('selenium') || handlerLower.includes('webdriver') || handlerLower.includes('puppeteer') || handlerLower.includes('playwright')) {
      likelySource = 'automation';
    } else if (handlerLower.includes('cdp') || handlerLower.includes('chromedevtools')) {
      likelySource = 'automation';
    }

    return {
      reason: 'nonNativePrepareStackTrace',
      likelySource,
      handlerPreview: handlerString.slice(0, 150),
      description: `Non-native prepareStackTrace handler [${likelySource}]: ${handlerString.slice(0, 60)}...`
    };
  } catch {
    return false;
  }
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

/** Check if browser chrome UI is missing */
export function checkMissingBrowserChrome(): Record<string, unknown> | false {
  if (window.outerWidth === 0 || window.outerHeight === 0) {
    return {
      reason: 'zeroOuter',
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      description: `outerWidth/Height is 0 — classic headless browser indicator`
    };
  }

  if (document.fullscreenElement) return false;

  if (window.outerWidth < window.innerWidth || window.outerHeight < window.innerHeight) {
    return {
      reason: 'noUIChrome',
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      description: `outer < inner (outer: ${window.outerWidth}x${window.outerHeight}, inner: ${window.innerWidth}x${window.innerHeight}) — impossible in real browser`
    };
  }

  return false;
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

  function isNative(fn: unknown): boolean {
    if (typeof fn !== 'function') return false;
    try {
      return Function.prototype.toString.call(fn).indexOf('[native code]') !== -1;
    } catch {
      return false;
    }
  }

  const wdOwn = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
  const wdProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
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
  if (uaOwn && uaOwn.get && !isNative(uaOwn.get)) {
    suspicious.push('userAgentGetterPatched');
  }
  const uaProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
  if (uaProto && uaProto.get && !isNative(uaProto.get)) {
    suspicious.push('userAgentProtoGetterPatched');
  }

  const langProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
  if (langProto && langProto.get && !isNative(langProto.get)) {
    suspicious.push('languagesProtoGetterPatched');
  }

  const pluginsProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'plugins');
  if (pluginsProto && pluginsProto.get && !isNative(pluginsProto.get)) {
    suspicious.push('pluginsProtoGetterPatched');
  }

  if (suspicious.length > 0) {
    return {
      suspicious,
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

/** Check permissions consistency */
export async function checkPermissionsConsistency(): Promise<Record<string, unknown> | false> {
  if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
    return false;
  }

  const issues: Array<{ reason: string; notificationPermission: string; permissionState: string }> = [];
  const canCompareNotificationPermission = isChromiumLike() && isReliablePermissionOrigin();

  if (typeof Notification !== 'undefined' && canCompareNotificationPermission) {
    try {
      const permissionStatus = await navigator.permissions.query({ name: 'notifications' as PermissionName });
      const notificationPermission = normalizeNotificationPermission(Notification.permission);
      const permissionState = normalizeNotificationPermission(permissionStatus.state);

      if (notificationPermission !== permissionState) {
        issues.push({
          reason: 'notificationPermissionMismatch',
          notificationPermission,
          permissionState
        });
      }
    } catch {
      // Firefox/private settings/extensions may reject or restrict this.
      // Do not treat as bot evidence.
    }
  }

  if (issues.length > 0) {
    return {
      reason: 'permissionsInconsistency',
      issues,
      weak: true,
      severity: 'weak',
      description: `Permission API inconsistency: ${issues.map(i => i.reason).join(', ')}`
    };
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

/** Analyze weak signals collectively */
export function analyzeWeakSignals(): Record<string, unknown> | false {
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

  const nativeToString = Function.prototype.toString.call(Function.prototype.toString);
  if (nativeToString.indexOf('[native code]') === -1) {
    signals.push('toStringTampered');
  }

  if (signals.length >= 2) {
    const descriptions: Record<string, string> = {
      'noDevicePixelRatio': 'Missing devicePixelRatio',
      'noVendor': 'Missing navigator.vendor',
      'fakeWebdriverFalse': 'navigator.webdriver set to false (should be undefined)',
      'toStringTampered': 'Function.toString has been modified'
    };

    return {
      signals,
      description: `Weak signals: ${signals.slice(0, 2).map(s => descriptions[s] || s).join(', ')}${signals.length > 2 ? '...' : ''}`
    };
  }

  return false;
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
            resolve(false);
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
              issues: issues.map(i => i.reason),
              description: issues.map(i => i.description).join('; ')
            });
          } else {
            resolve(false);
          }
        } catch {
          cleanup();
          resolve(false);
        }
      };

      iframe.onerror = function() {
        cleanup();
        resolve(false);
      };

      setTimeout(() => {
        cleanup();
        resolve(false);
      }, 2000);

      document.body.appendChild(iframe);
    } catch {
      resolve(false);
    }
  });
}
