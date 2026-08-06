import { describe, it, expect } from 'vitest';
import { summarizeResults } from './scoring';
import { REGRESSION_FIXTURES } from './__fixtures__/regression-fixtures';

describe('regression fixtures', () => {
  for (const fixture of REGRESSION_FIXTURES) {
    it(fixture.name, () => {
      const scoring = summarizeResults(fixture.raw, fixture.findings);
      for (const [key, value] of Object.entries(fixture.expected)) {
        expect(scoring.summary[key as keyof typeof scoring.summary]).toBe(value);
      }
    });
  }
});
