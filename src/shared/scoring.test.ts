import { describe, it, expect } from 'vitest';
import { summarizeResults } from './scoring';
import { finding, inconclusive, pass, type DetectionResult } from './detector-types';

const rawBase = { _debug: { testCount: 0 } };

function f(result: DetectionResult): DetectionResult {
  return { ...result, detectorId: result.detectorId ?? 'test' };
}

describe('evidence-fusion scoring', () => {
  it('navigator.webdriver === true produces a bot verdict', () => {
    const findings = [f(finding('hard', 'webdriver', 'webdriver:true', 'main', 'webdriver-true', 'navigator.webdriver === true'))];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('bot');
    expect(scoring.summary.verdictRule).toContain('hard');
  });

  it('navigator.webdriver === null produces a bot verdict', () => {
    const findings = [f(finding('hard', 'webdriver', 'webdriver:null', 'main', 'webdriver-is-null', 'navigator.webdriver is null'))];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('bot');
    expect(scoring.summary.uniqueEvidenceCount).toBe(1);
  });

  it('the null artifact reported by two detectors is scored once', () => {
    const findings = [
      f({ ...finding('hard', 'webdriver', 'webdriver:null', 'main', 'webdriver-is-null', 'null from hasWebdriverNull'), detectorId: 'hasWebdriverNull' }),
      f({ ...finding('hard', 'webdriver', 'webdriver:null', 'main', 'webdriver-is-null', 'null from hasSuspiciousWeakSignals'), detectorId: 'hasSuspiciousWeakSignals' }),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('bot');
    expect(scoring.summary.uniqueEvidenceCount).toBe(1);
    expect(scoring.findings.length).toBe(2);
    expect(scoring.scoredArtifacts.length).toBe(1);
  });

  it('a known Selenium/CDP marker remains sufficient for bot detection', () => {
    const findings = [f(finding('strong', 'cdp', 'cdp:selenium-default', 'main', 'selenium-default', 'Selenium CDC marker'))];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('bot');
    expect(scoring.summary.verdictRule).toContain('strong-direct');
  });

  it('duplicate reporting of the same marker does not inflate independent evidence count', () => {
    const findings = [
      f({ ...finding('strong', 'cdp', 'cdp:selenium-default', 'main', 'selenium-default', 'Selenium default marker 1'), detectorId: 'isSeleniumChromeDefault' }),
      f({ ...finding('strong', 'cdp', 'cdp:selenium-default', 'main', 'selenium-default', 'Selenium default marker 2'), detectorId: 'isAutomatedWithCDP' }),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.uniqueEvidenceCount).toBe(1);
    expect(scoring.summary.independentCategoryCount).toBe(1);
    expect(scoring.summary.verdict).toBe('bot');
  });

  it('a detector exception is inconclusive, not passed', () => {
    const findings = [
      f(inconclusive('webdriver', 'webdriver:true', 'main', 'detector-exception', 'webdriver check threw'))
    ];
    const raw = { test: { inconclusive: true, reason: 'exception', description: 'webdriver check threw' } };
    const scoring = summarizeResults(raw, findings);
    expect(scoring.tests.test.status).toBe('inconclusive');
    expect(scoring.tests.test.passed).toBe(false);
  });

  it('critical inconclusive checks prevent a clean human verdict', () => {
    const findings = [
      f({ ...inconclusive('webdriver', 'webdriver:true', 'main', 'detector-exception', 'Critical check failed'), critical: true }),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('unknown');
    expect(scoring.summary.verdictRule).toBe('critical-inconclusive');
  });

  it('two weak findings from the same category do not produce a bot verdict', () => {
    const findings = [
      f(finding('weak', 'browser-integrity', 'browser-integrity:a', 'main', 'weak-a', 'Weak A')),
      f(finding('weak', 'browser-integrity', 'browser-integrity:b', 'main', 'weak-b', 'Weak B')),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).not.toBe('bot');
    expect(scoring.summary.independentCategoryCount).toBe(1);
  });

  it('weak findings from several independent categories can corroborate into a bot verdict', () => {
    const findings = [
      f(finding('weak', 'browser-integrity', 'weak:1', 'main', 'integrity', 'Weak integrity')),
      f(finding('weak', 'environment', 'weak:2', 'main', 'environment', 'Weak environment')),
      f(finding('weak', 'fingerprint', 'weak:3', 'main', 'fingerprint', 'Weak fingerprint')),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('bot');
    expect(scoring.summary.verdictRule).toContain('weak-corroboration');
  });

  it('a single weak finding stays human with a low risk', () => {
    const findings = [f(finding('weak', 'environment', 'browser-chrome:outer-eq-inner', 'main', 'outer-eq-inner', 'outer === inner'))];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('human');
    expect(scoring.summary.risk).toBe('low');
    expect(scoring.summary.weakFindings).toBe(1);
    expect(scoring.summary.score).toBeGreaterThan(0);
    expect(scoring.summary.uniqueEvidenceCount).toBe(1);
  });

  it('two weak findings from the same category still do not reach suspicious', () => {
    const findings = [
      f(finding('weak', 'browser-integrity', 'browser-integrity:a', 'main', 'weak-a', 'Weak A')),
      f(finding('weak', 'browser-integrity', 'browser-integrity:b', 'main', 'weak-b', 'Weak B')),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('human');
    expect(scoring.summary.independentCategoryCount).toBe(1);
  });

  it('two weak findings from independent categories are suspicious', () => {
    const findings = [
      f(finding('weak', 'browser-integrity', 'browser-integrity:a', 'main', 'weak-a', 'Weak A')),
      f(finding('weak', 'environment', 'environment:b', 'main', 'weak-b', 'Weak B')),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('suspicious');
    expect(scoring.summary.risk).toBe('medium');
    expect(scoring.summary.independentCategoryCount).toBe(2);
  });

  it('outer < inner remains strong', () => {
    const findings = [f(finding('strong', 'environment', 'browser-chrome:outer-lt-inner', 'main', 'outer-lt-inner', 'outer < inner'))];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.findings[0].severity).toBe('strong');
    expect(scoring.scoredArtifacts[0].severity).toBe('strong');
  });

  it('two independent medium-or-strong categories produce a bot verdict', () => {
    const findings = [
      f(finding('medium', 'cdp', 'cdp:leak', 'main', 'cdp-leak', 'CDP leak')),
      f(finding('medium', 'browser-integrity', 'browser-integrity:prepare-stack-trace', 'main', 'non-native-handler', 'Non-native handler')),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('bot');
    expect(scoring.summary.verdictRule).toContain('two-independent-medium-categories');
  });

  it('one medium plus multiple independent weak findings produces a bot verdict', () => {
    const findings = [
      f(finding('medium', 'cdp', 'cdp:leak', 'main', 'cdp-leak', 'CDP leak')),
      f(finding('weak', 'environment', 'browser-chrome:outer-eq-inner', 'main', 'outer-eq-inner', 'outer === inner')),
      f(finding('weak', 'browser-integrity', 'plugins:anomaly', 'main', 'plugins-anomaly', 'Plugins anomaly')),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('bot');
    expect(scoring.summary.verdictRule).toContain('medium-plus-weak');
  });

  it('one strong non-direct category plus two independent weak findings also produces a bot verdict', () => {
    const findings = [
      f(finding('strong', 'environment', 'environment:strong', 'main', 'strong-env', 'Strong environment signal')),
      f(finding('weak', 'browser-integrity', 'browser-integrity:weak', 'main', 'weak-bi', 'Weak integrity')),
      f(finding('weak', 'fingerprint', 'fingerprint:weak', 'main', 'weak-fp', 'Weak fingerprint')),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.verdict).toBe('bot');
    expect(scoring.summary.verdictRule).toContain('medium-plus-weak');
  });

  it('deduplication keeps every reporting detector ID when a stronger finding wins', () => {
    const raw = { detA: { probe: 'weak' }, detB: { probe: 'strong' } };
    const findings = [
      f({ ...finding('weak', 'environment', 'dup:artifact', 'main', 'dup', 'weak report'), detectorId: 'detA' }),
      f({ ...finding('strong', 'environment', 'dup:artifact', 'main', 'dup', 'strong report'), detectorId: 'detB' }),
    ];
    const scoring = summarizeResults(raw, findings);
    expect(scoring.scoredArtifacts).toHaveLength(1);
    const artifact = scoring.scoredArtifacts[0];
    expect(artifact.severity).toBe('strong');
    expect(artifact.detectorIds).toEqual(['detA', 'detB']);
    // Both detectors keep score attribution even though only detB's finding is
    // the representative artifact.
    expect(scoring.tests.detA.scoreContribution).toBe(4);
    expect(scoring.tests.detB.scoreContribution).toBe(4);
  });

  it('passes and inconclusive results are tracked in coverage summary', () => {
    const findings = [
      f(pass('webdriver', 'webdriver:true', 'main', 'no-finding', 'No webdriver')),
      f({ ...inconclusive('worker', 'worker:integrity', 'worker', 'worker-timeout', 'Worker timeout'), critical: true }),
      f(finding('weak', 'environment', 'hardware:high-concurrency', 'main', 'high-cores', 'High core count')),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.criticalChecksTotal).toBe(1);
    expect(scoring.summary.criticalChecksInconclusive).toBe(1);
    expect(scoring.summary.coverage).toBe(0);
    // A failed critical check must surface as reduced coverage (unknown),
    // not be obscured by a weaker unrelated finding (suspicious).
    expect(scoring.summary.verdict).toBe('unknown');
    expect(scoring.summary.risk).toBe('medium');
    expect(scoring.summary.confidence).toBeLessThan(1);
  });

  it('risk is low and confidence is high when all critical checks pass and no evidence is found', () => {
    const findings = [
      f({ ...pass('webdriver', 'webdriver:true', 'main', 'no-finding', 'No webdriver'), critical: true }),
      f({ ...pass('cdp', 'cdp:selenium-default', 'main', 'no-finding', 'No CDP'), critical: true }),
    ];
    const scoring = summarizeResults(rawBase, findings);
    expect(scoring.summary.risk).toBe('low');
    expect(scoring.summary.confidence).toBe(1);
    expect(scoring.summary.coverage).toBe(100);
  });
});
