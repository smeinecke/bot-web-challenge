# Agent Notes

## Project

Static + interaction-based bot-detection frontend built with Vite and TypeScript.
Pages: `index.html` (landing), `static.html` (static fingerprinting),
`interactions.html` (behavioral form analysis), `challenge.html` (randomized
nonce-bound challenge mode). Entry points live in `src/pages/`.

## Verification

Run these in order before finishing work:

```bash
npm run typecheck
npm run test
npm run build
```

- `typecheck` runs `tsc --noEmit`.
- `test` runs `vitest run` in jsdom.
- `build` runs `vite build` and produces `dist/`.

## Key Architecture

- `src/shared/detector-types.ts` — structured `DetectionResult` model (`status`, `severity`, `category`, `artifactId`, `context`) plus `pass()`/`finding()`/`inconclusive()`/`notApplicable()` helpers.
- `src/shared/scoring.ts` — evidence-fusion scoring engine. Verdicts: `human`, `suspicious`, `bot`, `unknown`.
- `src/shared/detector-registry.ts` — shared registry of all detectors (40 static + 6 interaction), normalization (`defaultNormalize` + per-detector overrides), and the `runDetectors` runner.
- `src/shared/browser-checks.ts` — static browser checks (webdriver, stack-trace, chrome, etc.).
- `src/shared/worker-checks.ts` — Web Worker probes (`runWorkerTests` is cached once per page load).
- `src/shared/interaction-checks.ts` — interaction tracking and analysis (privacy-preserving; never stores key/code/values).
- `src/shared/behavior-features.ts` — multi-dimensional behavioral feature extraction (pointer/keyboard/form/session/cdp) and fusion for interaction scoring.
- `src/shared/cross-realm.ts` — generalized cross-realm consistency engine (main, same-origin iframe, blob iframe, worker, shared worker) driven by `DEFAULT_PROBES`.
- `src/shared/gpu-coherence.ts` — WebGL vs WebGPU adapter coherence.
- `src/shared/timing-checks.ts` — timing integrity subsystem (see below).
- `src/shared/challenge.ts` — Lab/Challenge mode planning and randomized detector subset selection.
- `src/shared/ui-rendering.ts` — renders `ScoringResult` to DOM using the scored severity; `test-descriptions.ts` feeds the per-test help modal.
- `src/shared/json-output.ts` — builds JSON output with `findings`, `scoredArtifacts`, and `summary`.
- `src/shared/build-info.ts` — build-time constants.
- `src/pages/static.ts`, `src/pages/interactions.ts`, `src/pages/challenge.ts` — page entry points using the registry.

## Testing

- Tests are in `src/**/*.test.ts` and run with Vitest + jsdom.
- Regression fixtures live in `src/shared/__fixtures__/regression-fixtures.ts`.
- jsdom does not implement `HTMLCanvasElement.prototype.getContext` (stubbed to throw in `vitest.setup.ts`), so canvas/WebGL/GPU checks return `inconclusive` in tests.
- `cross-realm.ts` contains a jsdom-specific `patchJsdomCanvas` hack keyed on `navigator.userAgent` containing `jsdom` — production code, test-only behavior.

## Timing Integrity

- `src/shared/timing-checks.ts` collects `performance.now()` tight-loop samples across main, same-origin iframe, blob iframe, worker, and shared worker.
- Raw resolution and zero-delta counts are diagnostic only; only semantic contradictions (call-frequency inflation, non-monotonic clocks, cross-realm timing mismatches, real-delay/timeOrigin/rAF/event-timestamp drift) are scored.
- All scored timing artifacts use `category: 'timing'` so the fusion engine treats them as one category.
- External detector values or site-specific fingerprints are never copied; unsupported APIs are reported as not applicable rather than a pass.

## Conventions

- Detector results use the structured `DetectionResult` model; emit `finding`/`inconclusive`/`notApplicable` rather than boolean where a check cannot run.
- Unsupported APIs should produce `not-applicable`, not `passed`.
- Interaction tracking is privacy-preserving by design: never store key codes, characters, input values, clipboard data, or DOM targets — only structural/timing metadata.
- The challenge token (`buildChallengeToken`) is unsigned base64 JSON — a display/demo artifact, not a verifiable credential.

## Build Constants

`vite.config.ts` injects `__SCHEMA_VERSION__` (currently `3`), `__APP_NAME__`,
`__APP_VERSION__` (from `npm_package_version` — `0.0.0` when run outside npm),
`__BUILD_TIME__`, `__GIT_COMMIT__`, `__GIT_BRANCH__`.
