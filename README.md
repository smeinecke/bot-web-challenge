# Bot Detection Challenge

A standalone bot detection challenge for testing browser automation stealth capabilities.

**[Live Demo](https://smeinecke.github.io/bot-web-challenge/)**

## Overview

This project has been migrated to TypeScript with Vite for improved developer experience and build-time metadata injection. The detection functionality remains the same, with added type safety and automated deployment via GitHub Actions.

### Tech Stack

- **TypeScript** - Type-safe JavaScript with modern language features
- **Vite** - Fast build tool with hot module replacement
- **GitHub Actions** - Automated CI/CD and GitHub Pages deployment

### Build Info

The JSON output now includes build metadata:

```json
{
  "detector": {
    "name": "bot-web-challenge",
    "version": "0.1.0",
    "schemaVersion": 1,
    "buildTime": "2026-04-30T12:34:56.000Z",
    "gitCommit": "abc1234",
    "gitBranch": "main"
  }
}
```

These pages implement bot detection techniques similar to [deviceandbrowserinfo.com](https://deviceandbrowserinfo.com/are_you_a_bot) but run locally for faster, more reliable testing.

### Pages

- **`index.html`** - Landing page with links to both tests
- **`static.html`** - Static fingerprinting tests (21+ bot detection signals)
- **`interactions.html`** - Interaction-based tests (mouse, typing, timing analysis)

### Static Detection Tests

| Test | Description |
|------|-------------|
| `hasBotUserAgent` | Detects known bot patterns in User-Agent |
| `hasWebdriverTrue` | Checks `navigator.webdriver === true` |
| `hasWebdriverInFrameTrue` | Checks webdriver in iframe context |
| `isPlaywright` | Detects Playwright-specific globals |
| `hasInconsistentChromeObject` | Validates `window.chrome` properties |
| `isPhantom` | Detects PhantomJS |
| `isNightmare` | Detects Nightmare.js |
| `isSequentum` | Detects Sequentum scraping tool |
| `isSeleniumChromeDefault` | Detects Selenium `cdc_` markers |
| `isHeadlessChrome` | Detects headless-specific features |
| `isWebGLInconsistent` | Detects SwiftShader/llvmpipe renderers |
| `isAutomatedWithCDP` | Detects CDP automation markers |
| `isAutomatedViaStackTrace` | Detects CDP via Error.prepareStackTrace |
| `hasCanvasAvailabilityIssue` | Validates canvas API availability |
| `hasAudioFingerprintIssue` | Detects headless audio output |
| `hasInconsistentClientHints` | Checks User-Agent Data consistency |
| `hasInconsistentGPUFeatures` | Detects software rendering |
| `isIframeOverridden` | Detects anti-detection scripts |
| `hasBlobIframeCDPIssue` | Detects CDP/automation leaks via blob URL iframe |
| `hasInconsistentWorkerValues` | Compares main/worker context values |
| `hasHighHardwareConcurrency` | Detects VM/cloud environments (>16 cores) |
| `hasHeadlessChromeDefaultScreenResolution` | Detects headless resolutions |
| `hasSuspiciousWeakSignals` | Collective weak signal analysis |

> **Important Note on Weak Signals**
>
> Some checks are weak corroborating signals and may trigger in privacy-hardened, enterprise, remote desktop, VM, accessibility, or mobile environments. Do not treat a single weak signal as proof of automation. Weak signals include:
> - `hasScreenAvailabilityAnomaly`
> - `hasTouchInconsistency`
> - `hasSuspiciousWeakSignals`
> - `hasCanvasAvailabilityIssue`
> - `hasAudioFingerprintIssue`
> - `hasHighHardwareConcurrency`
>
> These should be interpreted as supporting evidence only when combined with stronger indicators like `navigator.webdriver`, known bot user agents, or CDP markers.

### Interaction Detection Tests

| Test | Description |
|------|-------------|
| `suspiciousClientSideBehavior` | Mouse path analysis, form timing |
| `superHumanSpeed` | Typing speed > 15 CPS |
| `hasCDPMouseLeak` | Detects CDP screen coordinate leak |

## Development

### Prerequisites

- Node.js 22+
- npm

### Setup

```bash
npm install
```

### Development Server

```bash
npm run dev
```

Runs the dev server on `http://localhost:5173`.

### Build

```bash
npm run typecheck
npm run build
```

The built site will be in the `dist/` directory.

## Deployment

### GitHub Pages (Automatic)

The project is configured for automatic deployment to GitHub Pages:

1. **Repository Settings** → **Pages**
   - Source: **GitHub Actions**

2. On every push to `main`:
   - CI runs `npm run typecheck` and `npm run build`
   - The `dist/` folder is automatically deployed

3. Manual deployment: Trigger the `deploy-pages.yml` workflow via **Actions** tab

### GitHub Pages Base Path

The Vite config automatically detects GitHub Pages environment via `GITHUB_PAGES` and `GITHUB_REPOSITORY` environment variables. For project pages (e.g., `https://username.github.io/repo-name/`), the base path is set automatically.

### Manual Deployment

Copy the contents of `dist/` to your web server. The project is a static site with no backend requirements.

## Usage

### Manual Testing

1. Open `static.html` in a browser to see static detection results
2. Open `interactions.html`, fill the form, and submit to see interaction analysis
3. Use the "Simulate bot" checkbox to test detection accuracy

### Programmatic Access

Click "Show JSON Output" or "Copy JSON" to get machine-readable results:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "userAgent": "...",
  "url": "...",
  "tests": {
    "hasWebdriverTrue": { "passed": true, "value": false, "description": null },
    "isHeadlessChrome": { "passed": false, "value": {...}, "description": "..." }
  },
  "summary": {
    "totalTests": 22,
    "passed": 20,
    "failed": 2,
    "botDetected": true,
    "indicatorCount": 2
  }
}
```

## References

- Based on detection techniques from [deviceandbrowserinfo.com](https://deviceandbrowserinfo.com/are_you_a_bot)
- Audio fingerprinting based on [fingerprintjs2](https://github.com/Valve/fingerprintjs2)
- CDP detection via [puppeteer-extra-stealth](https://github.com/berstend/puppeteer-extra) evasion techniques
