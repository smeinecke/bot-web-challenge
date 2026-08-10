import { describe, it, expect } from 'vitest';
import { getStaticDetectors, getAllDetectors, getInteractionDetectors, runDetectors } from './detector-registry';
import { summarizeResults } from './scoring';
import { createResultElement } from './ui-rendering';
import { type NormalizedTestResult } from './detector-types';

describe('detector registry', () => {
  it('static and interaction configurations contain the same static detector IDs', () => {
    const staticIds = new Set(getStaticDetectors().map(d => d.id));
    const interactionIds = new Set(getInteractionDetectors().map(d => d.id));
    for (const id of staticIds) {
      expect(interactionIds.has(id)).toBe(true);
    }
    expect(getAllDetectors().length).toBe(getStaticDetectors().length + (getInteractionDetectors().length - getStaticDetectors().length));
  });

  it('static and interaction configurations have the same static detector IDs in the same order', () => {
    const staticIds = getStaticDetectors().map(d => d.id);
    const interactionStaticIds = getInteractionDetectors()
      .filter(d => !['insufficientObservationWindow', 'lowObservationSubmission', 'suspiciousClientSideBehavior', 'superHumanSpeed', 'hasCDPMouseLeak', 'hasAdvancedBotSignals'].includes(d.id))
      .map(d => d.id);
    expect(interactionStaticIds).toEqual(staticIds);
  });

  it('legacy worker value comparison is subsumed by the cross-realm engine', () => {
    const staticIds = getStaticDetectors().map(d => d.id);
    expect(staticIds).not.toContain('hasInconsistentWorkerValues');
    expect(staticIds).toContain('hasCrossRealmInconsistency');
  });

  it('UI severity and scoring severity are identical', () => {
    const result: NormalizedTestResult = {
      status: 'finding',
      passed: false,
      severity: 'medium',
      category: 'cdp',
      artifactId: 'cdp:leak',
      context: 'main',
      countsAsIndicator: true,
      scoreContribution: 2,
      value: null,
      description: 'CDP leak detected',
    };

    const el = createResultElement('cdp-leak', result);
    const valueSpan = el.querySelector('.value');
    expect(valueSpan?.classList.contains('medium')).toBe(true);
    expect(valueSpan?.textContent).toBe('MEDIUM');

    const hard: NormalizedTestResult = { ...result, severity: 'hard', scoreContribution: 8 };
    const hardEl = createResultElement('hard-leak', hard);
    const hardSpan = hardEl.querySelector('.value');
    expect(hardSpan?.classList.contains('hard')).toBe(true);
    expect(hardSpan?.textContent).toBe('HARD');
  });

  it('a detector exception is inconclusive, not passed', async () => {
    const { rawResults, findings } = await runDetectors([
      {
        id: 'willThrow',
        artifactId: 'thrower',
        category: 'browser-integrity',
        context: 'main',
        critical: false,
        isAsync: false,
        run: () => { throw new Error('boom'); },
      },
    ]);
    const scoring = summarizeResults(rawResults, findings);
    expect(scoring.tests.willThrow.status).toBe('inconclusive');
    expect(scoring.tests.willThrow.passed).toBe(false);
  });

  it('detector timeout is inconclusive, not passed', async () => {
    const { rawResults, findings } = await runDetectors([
      {
        id: 'willTimeout',
        artifactId: 'timeout',
        category: 'browser-integrity',
        context: 'main',
        critical: false,
        isAsync: true,
        timeoutMs: 50,
        run: async () => new Promise(() => {}),
      },
    ]);
    const scoring = summarizeResults(rawResults, findings);
    expect(scoring.tests.willTimeout.status).toBe('inconclusive');
    expect(scoring.tests.willTimeout.passed).toBe(false);
  });
});
