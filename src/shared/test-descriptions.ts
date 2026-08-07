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

  hasWebdriverNull:
    'Checks whether navigator.webdriver is null. In a normal, unpatched browser this property is not null (it is either undefined when no automation is present, or true when the browser is under automation). A null value indicates a patched Chromium IDL returning C++ std::nullopt.',

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
    'Validates outerWidth/outerHeight relative to innerWidth/innerHeight. Zero outer dimensions are a strong classic-headless signal. outer < inner is a strong browser-consistency violation. outer === inner outside fullscreen is a weak contextual observation and cannot produce a bot verdict alone.',

  hasScreenAvailabilityAnomaly:
    'On Windows desktop, checks whether screen.availWidth/Height equals screen.width/height. A missing taskbar difference suggests a remote desktop or headless session.',

  hasTouchInconsistency:
    'Cross-references touch capability: mobile User-Agent without touch support, or coarse pointer media query with zero maxTouchPoints. Inconsistencies indicate UA spoofing or emulation.',

  hasNavigatorIntegrityViolation:
    'Inspects property descriptors on navigator and Navigator.prototype. Flags non-native getters for webdriver, userAgent, languages, or plugins — signs of anti-detection patching.',

  hasCanvasAvailabilityIssue:
    'Performs a canvas fingerprinting drawing routine and checks the resulting data URL. Empty or very short data indicates a blocked, headless, or privacy-hardened canvas implementation.',

  isAutomatedViaStackTrace:
    'Inspects Error.prepareStackTrace in the main realm and a clean same-origin iframe. Non-native handlers are classified by source: explicit automation markers (Selenium, WebDriver, Playwright, Puppeteer, CDP) are strong automation findings; DevTools or extension handlers are informational; unknown/obfuscated handlers are medium integrity findings. A mismatch between the main realm and a clean iframe is separate corroborating integrity evidence.',

  hasAudioFingerprintIssue:
    'Uses an OfflineAudioContext to render a short audio buffer and sums sample magnitudes. Headless/sandboxed environments often produce a silent or near-zero sum due to missing audio subsystem.',

  hasInconsistentWorkerValues:
    'Spawns a Web Worker and compares its navigator values (userAgent, webdriver, platform, hardwareConcurrency, languages, WebGL vendor/renderer) against the main thread. Differences indicate automation patching or anti-detection tampering. Failed worker creation, timeout, or unsupported workers are reported as inconclusive, never as a pass.',

  isAutomatedWithCDPInWebWorker:
    'Runs inside a Web Worker to detect CDP automation markers that may be injected into worker globals by automation frameworks. Failed worker creation, timeout, or unsupported workers are reported as inconclusive, never as a pass.',

  hasBlobIframeCDPIssue:
    'Creates a blob-URL iframe and compares navigator properties (webdriver, userAgent, languages, chrome object) between the main frame and the isolated iframe. Mismatches reveal CDP or anti-detection manipulation. Iframe load errors, access failures, and timeouts are reported as inconclusive, not as a pass.',

  hasCrossRealmInconsistency:
    'Collects the same set of observations from the main window, a same-origin iframe, a blob-URL iframe, a Web Worker, and a SharedWorker when available, then compares values, property descriptors, and prototype tags. Each probe declares the realms in which it is valid (e.g. screen and devicePixelRatio are window-only, WebGL uses OffscreenCanvas in workers). Inconsistencies across applicable realms suggest an environment that patched individual properties but failed to keep the fake state coherent everywhere. Probe evaluation errors in applicable realms are reported as inconclusive rather than a pass or mismatch.',

  hasSyntheticEventTrustedInvariant:
    'Creates a synthetic JavaScript Event and dispatches it on an isolated EventTarget. A script-created event must always have isTrusted === false. If the constructed or dispatched event reports isTrusted === true, the browser is violating a standards-level invariant.',

  hasRuntimeAPIIntegrityViolation:
    'Inspects a set of core browser runtime APIs in the main realm and a pristine same-origin about:blank iframe (console.log, window.Worker, navigator.permissions.query, navigator.mediaDevices.enumerateDevices, speechSynthesis.getVoices, WebGL getParameter, WebGL2 getParameter, and the Navigator.prototype.userAgentData getter). APIs that are only non-native in the main realm are page-local instrumentation and reported as info. APIs that are non-native in the pristine iframe are genuine runtime-tampering evidence: one is medium, two are strong, three or more are hard. Missing or unsupported APIs are not suspicious.',

  hasMediaDeviceInfoIntegrity:
    'Queries navigator.mediaDevices.enumerateDevices() and checks whether returned entries structurally resemble native MediaDeviceInfo objects (prototype tag, constructor name, toJSON method). An empty list is not suspicious; permission-denied or unsupported mediaDevices is N/A.',

  hasHighEntropyClientHintsCoherence:
    'Requests high-entropy User-Agent Client Hints (architecture, bitness, platformVersion, fullVersionList, model) and checks them for internal coherence against low-entropy Client Hints and the User-Agent string. Missing or withheld high-entropy hints are N/A, not bot evidence.',

  hasWebGLWebGPUCoherence:
    'Requests a WebGPU adapter and compares adapter.info with the unmasked WebGL vendor/renderer. Only a clear contradiction is reported (e.g. WebGL claims a physical GPU while WebGPU explicitly identifies a software/fallback adapter). Missing or redacted WebGPU information is not suspicious.',

  hasSuspiciousWeakSignals:
    'Collects minor anomalies: missing devicePixelRatio, empty vendor on Chrome, forced navigator.webdriver=false, and tampered Function.prototype.toString. Two or more weak signals together raise suspicion.',

  hasPermissionsInconsistency:
    'Queries the Permissions API for notifications and compares it with Notification.permission. Mismatches can indicate patched permission states used by anti-detection extensions. The structural integrity of the returned PermissionStatus object is also validated; a plain object literal containing only {state, onchange} is not considered a native PermissionStatus. Unsupported or blocked Permissions APIs are N/A, not bot evidence.',

  hasPluginsMimeTypesIssue:
    'Validates navigator.plugins and navigator.mimeTypes on desktop Chrome. Zero plugins, patched getters, or mismatched prototype tags are signs of incognito/headless/privacy modes.',

  hasLocaleTimezoneIntlIssue:
    'Compares Intl.DateTimeFormat locale, timezone, navigator.language, and navigator.languages. navigator.language not being in navigator.languages, or different default locales across Intl objects, are treated as weak findings. A default Intl locale that differs from navigator.language is treated as diagnostic info because it is common on Linux and not a reliable automation invariant by itself.',

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

  insufficientObservationWindow:
    'Tracks whether enough interaction data has been collected to analyze behavior. If not, the result is inconclusive and prevents a clean human verdict.',

  lowObservationSubmission:
    'Analyzes submissions that occur with very little interaction data. It considers populated fields without trusted keyboard/input activity, extremely fast submit after focus, missing focus history, direct value assignment, and no pointer activity. Ordinary browser autofill is not classified as a bot without corroborating anomalies.',
};
