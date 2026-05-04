/**
 * Detailed human-readable descriptions for each detector test.
 * These are shown in a modal when the user clicks the (?)
 * button next to a test result.
 */

export const TEST_DESCRIPTIONS: Record<string, string> = {
  hasBotUserAgent:
    'Scans the browser\'s User-Agent string for known automation frameworks, crawlers, scrapers, and headless browsers (e.g. HeadlessChrome, Selenium, Playwright, Puppeteer, PhantomJS, curl, python-requests). A match indicates the client is likely a bot rather than a real user.',

  hasWebdriverTrue:
    'Checks whether navigator.webdriver is set to true. This property is automatically enabled by Chrome when controlled by automation tools (Selenium, Chromedriver, etc.). In a normal browser it should be undefined.',

  hasWebdriverInFrameTrue:
    'Creates a hidden iframe and checks if navigator.webdriver is true inside it. Some anti-detection scripts only patch the main window, leaving the iframe untouched, so this test can catch evasion attempts.',

  isPlaywright:
    'Looks for Playwright-specific JavaScript globals such as __pwInitScripts or __playwright__binding__ injected into the page during browser automation.',

  hasInconsistentChromeObject:
    'On Chromium-based browsers, verifies the presence and shape of window.chrome. Missing window.chrome or a shallow object without expected subobjects (runtime, app) suggests a spoofed or headless environment.',

  isPhantom:
    'Detects PhantomJS-specific globals like callPhantom, _phantom, or phantom. PhantomJS is an old headless browser often used in scraping.',

  isNightmare:
    'Searches for the __nightmare global introduced by the Nightmare.js high-level browser automation library.',

  isSequentum:
    'Checks window.external for the Sequentum string, a signature of the Sequentum enterprise web-scraping platform.',

  isSeleniumChromeDefault:
    'Searches the DOM and window object for the well-known ChromeDriver CDC markers (e.g. cdc_adoQpoasnfa76pfcZLmcfl_) that Chromedriver leaves behind in default configurations.',

  isHeadlessChrome:
    'Looks for headless-specific indicators: HeadlessChrome in the User-Agent, missing navigator.languages, or zero outerWidth/outerHeight values.',

  isWebGLInconsistent:
    'Queries the WebGL renderer and vendor strings via the WEBGL_debug_renderer_info extension. Flags software renderers (SwiftShader, llvmpipe) or missing info that are common in headless/VM environments.',

  isAutomatedWithCDP:
    'Scans the global scope for Chrome DevTools Protocol (CDP) evaluation markers such as __cdp_eval, __selenium_eval, and CDC variables left by automation tools.',

  hasInconsistentClientHints:
    'Compares the User-Agent Client Hints API (navigator.userAgentData) against the regular User-Agent string. Mismatches in brand or platform suggest UA spoofing or tampering.',

  hasInconsistentGPUFeatures:
    'Reads WebGL capability limits (MAX_TEXTURE_SIZE, MAX_VIEWPORT_DIMS). Very low limits indicate software rendering, which is typical for VMs and headless browsers.',

  isIframeOverridden:
    'Creates a hidden iframe and checks whether its navigator object is missing or its toString method has been tampered with. Anti-detection scripts sometimes override iframe behavior.',

  hasHighHardwareConcurrency:
    'Reads navigator.hardwareConcurrency. Values significantly above 16 cores are uncommon for consumer devices and may indicate a cloud/VM environment used for automation.',

  hasHeadlessChromeDefaultScreenResolution:
    'Checks if the screen resolution matches known headless Chrome defaults (e.g. 800x600) or has an implausible aspect ratio, suggesting a non-interactive environment.',

  hasMissingBrowserChrome:
    'Validates that outerWidth/outerHeight are non-zero and that outer dimensions are larger than inner dimensions (normal browser chrome). Zero outer dimensions or outer < inner are strong headless indicators.',

  hasScreenAvailabilityAnomaly:
    'On Windows desktop, checks whether screen.availWidth/Height equals screen.width/height. A missing taskbar difference suggests a remote desktop or headless session.',

  hasTouchInconsistency:
    'Cross-references touch capability: mobile User-Agent without touch support, or coarse pointer media query with zero maxTouchPoints. Inconsistencies indicate UA spoofing or emulation.',

  hasNavigatorIntegrityViolation:
    'Inspects property descriptors on navigator and Navigator.prototype. Flags non-native getters for webdriver, userAgent, languages, or plugins — signs of anti-detection patching.',

  hasCanvasAvailabilityIssue:
    'Performs a canvas fingerprinting drawing routine and checks the resulting data URL. Empty or very short data indicates a blocked, headless, or privacy-hardened canvas implementation.',

  isAutomatedViaStackTrace:
    'Checks Error.prepareStackTrace for a non-native handler. Automation frameworks and browser extensions often inject custom stack-trace handlers; the handler body is analyzed to distinguish devtools from automation.',

  hasAudioFingerprintIssue:
    'Uses an OfflineAudioContext to render a short audio buffer and sums sample magnitudes. Headless/sandboxed environments often produce a silent or near-zero sum due to missing audio subsystem.',

  hasInconsistentWorkerValues:
    'Spawns a Web Worker and compares its navigator values (userAgent, languages, platform, hardwareConcurrency) against the main thread. Differences indicate automation patching or anti-detection tampering.',

  isAutomatedWithCDPInWebWorker:
    'Runs inside a Web Worker to detect CDP automation markers that may be injected into worker globals by automation frameworks.',

  hasBlobIframeCDPIssue:
    'Creates a blob-URL iframe and compares navigator properties (webdriver, userAgent, languages, chrome object) between the main frame and the isolated iframe. Mismatches reveal CDP or anti-detection manipulation.',

  hasSuspiciousWeakSignals:
    'Collects minor anomalies: missing devicePixelRatio, empty vendor on Chrome, forced navigator.webdriver=false, and tampered Function.prototype.toString. Two or more weak signals together raise suspicion.',

  hasPermissionsInconsistency:
    'Queries the Permissions API for notifications and compares it with Notification.permission. Mismatches can indicate patched permission states used by anti-detection extensions.',

  hasPluginsMimeTypesIssue:
    'Validates navigator.plugins and navigator.mimeTypes on desktop Chrome. Zero plugins, patched getters, or mismatched prototype tags are signs of incognito/headless/privacy modes.',

  hasLocaleTimezoneIntlIssue:
    'Compares Intl.DateTimeFormat locale, timezone, navigator.language, and navigator.languages. Mismatches or a non-English browser in UTC suggest locale spoofing or misconfiguration.',

  hasViewportScreenCoherenceIssue:
    'Checks screen orientation vs. dimensions, visual viewport scale, and inner vs. outer size ratios. Incoherent values reveal mobile emulation, RDP scaling, or headless sizing artifacts.',

  hasAutomationGlobalsExtended:
    'Scans window and document for an extended list of automation globals (domAutomation, __webdriver_script_fn, __selenium_unwrapped, etc.).',

  suspiciousClientSideBehavior:
    'Analyzes captured mouse and keyboard events for bot-like patterns: >95% straight mouse lines, uniform event timing, instant form completion (<500ms), paste-only input, or insufficient mouse movement.',

  superHumanSpeed:
    'Calculates characters-per-second from keystroke timing. Values above 15 CPS or completing a >5-character form in under 500ms exceed realistic human typing speeds.',

  hasCDPMouseLeak:
    'Inspects mouse-move screen coordinates. In CDP-automated Chrome, screenX/Y often equal clientX/Y even when the window has a non-zero screen offset. A high ratio of these events indicates CDP control.',

  hasAdvancedBotSignals:
    'Looks for advanced interaction anomalies: synthetic (untrusted) events, clicks exactly at element center, clicks at (0,0), empty key-event codes, and unnaturally uniform keystroke intervals.',
};
