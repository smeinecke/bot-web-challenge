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
- `src/shared/ui-rendering.ts` — renders `ScoringResult` to DOM using the scored severity.
- `src/shared/json-output.ts` — builds JSON output with `findings`, `scoredArtifacts`, and `summary`.
- `src/pages/static.ts` and `src/pages/interactions.ts` — page entry points using the registry.

## Testing

- Tests are in `src/**/*.test.ts` and run with Vitest + jsdom.
- Regression fixtures live in `src/shared/__fixtures__/regression-fixtures.ts`.
- jsdom does not implement `HTMLCanvasElement.prototype.getContext`, so canvas/WebGL/GPU checks return `inconclusive` in tests.

## Build Constants

`vite.config.ts` injects `__SCHEMA_VERSION__` (currently `2`) and build metadata.
