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

        return typeof window.chrome === 'undefined';
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
                // Empty canvas is a weak signal (privacy browsers, remote desktops,
                // enterprise environments may disable it). Do not count as bot proof.
                return false;
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
            return { reason: 'workerError', message: workerData.error, description: 'Web Worker failed to execute' };
        }

        if (workerData.notSupported) {
            return false; // Cannot determine - workers not supported
        }

        if (workerData.timeout) {
            return { reason: 'workerTimeout', description: 'Web Worker timed out - possible automation blocking' };
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
     */
    async function checkAutomatedWithCDPInWorker() {
        const workerData = await runWorkerTests();
        return workerData.hasCDP === true || workerData.hasCDPWorker === true;
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
     * Create a result item element
     */
    function createResultElement(label, value, isBoolean = true, details = null, showLikelySource = false) {
        const div = document.createElement('div');
        div.className = 'result-item';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'label';
        labelSpan.textContent = label;

        const valueSpan = document.createElement('span');
        const isFailed = isBoolean ? value : (value !== false && value !== null && value !== undefined);
        valueSpan.className = 'value ' + (isFailed ? 'true' : 'false');
        valueSpan.textContent = isFailed ? 'YES' : 'NO';

        div.appendChild(labelSpan);
        div.appendChild(valueSpan);

        // Add details tooltip for failed tests
        if (isFailed && details) {
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

        // navigator.webdriver should be an accessor on the prototype, not an own value property
        const wdDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
        if (wdDescriptor) {
            // If it's an own value property set to false, it was explicitly patched
            if (!wdDescriptor.get && wdDescriptor.value === false) {
                suspicious.push('webdriverForcedFalse');
            }
            // If configurable is false but the value is overridden, that's a red flag
            if (wdDescriptor.get && wdDescriptor.get.toString().indexOf('[native code]') === -1) {
                suspicious.push('webdriverGetterPatched');
            }
        }

        // Check if userAgent own property was set directly on navigator (evasion technique)
        const uaDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
        if (uaDescriptor && uaDescriptor.get && uaDescriptor.get.toString().indexOf('[native code]') === -1) {
            suspicious.push('userAgentGetterPatched');
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
     * Show loading state
     */
    function showLoading(container) {
        container.innerHTML = '<div class="loading"><span class="spinner"></span>Running detection tests...</div>';
    }

    /**
     * Summarize detection results into a unified scoring model.
     * Returns { tests, summary, uiStatus } where:
     *   - tests: per-test objects for JSON output
     *   - summary: counts and botDetected flag
     *   - uiStatus: { statusClass, statusText } for UI badges
     */
    function summarizeResults(results) {
        const tests = {};
        let totalTests = 0, passed = 0, failed = 0;
        let indicatorCount = 0;
        const indicatorDetails = [];

        const countIndicator = (name, value) => {
            indicatorCount++;
            const description = value && typeof value === 'object' && value.description
                ? value.description
                : (value === true ? 'Detected' : String(value));
            indicatorDetails.push({ test: name, description });
        };

        // Boolean tests — value is exactly true when detected
        const booleanTests = [
            'hasWebdriverTrue', 'hasWebdriverInFrameTrue',
            'isPlaywright', 'hasInconsistentChromeObject', 'isPhantom',
            'isNightmare', 'isSequentum', 'isSeleniumChromeDefault',
            'isAutomatedWithCDPInWebWorker'
        ];
        for (const name of booleanTests) {
            if (!(name in results)) continue;
            const value = results[name];
            const isFailed = value === true;
            tests[name] = {
                passed: !isFailed,
                value: value,
                description: isFailed && value && value.description ? value.description : null
            };
            totalTests++;
            if (isFailed) { failed++; countIndicator(name, value); }
            else { passed++; }
        }

        // Object/truthy tests — truthy non-null value means detected
        // Weak tests only count as indicators when another indicator already exists
        const objectTests = [
            'hasBotUserAgent', 'isAutomatedWithCDP',
            'isHeadlessChrome', 'isWebGLInconsistent', 'hasInconsistentWorkerValues',
            'hasInconsistentGPUFeatures', 'hasInconsistentClientHints',
            'isIframeOverridden', 'hasBlobIframeCDPIssue', 'hasHeadlessChromeDefaultScreenResolution',
            'hasSuspiciousWeakSignals', 'hasCanvasAvailabilityIssue',
            'hasAudioFingerprintIssue', 'hasMissingBrowserChrome',
            'hasScreenAvailabilityAnomaly', 'hasTouchInconsistency',
            'hasNavigatorIntegrityViolation',
            'suspiciousClientSideBehavior', 'superHumanSpeed', 'hasCDPMouseLeak', 'hasAdvancedBotSignals'
        ];
        const weakTests = [
            'hasSuspiciousWeakSignals',
            'hasCanvasAvailabilityIssue',
            'hasAudioFingerprintIssue',
            'hasScreenAvailabilityAnomaly',
            'hasTouchInconsistency',
            'suspiciousClientSideBehavior',
            'superHumanSpeed',
            'hasAdvancedBotSignals'
        ];
        for (const name of objectTests) {
            if (!(name in results)) continue;
            const value = results[name];
            const isFailed = value !== false && value !== null && value !== undefined;
            const isWeak = weakTests.includes(name);
            const countsAsIndicator = isFailed && (!isWeak || indicatorCount > 0);

            tests[name] = {
                passed: !isFailed,
                value: value,
                description: isFailed && value && value.description ? value.description : null
            };
            totalTests++;
            if (isFailed) {
                failed++;
                if (countsAsIndicator) countIndicator(name, value);
            } else {
                passed++;
            }
        }

        // isAutomatedViaStackTrace: only count clear automation, not devtools
        const stackTraceResult = results.isAutomatedViaStackTrace;
        const isStackTraceAutomation = stackTraceResult && stackTraceResult.likelySource === 'automation';
        tests['isAutomatedViaStackTrace'] = {
            passed: !isStackTraceAutomation,
            value: stackTraceResult,
            description: stackTraceResult && stackTraceResult.description ? stackTraceResult.description : null
        };
        totalTests++;
        if (isStackTraceAutomation) {
            failed++;
            countIndicator('isAutomatedViaStackTrace', stackTraceResult);
        } else {
            passed++;
        }

        // hasHighHardwareConcurrency is a weak signal — only count when other indicators exist
        const hwResult = results.hasHighHardwareConcurrency;
        const isHwBot = hwResult && indicatorCount > 0;
        tests['hasHighHardwareConcurrency'] = {
            passed: !isHwBot,
            value: hwResult,
            description: hwResult && hwResult.description ? hwResult.description : null
        };
        totalTests++;
        if (isHwBot) {
            failed++;
            countIndicator('hasHighHardwareConcurrency', hwResult);
        } else {
            passed++;
        }

        const summary = {
            totalTests,
            passed,
            failed,
            indicatorCount,
            indicatorDetails,
            botDetected: indicatorCount >= 2
        };

        let statusClass, statusText;
        if (indicatorCount >= 2) {
            statusClass = 'bot';
            statusText = `BOT DETECTED (${indicatorCount} indicators)`;
        } else if (indicatorCount === 1) {
            statusClass = 'pending';
            statusText = `SUSPICIOUS (${indicatorCount} indicator)`;
        } else {
            statusClass = 'human';
            statusText = 'HUMAN (0 indicators)';
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
        createResultElement,
        showLoading,
        runWorkerTests,
        resetWorkerTestsCache,
        summarizeResults
    };

})();
