/**
 * Bot Detection Challenge - Shared Utilities
 * Common functions used by both static and interaction detectors
 */

(function() {
    'use strict';

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

    // Headless default screen resolutions (only use resolutions that are headless-specific,
    // not common consumer resolutions like 1280x720, 1280x800, 1920x1080)
    const HEADLESS_RESOLUTIONS = [
        { width: 800, height: 600 }
    ];

    /**
     * Check if user agent matches bot patterns
     * Returns false if no match, or an object with match details if matched
     */
    function checkBotUserAgent() {
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

    /**
     * Check navigator.webdriver property
     */
    function checkWebdriver() {
        return navigator.webdriver === true;
    }

    /**
     * Check for webdriver in iframe
     */
    function checkWebdriverInFrame() {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        try {
            const frameWindow = iframe.contentWindow;
            return frameWindow && frameWindow.navigator && frameWindow.navigator.webdriver === true;
        } catch (e) {
            return false;
        } finally {
            document.body.removeChild(iframe);
        }
    }

    /**
     * Check for Playwright globals
     */
    function checkPlaywright() {
        return typeof window.__pwInitScripts !== 'undefined' ||
               typeof window.__playwright__binding__ !== 'undefined' ||
               typeof window._playwrightBinding !== 'undefined';
    }

    /**
     * Check for inconsistent chrome object.
     * Real Chrome always exposes window.chrome; headless and many spoofed UAs leave it absent.
     * Note: loadTimes/csi/app were removed in Chrome 97+ so we only check object existence.
     */
    function checkInconsistentChrome() {
        const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
        if (!isChrome) return false;

        if (typeof window.chrome === 'undefined') {
            return { reason: 'chromeMissing', description: 'window.chrome missing on Chromium browser' };
        }

        // Modern stealth environments often provide window.chrome but with shallow or
        // malformed subobjects. Check expected Chrome object shape.
        const expectedKeys = ['runtime', 'app', 'csi', 'loadTimes'];
        const presentKeys = expectedKeys.filter(k => k in (window.chrome || {}));
        // All can be legitimately absent in modern Chrome (csi/loadTimes removed),
        // but `runtime` and `app` are usually present.
        if (typeof window.chrome === 'object' && presentKeys.length === 0) {
            return {
                reason: 'chromeShallow',
                description: 'window.chrome exists but has no expected subobjects — likely spoofed',
                weak: true
            };
        }

        return false;
    }

    /**
     * Check for PhantomJS
     */
    function checkPhantomJS() {
        return typeof window.callPhantom !== 'undefined' ||
               typeof window._phantom !== 'undefined' ||
               typeof window.phantom !== 'undefined';
    }

    /**
     * Check for Nightmare.js
     */
    function checkNightmare() {
        return typeof window.__nightmare !== 'undefined';
    }

    /**
     * Check for Sequentum
     */
    function checkSequentum() {
        try {
            return window.external && window.external.toString &&
                   window.external.toString().indexOf('Sequentum') !== -1;
        } catch (e) {
            return false;
        }
    }

    /**
     * Check for Selenium Chrome default marker
     */
    function checkSeleniumChromeDefault() {
        // Target specific known CDC key variants instead of iterating all window properties
        const cdcKeys = [
            'cdc_adoQpoasnfa76pfcZLmcfl_',
            '$cdc_asdjflasutopfhvcZLmcfl_',
            'cdc_asdjflasutopfhvcZLmcfl_Array',
            'cdc_asdjflasutopfhvcZLmcfl_Promise',
            'cdc_asdjflasutopfhvcZLmcfl_Symbol'
        ];
        for (const key of cdcKeys) {
            if (typeof window[key] !== 'undefined' || typeof document[key] !== 'undefined') {
                return true;
            }
        }
        return false;
    }

    /**
     * Check for headless Chrome indicators
     */
    function checkHeadlessChrome() {
        const indicators = [];

        // Check languages
        if (!navigator.languages || navigator.languages.length === 0) {
            indicators.push('noLanguages');
        }

        // Check for Chrome specific headless features
        if (/HeadlessChrome/.test(navigator.userAgent)) {
            indicators.push('headlessInUA');
        }

        // outerWidth/outerHeight being 0 is a classic headless indicator
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

    /**
     * Check client hints consistency
     * Compares userAgentData values against navigator.userAgent (not navigator.platform,
     * which can report Linux on Android browsers)
     */
    function checkInconsistentClientHints() {
        if (!navigator.userAgentData) {
            return false; // Not supported, can't check
        }

        const hints = navigator.userAgentData;
        const ua = navigator.userAgent;
        const inconsistencies = [];

        // Check brand consistency
        if (hints.brands) {
            const hasChromeBrand = hints.brands.some(b => b.brand.includes('Chrome') || b.brand.includes('Chromium'));
            const uaHasChrome = /Chrome/.test(ua) || /Chromium/.test(ua);

            if (hasChromeBrand !== uaHasChrome) {
                inconsistencies.push('brandMismatch');
            }
        }

        // Check platform consistency against userAgent (not navigator.platform)
        // navigator.platform on Android Chrome reports Linux-like values, not "Android"
        const platform = hints.platform;

        if (platform) {
            const platformMap = {
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

            // Special case: Android can show as Linux in some UAs, so both are acceptable
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
                hintPlatform: hints.platform,
                description: `Client hints inconsistent: ${inconsistencies.join(', ')} - possible UA spoofing`
            };
        }

        return false;
    }

    /**
     * Check WebGL for inconsistencies
     */
    function checkWebGLInconsistent() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

            // WebGL not supported is a weak signal (privacy browsers, remote desktops,
            // enterprise environments may disable it). Do not count as bot proof.
            if (!gl) return false;

            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo) return false; // Cannot determine

            const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
            const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

            // Check for headless/swiftshader indicators
            const suspiciousRenderers = [
                'SwiftShader', 'llvmpipe', 'software', 'Google SwiftShader'
            ];

            if (suspiciousRenderers.some(r => renderer && renderer.indexOf(r) !== -1)) {
                return {
                    vendor,
                    renderer,
                    reason: 'softwareRenderer',
                    description: `Software renderer detected: ${renderer}`
                };
            }

            // Check for null/undefined values
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
            return { reason: 'exception', message: e.message, description: `WebGL error: ${e.message}` };
        }
    }

    /**
     * Check for inconsistent GPU features
     */
    function checkInconsistentGPUFeatures() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl');

            // WebGL not available is a weak signal (privacy browsers, remote desktops,
            // enterprise environments may disable it). Do not count as bot proof.
            if (!gl) return false;

            const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);

            // Extremely low limits indicate software rendering (2048 is common for integrated GPUs)
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
            return { reason: 'exception', message: e.message, description: 'Error accessing WebGL' };
        }
    }

    /**
     * Check CDP via Error.prepareStackTrace (source inspection only).
     * Note: the "wasAccessed" side-effect trap only works reliably in a Web Worker
     * (where console.log doesn't read .stack under normal conditions, but CDP does).
     * In the main thread, accessing .stack always triggers the handler, so we only
     * inspect whether an existing non-native handler is automation-sourced.
     */
    function checkCDPViaStackTrace() {
        try {
            const handler = Error.prepareStackTrace;
            if (typeof handler === 'undefined') return false;

            const handlerString = handler.toString();
            if (handlerString.includes('[native code]')) return false;

            const handlerLower = handlerString.toLowerCase();
            let likelySource = 'unknown-script';

            if (handlerLower.includes('devtools') || handlerLower.includes('chrome-extension') || handlerLower.includes('inspector')) {
                likelySource = 'browser-devtools';
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
        } catch (e) {
            return false;
        }
    }

    /**
     * Check audio fingerprint for headless indicators
     */
    function checkAudioFingerprint() {
        return new Promise((resolve) => {
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                const OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;

                if (!AudioContext || !OfflineAudioContext) {
                    // Audio not available is a weak signal (privacy browsers, remote desktops,
                    // enterprise environments may disable it). Do not count as bot proof.
                    resolve(false);
                    return;
                }

                // Try to create offline context for fingerprinting
                const ctx = new OfflineAudioContext(1, 44100, 44100);
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
                    if (!settled) { settled = true; resolve({ reason: 'timeout', description: 'Audio fingerprint timed out' }); }
                }, 2000);

                ctx.oncomplete = function(e) {
                    clearTimeout(timer);
                    if (settled) return;
                    settled = true;
                    try {
                        const buffer = e.renderedBuffer.getChannelData(0);
                        // Sum samples from 4500-5000 range
                        let sum = 0;
                        for (let i = 4500; i < 5000; i++) {
                            sum += Math.abs(buffer[i]);
                        }

                        // Headless Chrome produces different sums than normal Chrome
                        // Normal Chrome typically produces non-zero values
                        if (sum === 0 || sum < 0.001) {
                            resolve({
                                sum: sum.toFixed(6),
                                reason: 'suspiciousSum',
                                description: `Audio fingerprint sum (${sum.toFixed(6)}) indicates headless/sandboxed environment`
                            });
                        } else {
                            resolve(false);
                        }
                    } catch (err) {
                        resolve({ reason: 'processingError', description: 'Error processing audio data' });
                    }
                };
            } catch (e) {
                resolve({ reason: 'exception', description: `Audio fingerprint error: ${e.message}` });
            }
        });
    }

    /**
     * Check canvas API availability (not a fingerprint consistency test)
     * Returns false if canvas API is unavailable or malformed
     */
    function checkCanvasAvailability() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 200;
            const ctx = canvas.getContext('2d');

            // If 2D context is unavailable, return a weak signal (privacy browsers, remote desktops,
            // enterprise environments may disable canvas). Not standalone bot proof.
            if (!ctx) {
                return { reason: 'no2DContext', weak: true, description: 'Canvas 2D context unavailable' };
            }

            // Draw standard fingerprint content
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

            // Check if we got valid pixel data
            const data = canvas.toDataURL();
            if (!data || data.length < 100) {
                // Empty or malformed canvas data is a weak signal (privacy browsers, remote
                // desktops, enterprise environments may disable it). Not standalone bot proof.
                return { reason: 'emptyOrMalformedCanvasData', weak: true, description: 'Canvas returned empty or malformed data URL' };
            }

            return false;
        } catch (e) {
            return { reason: 'exception', description: `Canvas error: ${e.message}` };
        }
    }

    /**
     * Check for CDP automation in main context
     */
    function checkAutomatedWithCDP() {
        const cdpMarkers = [
            '__cdp_eval', '__cdp_js_executor', '__selenium_eval',
            '__fxdriver_eval', '__webdriver_eval', 'cdc_adoQpoasnfa76pfcZLmcfl_',
            '$cdc_asdjflasutopfhvcZLmcfl_'
        ];

        for (const marker of cdpMarkers) {
            if (typeof window[marker] !== 'undefined') {
                return { marker, description: `CDP marker found: ${marker}` };
            }
        }

        return false;
    }

    /**
     * Check for iframe behavior is overridden
     */
    function checkIframeOverridden() {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        try {
            const contentWindow = iframe.contentWindow;

            // If contentWindow has been overridden, these checks might fail
            if (!('navigator' in contentWindow)) {
                return { reason: 'noNavigator', description: 'Iframe navigator missing - anti-detection script likely active' };
            }

            // Check if toString has been modified
            if (contentWindow.toString && contentWindow.toString.toString().indexOf('[native code]') === -1) {
                return { reason: 'toStringModified', description: 'Iframe toString modified - anti-detection evasion detected' };
            }

            return false;
        } catch (e) {
            return false;
        } finally {
            document.body.removeChild(iframe);
        }
    }

    /**
     * Check for CDP/automation leaks via blob URL iframe.
     * CDP automation often configures the main frame but leaves inconsistent
     * state inside blob URL iframes (webdriver, userAgent, languages, chrome object).
     */
    function checkBlobIframeCDP() {
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
                    try { URL.revokeObjectURL(url); } catch (_) {}
                    try { document.body.removeChild(iframe); } catch (_) {}
                }

                iframe.onload = function() {
                    try {
                        const win = iframe.contentWindow;
                        const issues = [];

                        // navigator.webdriver should be identical across contexts
                        const mainWebdriver = navigator.webdriver;
                        const frameWebdriver = win.navigator.webdriver;
                        if (mainWebdriver !== frameWebdriver) {
                            issues.push({
                                reason: 'webdriverMismatch',
                                description: `navigator.webdriver mismatch: main=${mainWebdriver}, iframe=${frameWebdriver}`
                            });
                        }

                        // CDP markers in iframe
                        const cdpMarkers = [
                            '__cdp_eval', '__cdp_js_executor', '__selenium_eval',
                            '__fxdriver_eval', '__webdriver_eval', 'cdc_adoQpoasnfa76pfcZLmcfl_'
                        ];
                        for (const marker of cdpMarkers) {
                            if (typeof win[marker] !== 'undefined') {
                                issues.push({
                                    reason: 'cdpMarkerInIframe',
                                    description: `CDP marker ${marker} found in blob iframe`
                                });
                            }
                        }

                        // User-Agent should match
                        if (navigator.userAgent !== win.navigator.userAgent) {
                            issues.push({
                                reason: 'userAgentMismatch',
                                description: 'User-Agent mismatch between main frame and blob iframe'
                            });
                        }

                        // Languages should match
                        const mainLangs = JSON.stringify(navigator.languages || []);
                        const frameLangs = JSON.stringify(win.navigator.languages || []);
                        if (mainLangs !== frameLangs) {
                            issues.push({
                                reason: 'languagesMismatch',
                                description: 'navigator.languages mismatch between main frame and blob iframe'
                            });
                        }

                        // window.chrome should be present in Chromium browsers
                        const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
                        if (isChrome && typeof win.chrome === 'undefined') {
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
                    } catch (e) {
                        cleanup();
                        resolve(false);
                    }
                };

                iframe.onerror = function() {
                    cleanup();
                    resolve(false);
                };

                // Timeout fallback
                setTimeout(() => {
                    cleanup();
                    resolve(false);
                }, 2000);

                document.body.appendChild(iframe);
            } catch (e) {
                resolve(false);
            }
        });
    }

    /**
     * Check hardware concurrency
     */
    function checkHighHardwareConcurrency() {
        const cores = navigator.hardwareConcurrency;

        if (!cores || cores === 0) {
            return false; // Not available
        }

        // High core counts might indicate cloud/VM environments
        if (cores > 16) {
            return {
                cores,
                threshold: 16,
                description: `${cores} CPU cores detected (high for consumer device) - possible VM/cloud environment`
            };
        }

        return false;
    }

    /**
     * Check for headless Chrome default screen resolution
     */
    function checkHeadlessResolution() {
        const width = window.screen.width;
        const height = window.screen.height;

        // Check for headless defaults
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

        // Also check for extremely unusual aspect ratios
        // Portrait mode (0.5-0.7) is common on mobile/rotated monitors
        // Ultrawide (2.0-3.5) is also increasingly common
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

    // Shared worker result promise — both checkInconsistentWorkerValues and
    // checkAutomatedWithCDPInWorker share a single worker run per page load.
    let _workerTestsPromise = null;

    /**
     * Reset the worker tests cache (useful after simulation mode changes)
     */
    function resetWorkerTestsCache() {
        _workerTestsPromise = null;
    }

    /**
     * Run Web Worker based tests (cached — runs at most once per page load)
     */
    function runWorkerTests() {
        if (_workerTestsPromise) return _workerTestsPromise;

        _workerTestsPromise = new Promise((resolve) => {
            try {
                const workerCode = `
                    self.onmessage = function(e) {
                        const results = {
                            userAgent: navigator.userAgent,
                            webdriver: navigator.webdriver,
                            platform: navigator.platform,
                            hardwareConcurrency: navigator.hardwareConcurrency,
                            languages: navigator.languages,
                            hasCDP: false,
                            webGLVendor: 'NA',
                            webGLRenderer: 'NA'
                        };

                        // Check for CDP in worker
                        const cdpMarkers = ['__cdp_eval', '__cdp_js_executor', '__selenium_eval'];
                        for (const marker of cdpMarkers) {
                            if (typeof self[marker] !== 'undefined') {
                                results.hasCDP = true;
                                break;
                            }
                        }

                        // CDP detection via Error.prepareStackTrace side-effect trap.
                        // In a worker, console.log(err) does NOT read .stack normally,
                        // but CDP intercepts it and does — so wasAccessed == true means CDP is attached.
                        try {
                            let wasAccessed = false;
                            const origPST = Error.prepareStackTrace;
                            Error.prepareStackTrace = function() {
                                wasAccessed = true;
                                return typeof origPST === 'function' ? origPST.apply(this, arguments) : undefined;
                            };
                            const probe = new Error('');
                            console.log(probe);
                            Error.prepareStackTrace = origPST;
                            results.hasCDPWorker = wasAccessed;
                        } catch(_) {}

                        // WebGL in worker via OffscreenCanvas
                        try {
                            const canvas = new OffscreenCanvas(1, 1);
                            const gl = canvas.getContext('webgl');
                            if (gl) {
                                const ext = gl.getExtension('WEBGL_debug_renderer_info');
                                if (ext) {
                                    results.webGLVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
                                    results.webGLRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
                                }
                            }
                        } catch (_) {}

                        self.postMessage(results);
                    };
                `;

                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                const worker = new Worker(blobUrl);
                URL.revokeObjectURL(blobUrl);

                // Timeout fallback
                let timeoutId = setTimeout(() => {
                    worker.terminate();
                    resolve({ timeout: true });
                }, 2000);

                worker.onmessage = function(e) {
                    clearTimeout(timeoutId);
                    worker.terminate();
                    resolve(e.data);
                };

                worker.onerror = function(e) {
                    clearTimeout(timeoutId);
                    worker.terminate();
                    resolve({ error: e.message });
                };

                worker.postMessage('start');
            } catch (e) {
                resolve({ error: e.message, notSupported: true });
            }
        });

        return _workerTestsPromise;
    }

    /**
     * Compare main context vs worker context values
     */
    async function checkInconsistentWorkerValues() {
        const workerData = await runWorkerTests();

        if (workerData.error) {
            return { reason: 'workerError', inconclusive: true, severity: 'weak', message: workerData.error, description: 'Web Worker failed to execute — inconclusive, may be browser restrictions' };
        }

        if (workerData.notSupported) {
            return false; // Cannot determine - workers not supported
        }

        if (workerData.timeout) {
            return { reason: 'workerTimeout', inconclusive: true, severity: 'weak', description: 'Web Worker timed out — inconclusive, may be browser restrictions or slow device' };
        }

        const inconsistencies = [];
        const details = {};

        // Compare userAgent
        if (workerData.userAgent !== navigator.userAgent) {
            inconsistencies.push('userAgent');
            details.userAgent = { main: navigator.userAgent.slice(0, 50) + '...', worker: workerData.userAgent.slice(0, 50) + '...' };
        }

        // Compare webdriver (treat undefined, false, null as equivalent "not detected")
        const mainWebdriver = navigator.webdriver === true;
        const workerWebdriver = workerData.webdriver === true;
        if (mainWebdriver !== workerWebdriver) {
            inconsistencies.push('webdriver');
            details.webdriver = { main: navigator.webdriver, worker: workerData.webdriver };
        }

        // Compare platform
        if (workerData.platform !== navigator.platform) {
            inconsistencies.push('platform');
            details.platform = { main: navigator.platform, worker: workerData.platform };
        }

        // Compare hardware concurrency
        if (workerData.hardwareConcurrency !== navigator.hardwareConcurrency) {
            inconsistencies.push('hardwareConcurrency');
            details.hardwareConcurrency = { main: navigator.hardwareConcurrency, worker: workerData.hardwareConcurrency };
        }

        // Compare WebGL renderer (if worker has it)
        if (workerData.webGLVendor && workerData.webGLVendor !== 'NA') {
            try {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl');
                const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
                if (ext) {
                    const mainVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
                    const mainRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
                    if (mainVendor !== workerData.webGLVendor || mainRenderer !== workerData.webGLRenderer) {
                        inconsistencies.push('webGL');
                        details.webGL = { main: `${mainVendor}/${mainRenderer}`, worker: `${workerData.webGLVendor}/${workerData.webGLRenderer}` };
                    }
                }
            } catch (_) {}
        }

        if (inconsistencies.length > 0) {
            return {
                inconsistencies,
                details,
                description: `Worker context differs in: ${inconsistencies.join(', ')} - indicates environment spoofing`
            };
        }

        return false;
    }

    /**
     * Check CDP in Web Worker — combines marker check and prepareStackTrace trap
     * Returns structured evidence with severity based on detection source.
     */
    async function checkAutomatedWithCDPInWorker() {
        const workerData = await runWorkerTests();

        if (workerData.error || workerData.timeout || workerData.notSupported) {
            return false; // Cannot determine
        }

        if (workerData.hasCDP === true || workerData.hasCDPWorker === true) {
            // hasCDP = explicit marker found (stronger evidence)
            // hasCDPWorker = prepareStackTrace side effect (medium confidence, can be devtools)
            const reason = workerData.hasCDP ? 'workerCDPMarker' : 'workerStackTraceSideEffect';
            const severity = workerData.hasCDP ? 'strong' : 'medium';
            const description = workerData.hasCDP
                ? 'CDP marker found in worker context'
                : 'Worker Error.prepareStackTrace side effect suggests CDP inspection';
            return { reason, severity, description };
        }

        return false;
    }

    /**
     * Analyze weak signals collectively
     */
    function analyzeWeakSignals() {
        const signals = [];

        // Check for missing properties that real browsers have
        if (typeof window.devicePixelRatio === 'undefined') {
            signals.push('noDevicePixelRatio');
        }

        // Check for suspicious navigator properties
        // navigator.vendor === '' is normal for Firefox, so only flag if Chrome UA is present
        if (navigator.vendor === '' && /Chrome/.test(navigator.userAgent)) {
            signals.push('noVendor');
        }

        // Check for common evasion attempts
        if (navigator.webdriver === false && /Chrome/.test(navigator.userAgent)) {
            // Setting webdriver to false when it should be undefined is suspicious
            const descriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
            if (descriptor && !descriptor.get && descriptor.value === false) {
                signals.push('fakeWebdriverFalse');
            }
        }

        // Check for overwritten native functions
        const nativeToString = Function.prototype.toString.call(Function.prototype.toString);
        if (nativeToString.indexOf('[native code]') === -1) {
            signals.push('toStringTampered');
        }

        if (signals.length >= 2) {
            const descriptions = {
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

    /**
     * Create a result item element.
     * Supports tri-state: passed (NO), failed (YES with severity label), inconclusive (INCONCLUSIVE).
     * Displays severity (WEAK/MEDIUM/STRONG) instead of plain YES when available.
     */
    function createResultElement(label, value, isBoolean = true, details = null, showLikelySource = false) {
        const div = document.createElement('div');
        div.className = 'result-item';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'label';
        labelSpan.textContent = label;

        // Determine status from raw value and details
        const isInconclusive = !isBoolean && details && typeof details === 'object' && details.inconclusive === true;

        // Special case: stack trace source — only fail when automation source is confirmed
        const isStackTraceDevTools = showLikelySource && details && details.likelySource === 'devtools';

        const isFailed = isStackTraceDevTools
            ? false
            : (!isInconclusive && (isBoolean ? value === true : (value !== false && value !== null && value !== undefined)));

        // Determine display label based on severity info in details
        let displayLabel, displayClass;
        if (isInconclusive) {
            displayLabel = 'INCONCLUSIVE';
            displayClass = 'inconclusive';
        } else if (isFailed) {
            const sev = details && typeof details === 'object' && details.severity
                ? details.severity.toLowerCase()
                : (details && typeof details === 'object' && details.weak ? 'weak' : 'strong');
            displayLabel = sev.toUpperCase();
            displayClass = sev;
        } else {
            displayLabel = 'NO';
            displayClass = 'false';
        }

        const valueSpan = document.createElement('span');
        valueSpan.className = 'value ' + displayClass;
        valueSpan.textContent = displayLabel;

        div.appendChild(labelSpan);
        div.appendChild(valueSpan);

        // Add details tooltip for failed or inconclusive tests
        if ((isFailed || isInconclusive) && details) {
            const detailsSpan = document.createElement('span');
            detailsSpan.className = 'result-details';

            let detailsText = '';

            // Special handling for isAutomatedViaStackTrace - show likelySource prominently
            if (showLikelySource && details.likelySource) {
                detailsText = `[${details.likelySource.toUpperCase()}] `;
            }

            if (typeof details === 'object') {
                if (details.description) {
                    detailsText += details.description;
                } else if (details.reason) {
                    detailsText += `Reason: ${details.reason}`;
                    if (details.message) detailsText += ` (${details.message})`;
                } else {
                    detailsText += JSON.stringify(details).slice(0, 100);
                }
            } else {
                detailsText += String(details);
            }

            detailsSpan.textContent = detailsText;
            detailsSpan.title = detailsText;
            div.appendChild(detailsSpan);
            div.classList.add('has-details');
        }

        return div;
    }

    /**
     * Check if browser chrome UI is missing (outer < inner is impossible in real browsers)
     * Real browsers always have UI chrome making outer >= inner; headless browsers can have outer < inner.
     */
    function checkMissingBrowserChrome() {
        if (window.outerWidth === 0 || window.outerHeight === 0) {
            return {
                reason: 'zeroOuter',
                outerWidth: window.outerWidth,
                outerHeight: window.outerHeight,
                description: `outerWidth/Height is 0 — classic headless browser indicator`
            };
        }

        // In fullscreen mode outerWidth === innerWidth is expected, so skip the check
        if (document.fullscreenElement) return false;

        // outer < inner is physically impossible in a real browser (would mean content is larger than the window).
        // outer === inner is common in maximized windows and tiling WMs (especially on Linux),
        // so we only flag when outer is strictly smaller than inner.
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

    /**
     * Check screen availability — real Windows desktops always reserve space for the taskbar.
     * Linux/Wayland can legitimately report avail === screen even with a taskbar, so this
     * check is Windows-only and treated as a weak corroborating signal.
     */
    function checkScreenAvailability() {
        // Only meaningful on Windows — Linux (Wayland especially) and macOS can report
        // avail === screen in fully-legitimate configurations
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

    /**
     * Check for touch support inconsistencies (e.g. mobile UA without touch events)
     */
    function checkTouchInconsistency() {
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

        // coarse pointer (touch screen) declared but navigator says no touch points
        if (hasCoarsePointer && maxTouchPoints === 0) {
            return {
                reason: 'coarsePointerNoTouchPoints',
                description: 'Media query reports coarse pointer but maxTouchPoints is 0 — inconsistent'
            };
        }

        return false;
    }

    /**
     * Check Navigator prototype chain integrity.
     * Anti-detection scripts often patch navigator directly rather than its prototype,
     * leaving detectable property descriptor signatures.
     */
    function checkNavigatorIntegrity() {
        const suspicious = [];

        function isNative(fn) {
            if (typeof fn !== 'function') return false;
            try {
                return Function.prototype.toString.call(fn).indexOf('[native code]') !== -1;
            } catch (_) {
                return false;
            }
        }

        // navigator.webdriver should be an accessor on the prototype, not an own value property
        const wdOwn = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
        const wdProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
        if (wdOwn) {
            // If it's an own value property set to false, it was explicitly patched
            if (!wdOwn.get && wdOwn.value === false) {
                suspicious.push('webdriverForcedFalse');
            }
            // If configurable is false but the value is overridden, that's a red flag
            if (wdOwn.get && !isNative(wdOwn.get)) {
                suspicious.push('webdriverGetterPatched');
            }
        }
        if (wdProto && wdProto.get && !isNative(wdProto.get)) {
            suspicious.push('webdriverProtoGetterPatched');
        }

        // Check if userAgent own property was set directly on navigator (evasion technique)
        const uaOwn = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
        const uaProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
        if (uaOwn && uaOwn.get && !isNative(uaOwn.get)) {
            suspicious.push('userAgentGetterPatched');
        }
        if (uaProto && uaProto.get && !isNative(uaProto.get)) {
            suspicious.push('userAgentProtoGetterPatched');
        }

        // languages getter tampering
        const langProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
        if (langProto && langProto.get && !isNative(langProto.get)) {
            suspicious.push('languagesProtoGetterPatched');
        }

        // plugins getter tampering
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

    /**
     * Normalize notification permission values for comparison.
     * 'default' and 'prompt' are semantically equivalent in modern APIs.
     */
    function normalizeNotificationPermission(value) {
        return value === 'default' ? 'prompt' : value;
    }

    function isChromiumLike() {
        return /Chrome|Chromium|Edg\//.test(navigator.userAgent);
    }

    function isReliablePermissionOrigin() {
        return window.location.protocol === 'https:' ||
               window.location.hostname === 'localhost' ||
               window.location.hostname === '127.0.0.1';
    }

    async function checkPermissionsConsistency() {
        if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
            // Permissions API missing — weak signal, some privacy browsers disable it
            return false;
        }

        const issues = [];
        const canCompareNotificationPermission = isChromiumLike() && isReliablePermissionOrigin();

        if (typeof Notification !== 'undefined' && canCompareNotificationPermission) {
            try {
                const permissionStatus = await navigator.permissions.query({ name: 'notifications' });
                const notificationPermission = normalizeNotificationPermission(Notification.permission);
                const permissionState = normalizeNotificationPermission(
                    permissionStatus && permissionStatus.state
                );

                if (notificationPermission !== permissionState) {
                    issues.push({
                        reason: 'notificationPermissionMismatch',
                        notificationPermission,
                        permissionState
                    });
                }
            } catch (e) {
                // Firefox/private settings/extensions may reject or restrict this.
                // Do not treat as bot evidence.
            }
        }

        // clipboard-read should exist in modern Chromium
        try {
            await navigator.permissions.query({ name: 'clipboard-read' });
        } catch (e) {
            // Some privacy modes or older browsers may not support — not conclusive
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

    /**
     * Check plugins and MIME types consistency.
     * Chrome desktop should have plugins. Zero plugins or descriptor tampering
     * can indicate headless/stealth environments.
     */
    function checkPluginsMimeTypes() {
        const isChromeDesktop = /Chrome/.test(navigator.userAgent) &&
                                /Google Inc/.test(navigator.vendor) &&
                                !/Mobile|Android|iPhone|iPad/.test(navigator.userAgent);

        const plugins = navigator.plugins;
        const mimeTypes = navigator.mimeTypes;

        if (!plugins || !mimeTypes) {
            return false; // Not supported or restricted
        }

        // Check for zero plugins on desktop Chrome — rare but possible in incognito
        if (isChromeDesktop && plugins.length === 0) {
            return {
                reason: 'zeroPluginsChromeDesktop',
                weak: true,
                description: 'Desktop Chrome reports zero plugins — possible incognito/headless/privacy mode'
            };
        }

        // Check for descriptor tampering on plugins
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
        } catch (_) {}

        // Check for plugins without mimeTypes (inconsistent)
        if (plugins.length > 0 && mimeTypes.length === 0) {
            return {
                reason: 'pluginsWithoutMimeTypes',
                weak: true,
                description: 'navigator.plugins exists but navigator.mimeTypes is empty'
            };
        }

        // Check prototype tags — poor stealth patches often get these wrong
        try {
            const pluginTag = Object.prototype.toString.call(plugins);
            const mimeTag = Object.prototype.toString.call(mimeTypes);
            const issues = [];

            if (pluginTag !== '[object PluginArray]') {
                issues.push('invalidPluginArrayTag');
            }
            if (mimeTag !== '[object MimeTypeArray]') {
                issues.push('invalidMimeTypeArrayTag');
            }
            if (issues.length > 0) {
                return {
                    reason: issues[0],
                    issues,
                    weak: true,
                    description: `Prototype tag mismatch: ${issues.join(', ')}`
                };
            }
        } catch (_) {}

        return false;
    }

    /**
     * Check locale, timezone, and Intl coherence.
     * Detects mismatches between navigator.language, navigator.languages,
     * timezone, and Intl formatting locale.
     */
    function checkLocaleTimezoneIntl() {
        const issues = [];

        try {
            const dtf = Intl.DateTimeFormat().resolvedOptions();
            const nf = Intl.NumberFormat().resolvedOptions();
            const coll = Intl.Collator().resolvedOptions();
            const tz = dtf.timeZone;
            const locale = dtf.locale;

            // navigator.language should roughly match Intl locale prefix
            const navLang = (navigator.language || '').toLowerCase();
            if (locale && !locale.toLowerCase().startsWith(navLang.split('-')[0])) {
                issues.push('intlLocaleMismatch');
            }

            // Check for obvious UTC/GMT timezone with non-English primary language
            const isEn = navLang.startsWith('en');
            if (!isEn && (tz === 'UTC' || tz === 'GMT' || tz === 'Etc/UTC')) {
                issues.push('nonEnglishBrowserInUTC');
            }

            // navigator.languages should contain navigator.language
            const langs = navigator.languages || [];
            if (langs.length > 0 && !langs.some(l => l.toLowerCase().startsWith(navLang.split('-')[0]))) {
                issues.push('languagesListMismatch');
            }

            // Different Intl constructors should agree on locale
            const nfLocale = nf.locale || '';
            const collLocale = coll.locale || '';
            if (locale && nfLocale && locale !== nfLocale) {
                issues.push('intlLocaleInconsistent');
            }
            if (locale && collLocale && locale !== collLocale) {
                issues.push('intlCollatorLocaleInconsistent');
            }
        } catch (_) {
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

    /**
     * Check viewport, screen, DPR, and orientation coherence.
     * Detects impossible or unlikely combinations indicating emulation.
     */
    function checkViewportScreenCoherence() {
        const issues = [];
        const ua = navigator.userAgent || '';
        const isMobileUA = /Mobile|Android|iPhone|iPad/.test(ua);

        const dpr = window.devicePixelRatio || 1;
        const sw = window.screen.width || 0;
        const sh = window.screen.height || 0;
        const iw = window.innerWidth || 0;
        const ih = window.innerHeight || 0;

        // Mobile UA but DPR == 1 on "retina"-like screen sizes — weak signal
        if (isMobileUA && dpr === 1 && sw >= 375) {
            issues.push('mobileUANoRetinaDpr');
        }

        // inner much larger than outer (non-fullscreen) is impossible in real browsers
        if (!document.fullscreenElement && (window.outerWidth > 0 && iw > window.outerWidth * 1.5)) {
            issues.push('innerMuchLargerThanOuter');
        }

        // Orientation mismatch (only if orientation API exists)
        if (screen.orientation && screen.orientation.type) {
            const isPortrait = screen.orientation.type.startsWith('portrait');
            if (isPortrait && sw > sh) {
                issues.push('portraitOrientationLandscapeDimensions');
            }
            if (!isPortrait && sh > sw) {
                issues.push('landscapeOrientationPortraitDimensions');
            }
        }

        // Check visualViewport if available
        if (window.visualViewport) {
            const vv = window.visualViewport;

            // Scale should be in reasonable bounds
            if (vv.scale <= 0 || vv.scale > 10) {
                issues.push('invalidVisualViewportScale');
            }

            // At scale 1, visualViewport.width should roughly match innerWidth
            if (vv.scale === 1 && Math.abs(vv.width - iw) > 2) {
                issues.push('visualViewportWidthMismatch');
            }

            // Similar check for height
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

    /**
     * Extended automation-specific globals check.
     * Goes beyond the basic Playwright/Phantom/Nightmare/Selenium checks.
     */
    function checkAutomationGlobalsExtended() {
        const markers = [
            'domAutomation', 'domAutomationController',
            '__webdriver_script_fn', '__driver_evaluate',
            '__webdriver_evaluate', '__selenium_unwrapped',
            '__fxdriver_unwrapped', '_Selenium_IDE_Recorder',
            'cdc_adoQpoasnfa76pfcZLmcfl_',
            '$cdc_asdjflasutopfhvcZLmcfl_'
        ];

        const found = [];
        for (const marker of markers) {
            if (typeof window[marker] !== 'undefined' || typeof document[marker] !== 'undefined') {
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
     * Show loading state
     */
    function showLoading(container) {
        container.innerHTML = '<div class="loading"><span class="spinner"></span>Running detection tests...</div>';
    }

    /**
     * Summarize detection results into a unified scoring model.
     * Returns { tests, summary, uiStatus } where:
     *   - tests: per-test objects for JSON output
     *   - summary: counts, hard failures, weak findings, indicatorCount, botDetected flag
     *   - uiStatus: { statusClass, statusText } for UI badges
     *
     * Scoring model: strong findings have weight 2, medium 1, weak 0.5.
     * botDetected threshold is score >= 2 (equivalent to one strong finding).
     */
    function summarizeResults(results) {
        const tests = {};
        let totalTests = 0, passed = 0, hardFailures = 0, weakFindings = 0, inconclusiveCount = 0;
        let score = 0;
        const indicatorDetails = [];

        const countIndicator = (name, value, weight) => {
            score += weight;
            const description = value && typeof value === 'object' && value.description
                ? value.description
                : (value === true ? 'Detected' : String(value));
            indicatorDetails.push({ test: name, description, severity: weight === 2 ? 'strong' : weight === 1 ? 'medium' : 'weak' });
        };

        // Boolean tests — value is exactly true when detected
        // All boolean tests are STRONG indicators (direct automation evidence)
        const booleanTests = [
            'hasWebdriverTrue', 'hasWebdriverInFrameTrue',
            'isPlaywright', 'isPhantom',
            'isNightmare', 'isSequentum', 'isSeleniumChromeDefault'
        ];
        for (const name of booleanTests) {
            if (!(name in results)) continue;
            const value = results[name];
            const isFailed = value === true;
            tests[name] = {
                status: isFailed ? 'failed' : 'passed',
                passed: !isFailed,
                severity: 'strong',
                value: value,
                description: isFailed && value && value.description ? value.description : null
            };
            totalTests++;
            if (isFailed) {
                hardFailures++;
                countIndicator(name, value, 2);
            } else {
                passed++;
            }
        }

        // Object/truthy tests — truthy non-null value means detected
        // Classified by severity: strong, medium, weak
        const objectTestsStrong = [
            'hasBotUserAgent', 'isAutomatedWithCDP',
            'isHeadlessChrome', 'isIframeOverridden', 'hasBlobIframeCDPIssue',
            'hasMissingBrowserChrome', 'hasAutomationGlobalsExtended'
        ];
        const objectTestsMedium = [
            'hasInconsistentChromeObject',
            'hasWebGLInconsistent',
            'hasInconsistentGPUFeatures',
            'hasHeadlessChromeDefaultScreenResolution',
            'hasCDPMouseLeak',
            'hasNavigatorIntegrityViolation',
            'hasInconsistentClientHints',
            'isAutomatedWithCDPInWebWorker'
        ];
        const objectTestsWeak = [
            'hasSuspiciousWeakSignals',
            'hasCanvasAvailabilityIssue',
            'hasAudioFingerprintIssue',
            'hasScreenAvailabilityAnomaly',
            'hasTouchInconsistency',
            'hasPermissionsInconsistency',
            'hasPluginsMimeTypesIssue',
            'hasLocaleTimezoneIntlIssue',
            'hasViewportScreenCoherenceIssue',
            'hasInconsistentWorkerValues', // Inconclusive cases are weak
            'suspiciousClientSideBehavior',
            'superHumanSpeed',
            'hasAdvancedBotSignals'
        ];
        const allObjectTests = [...objectTestsStrong, ...objectTestsMedium, ...objectTestsWeak];

        for (const name of allObjectTests) {
            if (!(name in results)) continue;
            const value = results[name];

            // Check for inconclusive results first
            const isInconclusive = value && typeof value === 'object' && value.inconclusive === true;
            const isFailed = !isInconclusive && value !== false && value !== null && value !== undefined;

            // Determine severity from result object or fallback to list-based
            let severity = 'medium';
            let weight = 1;
            let hasExplicitSeverity = false;

            // Result object can override severity
            if (value && typeof value === 'object') {
                if (value.severity === 'strong') { severity = 'strong'; weight = 2; hasExplicitSeverity = true; }
                else if (value.severity === 'medium') { severity = 'medium'; weight = 1; hasExplicitSeverity = true; }
                else if (value.severity === 'weak') { severity = 'weak'; weight = 0.5; hasExplicitSeverity = true; }
                else if (value.weak === true) { severity = 'weak'; weight = 0.5; hasExplicitSeverity = true; }
            }

            // Fallback to list-based if not specified in result
            if (!hasExplicitSeverity) {
                if (objectTestsStrong.includes(name)) { severity = 'strong'; weight = 2; }
                else if (objectTestsWeak.includes(name)) { severity = 'weak'; weight = 0.5; }
            }

            // Special handling: worker values inconclusive (timeout/error) shouldn't be strong
            if (name === 'hasInconsistentWorkerValues' && value && (value.inconclusive || value.reason === 'workerTimeout' || value.reason === 'workerError')) {
                severity = 'weak';
                weight = 0.5;
            }

            // Weak findings only count as indicators if there's already strong/medium evidence
            const countsAsIndicator = isFailed && (weight >= 1 || score > 0);

            tests[name] = {
                status: isInconclusive ? 'inconclusive' : isFailed ? 'failed' : 'passed',
                passed: !isFailed && !isInconclusive,
                inconclusive: isInconclusive,
                severity,
                countsAsIndicator,
                value: value,
                description: (isFailed || isInconclusive) && value && value.description ? value.description : null
            };
            totalTests++;
            if (isInconclusive) {
                inconclusiveCount++;
            } else if (isFailed) {
                if (weight >= 1) hardFailures++;
                else weakFindings++;
                if (countsAsIndicator) countIndicator(name, value, weight);
            } else {
                passed++;
            }
        }

        // isAutomatedViaStackTrace: only count clear automation, not devtools
        const stackTraceResult = results.isAutomatedViaStackTrace;
        const isStackTraceAutomation = stackTraceResult && stackTraceResult.likelySource === 'automation';
        tests['isAutomatedViaStackTrace'] = {
            status: isStackTraceAutomation ? 'failed' : 'passed',
            passed: !isStackTraceAutomation,
            severity: 'strong',
            value: stackTraceResult,
            description: stackTraceResult && stackTraceResult.description ? stackTraceResult.description : null
        };
        totalTests++;
        if (isStackTraceAutomation) {
            hardFailures++;
            countIndicator('isAutomatedViaStackTrace', stackTraceResult, 2);
        } else {
            passed++;
        }

        // hasHighHardwareConcurrency is a weak signal — only count when other indicators exist
        const hwResult = results.hasHighHardwareConcurrency;
        const isHwBot = hwResult && score > 0;
        tests['hasHighHardwareConcurrency'] = {
            status: hwResult ? 'failed' : 'passed',
            passed: !hwResult,
            severity: 'weak',
            countsAsIndicator: isHwBot,
            value: hwResult,
            description: hwResult && hwResult.description ? hwResult.description : null
        };
        totalTests++;
        if (isHwBot) {
            weakFindings++;
            countIndicator('hasHighHardwareConcurrency', hwResult, 0.5);
        } else if (hwResult) {
            // Present but no other indicators - still a finding but weak
            weakFindings++;
        } else {
            passed++;
        }

        const indicatorCount = indicatorDetails.length;
        const summary = {
            totalTests,
            passed,
            failed: hardFailures + weakFindings,
            hardFailures,
            weakFindings,
            inconclusive: inconclusiveCount,
            inconclusiveCount,
            indicatorCount,
            indicatorDetails,
            score: Math.round(score * 10) / 10, // Round to 1 decimal
            suspicious: score >= 0.5 && score < 2,
            botDetected: score >= 2
        };

        let statusClass, statusText;
        if (score >= 2) {
            statusClass = 'bot';
            statusText = `BOT DETECTED (score: ${summary.score})`;
        } else if (score >= 0.5) {
            statusClass = 'pending';
            statusText = `SUSPICIOUS (score: ${summary.score})`;
        } else {
            statusClass = 'human';
            statusText = 'HUMAN';
        }

        return { tests, summary, uiStatus: { statusClass, statusText } };
    }

    // Expose shared utilities
    window.BotDetectorShared = {
        checkBotUserAgent,
        checkWebdriver,
        checkWebdriverInFrame,
        checkPlaywright,
        checkInconsistentChrome,
        checkPhantomJS,
        checkNightmare,
        checkSequentum,
        checkSeleniumChromeDefault,
        checkHeadlessChrome,
        checkWebGLInconsistent,
        checkAutomatedWithCDP,
        checkCDPViaStackTrace,
        checkAudioFingerprint,
        checkCanvasAvailability,
        checkInconsistentClientHints,
        checkInconsistentGPUFeatures,
        checkIframeOverridden,
        checkBlobIframeCDP,
        checkHighHardwareConcurrency,
        checkHeadlessResolution,
        checkInconsistentWorkerValues,
        checkAutomatedWithCDPInWorker,
        analyzeWeakSignals,
        checkMissingBrowserChrome,
        checkScreenAvailability,
        checkTouchInconsistency,
        checkNavigatorIntegrity,
        checkPermissionsConsistency,
        checkPluginsMimeTypes,
        checkLocaleTimezoneIntl,
        checkViewportScreenCoherence,
        checkAutomationGlobalsExtended,
        createResultElement,
        showLoading,
        runWorkerTests,
        resetWorkerTestsCache,
        summarizeResults
    };

})();
