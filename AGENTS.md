# Agent Notes

## Project

Static + interaction-based bot-detection frontend built with Vite and TypeScript.

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

- `src/shared/detector-types.ts` — structured `DetectionResult` model (`status`, `severity`, `category`, `artifactId`, `context`).
- `src/shared/scoring.ts` — evidence-fusion scoring engine. Verdicts: `human`, `suspicious`, `bot`, `unknown`.
- `src/shared/detector-registry.ts` — shared registry of all detectors, normalization, and runner.
- `src/shared/browser-checks.ts` — static browser checks (webdriver, stack-trace, chrome, etc.).
- `src/shared/interaction-checks.ts` — interaction tracking and analysis.
- `src/shared/behavior-features.ts` — multi-dimensional behavioral feature extraction and fusion for interaction scoring.
- `src/shared/cross-realm.ts` — generalized cross-realm consistency engine (main, iframe, blob iframe, worker).
- `src/shared/challenge.ts` — Lab/Challenge mode planning and randomized detector subset selection.
- `src/shared/ui-rendering.ts` — renders `ScoringResult` to DOM using the scored severity.
- `src/shared/json-output.ts` — builds JSON output with `findings`, `scoredArtifacts`, and `summary`.
- `src/pages/static.ts` and `src/pages/interactions.ts` — page entry points using the registry.

## Testing

- Tests are in `src/**/*.test.ts` and run with Vitest + jsdom.
- Regression fixtures live in `src/shared/__fixtures__/regression-fixtures.ts`.
- jsdom does not implement `HTMLCanvasElement.prototype.getContext`, so canvas/WebGL/GPU checks return `inconclusive` in tests.

## Timing Integrity

- `src/shared/timing-checks.ts` collects `performance.now()` tight-loop samples across main, same-origin iframe, blob iframe, worker, and shared worker.
- Raw resolution and zero-delta counts are diagnostic only; only semantic contradictions (call-frequency inflation, non-monotonic clocks, cross-realm timing mismatches, real-delay/timeOrigin/rAF/event-timestamp drift) are scored.
- All scored timing artifacts use `category: 'timing'` so the fusion engine treats them as one category.
- External detector values or site-specific fingerprints are never copied; unsupported APIs are reported as not applicable rather than a pass.

## Build Constants

`vite.config.ts` injects `__SCHEMA_VERSION__` (currently `3`) and build metadata.
