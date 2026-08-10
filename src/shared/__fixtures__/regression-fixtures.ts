import type { DetectionResult, ScoringResult, DetectorResults } from '../detector-types';
import { finding, inconclusive, pass } from '../detector-types';

/**
 * Regression fixtures for the scoring engine.
 *
 * Each fixture is a set of raw detector IDs + normalized findings and the
 * expected scoring summary. They capture the behavior the scoring engine must
 * never regress on.
 */

export interface RegressionFixture {
  name: string;
  raw: DetectorResults;
  findings: DetectionResult[];
  expected: Partial<ScoringResult['summary']>;
}

export const REGRESSION_FIXTURES: RegressionFixture[] = [
  {
    name: 'human baseline with all passes',
    raw: { a: false, b: false },
    findings: [
      { ...pass('webdriver', 'webdriver:true', 'main', 'no-finding', 'No webdriver'), detectorId: 'a', critical: true },
      { ...pass('cdp', 'cdp:selenium-default', 'main', 'no-finding', 'No CDP'), detectorId: 'b', critical: true },
    ],
    expected: { verdict: 'human', botDetected: false, coverage: 100 },
  },
  {
    name: 'navigator.webdriver === true (hard)',
    raw: { a: true },
    findings: [
      { ...finding('hard', 'webdriver', 'webdriver:true', 'main', 'webdriver-true', 'navigator.webdriver === true'), detectorId: 'a', critical: true },
    ],
    expected: { verdict: 'bot', botDetected: true, uniqueEvidenceCount: 1, verdictRule: 'hard:webdriver:webdriver:true' },
  },
  {
    name: 'navigator.webdriver === null (hard)',
    raw: { a: true },
    findings: [
      { ...finding('hard', 'webdriver', 'webdriver:null', 'main', 'webdriver-is-null', 'navigator.webdriver is null'), detectorId: 'a', critical: true },
    ],
    expected: { verdict: 'bot', botDetected: true, uniqueEvidenceCount: 1, verdictRule: 'hard:webdriver:webdriver:null' },
  },
  {
    name: 'duplicate webdriver:null artifact from two detectors is one evidence unit',
    raw: { a: true, b: true },
    findings: [
      { ...finding('hard', 'webdriver', 'webdriver:null', 'main', 'webdriver-is-null', 'null from A'), detectorId: 'a', critical: true },
      { ...finding('hard', 'webdriver', 'webdriver:null', 'main', 'webdriver-is-null', 'null from B'), detectorId: 'b', critical: true },
    ],
    expected: { verdict: 'bot', botDetected: true, uniqueEvidenceCount: 1, independentCategoryCount: 1 },
  },
  {
    name: 'Selenium CDC marker remains sufficient',
    raw: { a: true },
    findings: [
      { ...finding('strong', 'cdp', 'cdp:selenium-default', 'main', 'selenium-default', 'Selenium CDC marker'), detectorId: 'a', critical: true },
    ],
    expected: { verdict: 'bot', botDetected: true, uniqueEvidenceCount: 1, verdictRule: 'strong-direct:cdp:cdp:selenium-default' },
  },
  {
    name: 'two weak same category cannot reach suspicious or bot',
    raw: { a: { reason: 'x' }, b: { reason: 'y' } },
    findings: [
      { ...finding('weak', 'browser-integrity', 'browser-integrity:x', 'main', 'x', 'Weak x'), detectorId: 'a', critical: false },
      { ...finding('weak', 'browser-integrity', 'browser-integrity:y', 'main', 'y', 'Weak y'), detectorId: 'b', critical: false },
    ],
    expected: { verdict: 'human', botDetected: false, independentCategoryCount: 1, risk: 'low' },
  },
  {
    name: 'three independent weak categories corroborate to bot',
    raw: { a: true, b: true, c: true },
    findings: [
      { ...finding('weak', 'browser-integrity', 'weak:1', 'main', 'integrity', 'Weak integrity'), detectorId: 'a', critical: false },
      { ...finding('weak', 'environment', 'weak:2', 'main', 'environment', 'Weak environment'), detectorId: 'b', critical: false },
      { ...finding('weak', 'fingerprint', 'weak:3', 'main', 'fingerprint', 'Weak fingerprint'), detectorId: 'c', critical: false },
    ],
    expected: { verdict: 'bot', botDetected: true, independentCategoryCount: 3, verdictRule: 'weak-corroboration:browser-integrity,environment,fingerprint' },
  },
  {
    name: 'critical inconclusive prevents clean human verdict',
    raw: { a: { inconclusive: true, reason: 'timeout' } },
    findings: [
      { ...inconclusive('webdriver', 'webdriver:true', 'main', 'timeout', 'Timed out'), detectorId: 'a', critical: true },
    ],
    expected: { verdict: 'unknown', botDetected: false, coverage: 0 },
  },
  {
    name: 'two independent medium categories produce bot',
    raw: { a: true, b: true },
    findings: [
      { ...finding('medium', 'cdp', 'cdp:leak', 'main', 'cdp-leak', 'CDP leak'), detectorId: 'a', critical: true },
      { ...finding('medium', 'browser-integrity', 'browser-integrity:prepare-stack-trace', 'main', 'non-native-handler', 'Non-native handler'), detectorId: 'b', critical: false },
    ],
    expected: { verdict: 'bot', botDetected: true, independentCategoryCount: 2, verdictRule: 'two-independent-medium-categories:cdp,browser-integrity' },
  },
  {
    name: 'medium plus independent weak produces bot',
    raw: { a: true, b: true, c: true },
    findings: [
      { ...finding('medium', 'cdp', 'cdp:leak', 'main', 'cdp-leak', 'CDP leak'), detectorId: 'a', critical: true },
      { ...finding('weak', 'environment', 'browser-chrome:outer-eq-inner', 'main', 'outer-eq-inner', 'outer === inner'), detectorId: 'b', critical: false },
      { ...finding('weak', 'browser-integrity', 'plugins:anomaly', 'main', 'plugins-anomaly', 'Plugins anomaly'), detectorId: 'c', critical: false },
    ],
    expected: { verdict: 'bot', botDetected: true, independentCategoryCount: 3, verdictRule: 'medium-plus-weak:cdp+environment,browser-integrity' },
  },
  {
    name: 'single weak signal (outer === inner) is human, not suspicious or bot',
    raw: { a: true },
    findings: [
      { ...finding('weak', 'environment', 'browser-chrome:outer-eq-inner', 'main', 'outer-eq-inner', 'outer === inner'), detectorId: 'a', critical: false },
    ],
    expected: { verdict: 'human', botDetected: false, uniqueEvidenceCount: 1, risk: 'low', score: 0.5 },
  },
  {
    name: 'outer < inner is strong but a single non-automation category stays suspicious',
    raw: { a: true },
    findings: [
      { ...finding('strong', 'environment', 'browser-chrome:outer-lt-inner', 'main', 'outer-lt-inner', 'outer < inner'), detectorId: 'a', critical: false },
    ],
    expected: { verdict: 'suspicious', botDetected: false, uniqueEvidenceCount: 1 },
  },
];
