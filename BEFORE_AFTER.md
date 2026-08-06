# Bot Detection Challenge — Before/After Report

## Summary

The detector was migrated from flat boolean/raw-object results to a structured `DetectionResult` model with an evidence-fusion scoring engine. The changes make the system more accurate at separating direct automation evidence from weak corroborating signals, restore stack-trace sensitivity, fix the `navigator.webdriver === null` classification, and protect user privacy in interaction tracking.

## Before

| Area | Behaviour |
|------|-----------|
| Result shape | Each detector returned `boolean`, `Record<string, unknown>`, or `false`. Severity was inferred independently by `ui-rendering.ts` from the raw value. |
| Scoring | Raw scores were accumulated linearly. Multiple weak signals from the same category could inflate the total and push a result over the bot threshold. |
| `navigator.webdriver === null` | Reported inside `hasSuspiciousWeakSignals` as a generic weak signal or as `webdriverIsNull` with the wrong `typeof` baseline. |
| `Error.prepareStackTrace` | `checkCDPViaStackTrace` returned a simple boolean; non-native handlers were not classified by source and no clean-iframe comparison was used. |
| Browser chrome | `checkMissingBrowserChrome` returned a single `Record` or `false`; `outer === inner` and `outer < inner` were not distinguished by severity and the artifact was not stable. |
| Interaction tracking | `tracking` stored `key` and `code` in `keyEvents` and the raw `value` of inputs in `inputEvents`. The "low observation" logic was part of `suspiciousClientSideBehavior` and could flag ordinary autofill. |
| Page wiring | `static.ts` and `interactions.ts` called each detector manually and rebuilt the score/display logic separately. |

## After

| Area | Behaviour |
|------|-----------|
| Result shape | `DetectionResult` with `status` (`passed` / `finding` / `inconclusive`), `severity` (`info`/`weak`/`medium`/`strong`/`hard`), `category`, `artifactId`, `context`, `reason`, `description`, and `evidence`. Helpers `pass()`, `finding()`, and `inconclusive()` enforce the shape. |
| Scoring | Evidence-fusion model: deduplicates artifacts by `artifactId` + `context`, groups findings by independent `category`, and applies rule-based verdicts. A single weak category cannot produce a `bot` verdict. Direct `hard`/`strong` evidence in `webdriver`, `cdp`, or `automation-global` is sufficient for `bot`. Two medium categories or several weak independent categories can corroborate to `bot`. Critical inconclusive checks produce `unknown` (not `human`). |
| `navigator.webdriver === null` | `hasWebdriverNull` is a dedicated, critical detector with stable artifact `webdriver:null` and `hard` severity. `hasSuspiciousWeakSignals` no longer double-scores it; the detector is referenced only for non-webdriver weak signals. |
| `Error.prepareStackTrace` | `checkPrepareStackTrace` inspects both the main realm and a clean `about:blank` iframe. Non-native handlers are classified by source: explicit automation markers → `strong`/`hard`, DevTools/Extension → `info`, unknown → `medium`. A realm mismatch is a separate medium `browser-integrity` finding. |
| Browser chrome | `checkMissingBrowserChrome` returns a `DetectionResult[]` with distinct artifact IDs: `browser-chrome:zero-outer` (`strong`), `browser-chrome:outer-lt-inner` (`strong`), `browser-chrome:outer-eq-inner` (`weak`, and only when not fullscreen). |
| Interaction tracking | `interaction-checks.ts` tracks only timing, trust flags, `inputType`, and coordinates. It never stores `KeyboardEvent.key`, `code`, `keyCode`, input values, passwords, pasted text, clipboard, or `MouseEvent.target`. New detectors `insufficientObservationWindow` (critical, inconclusive) and `lowObservationSubmission` (weak/medium with corroboration only) split the old logic. Ordinary browser autofill with trusted input/focus and reasonable timing is not classified as a bot. |
| Page wiring | Both pages run `runDetectors(getStaticDetectors() / getAllDetectors())` and `summarizeResults()`. `renderResults()` is the single UI path, so the displayed severity always equals the scoring severity. |

## Key Behavioral Test Results

- `navigator.webdriver === true` → `bot` (`hard-direct`).
- `navigator.webdriver === null` → `bot` with stable `webdriver:null` artifact.
- Duplicate `webdriver:null` from two detectors → one scored artifact.
- Selenium / CDP marker → `bot` (`strong-direct`).
- Duplicate CDP/Selenium marker → does not inflate independent category count.
- Non-native anonymous `prepareStackTrace` handler → `medium` `browser-integrity` finding.
- Clearly DevTools-originated handler → `info` only.
- Detector exception or timeout → `inconclusive`, not `passed`.
- Critical inconclusive check → prevents a clean `human` verdict (`unknown`).
- Two weak findings in the same category → `suspicious`, not `bot`.
- Weak findings in three independent categories → `bot` by corroboration.
- `outer === inner` outside fullscreen → `weak` only, cannot bot alone.
- `outer < inner` → `strong`.
- Rapid low-observation scripted submission → `suspicious`/`bot` with corroboration.
- Realistic autofill submission → not a bot.

## Verification

```bash
npm run typecheck
npm run test
npm run build
```

All commands pass. The test suite has 51 unit and regression tests using Vitest + jsdom.
