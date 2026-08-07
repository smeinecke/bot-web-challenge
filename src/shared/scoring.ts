/**
 * Centralized evidence-fusion scoring module for detector results.
 *
 * The scoring engine consumes normalized `DetectionResult[]` values. It
 * deduplicates artifacts by identity, evaluates categories independently,
 * applies cross-context corroboration, and produces a verdict and summary.
 */
import type {
  DetectionCategory,
  DetectionContext,
  DetectionResult,
  DetectionRisk,
  DetectionSeverity,
  DetectorResults,
  DetectorSummary,
  NormalizedTestResult,
  ScoringResult,
} from './detector-types';

// Severity point values for display score only. Verdict is rule-based.
const SEVERITY_SCORE: Record<DetectionSeverity, number> = {
  info: 0,
  weak: 0.5,
  medium: 2,
  strong: 4,
  hard: 8,
};

const CROSS_CONTEXT_BONUS_PER_EXTRA = 0.25;
const CROSS_CONTEXT_BONUS_MAX = 1.0;

// Verdict rule helpers
const DIRECT_AUTOMATION_CATEGORIES: DetectionCategory[] = ['webdriver', 'cdp', 'automation-global'];

function isDirectAutomationCategory(category: DetectionCategory): boolean {
  return DIRECT_AUTOMATION_CATEGORIES.includes(category);
}

function severityRank(severity: DetectionSeverity): number {
  const rank: Record<DetectionSeverity, number> = {
    info: 0,
    weak: 1,
    medium: 2,
    strong: 3,
    hard: 4,
  };
  return rank[severity];
}

/**
 * Deduplicate findings into unique scored artifacts.
 *
 * Artifact identity is `artifactId + ':' + context`. If the same artifact is
 * reported by several detectors, keep the most severe, clearest finding. The
 * raw observations are still preserved in the per-detector raw map.
 */
function deduplicateArtifacts(findings: DetectionResult[]): DetectionResult[] {
  const byKey = new Map<string, DetectionResult>();

  for (const f of findings) {
    if (f.status === 'passed') continue;
    const key = `${f.artifactId}:${f.context}`;
    const existing = byKey.get(key);
    if (!existing || severityRank(f.severity) > severityRank(existing.severity)) {
      byKey.set(key, f);
    }
  }

  return Array.from(byKey.values());
}

/**
 * Compute a cross-context corroboration bonus: when the same artifactId is
 * observed in multiple independent contexts, a small score bonus is added,
 * capped so it cannot produce a bot verdict by itself.
 */
function crossContextBonus(scoredArtifacts: DetectionResult[]): number {
  const contextsByArtifact = new Map<string, Set<DetectionContext>>();
  for (const a of scoredArtifacts) {
    if (a.severity === 'info') continue;
    const set = contextsByArtifact.get(a.artifactId) ?? new Set<DetectionContext>();
    set.add(a.context);
    contextsByArtifact.set(a.artifactId, set);
  }

  let bonus = 0;
  for (const contexts of contextsByArtifact.values()) {
    const extra = Math.max(0, contexts.size - 1);
    bonus += Math.min(extra * CROSS_CONTEXT_BONUS_PER_EXTRA, CROSS_CONTEXT_BONUS_MAX);
  }
  return bonus;
}

interface CategoryEvidence {
  category: DetectionCategory;
  maxSeverity: DetectionSeverity;
  count: number;
}

function collectCategoryEvidence(scoredArtifacts: DetectionResult[]): CategoryEvidence[] {
  const byCategory = new Map<DetectionCategory, CategoryEvidence>();

  for (const a of scoredArtifacts) {
    if (a.status !== 'finding') continue;
    if (a.severity === 'info') continue;

    let ev = byCategory.get(a.category);
    if (!ev) {
      ev = { category: a.category, maxSeverity: a.severity, count: 0 };
      byCategory.set(a.category, ev);
    }
    ev.count++;
    if (severityRank(a.severity) > severityRank(ev.maxSeverity)) {
      ev.maxSeverity = a.severity;
    }
  }

  return Array.from(byCategory.values()).sort((a, b) =>
    severityRank(b.maxSeverity) - severityRank(a.maxSeverity)
  );
}

export interface VerdictDecision {
  verdict: 'human' | 'suspicious' | 'bot' | 'unknown';
  rule: string;
  score: number;
  displayScore: number;
}

function computeDisplayScore(scoredArtifacts: DetectionResult[]): number {
  return Math.round(
    (scoredArtifacts
      .filter(a => a.status === 'finding' && a.severity !== 'info')
      .reduce((sum, a) => sum + SEVERITY_SCORE[a.severity], 0) +
      crossContextBonus(scoredArtifacts)) *
      10
  ) / 10;
}

function decideVerdict(
  scoredArtifacts: DetectionResult[],
  allFindings: DetectionResult[],
  categoryEvidence: CategoryEvidence[]
): VerdictDecision {
  const displayScore = computeDisplayScore(scoredArtifacts);

  const hard = scoredArtifacts.filter(a => a.severity === 'hard');
  const strongAutomation = scoredArtifacts.filter(
    a => a.severity === 'strong' && isDirectAutomationCategory(a.category)
  );

  // 1. Hard evidence is conclusive.
  if (hard.length > 0) {
    const artifact = hard[0];
    return {
      verdict: 'bot',
      rule: `hard:${artifact.category}:${artifact.artifactId}`,
      score: SEVERITY_SCORE.hard,
      displayScore,
    };
  }

  // 2. Strong direct automation evidence is sufficient on its own.
  if (strongAutomation.length > 0) {
    const artifact = strongAutomation[0];
    return {
      verdict: 'bot',
      rule: `strong-direct:${artifact.category}:${artifact.artifactId}`,
      score: SEVERITY_SCORE.strong,
      displayScore,
    };
  }

  const mediumPlusCategories = categoryEvidence.filter(
    e => e.maxSeverity === 'medium' || e.maxSeverity === 'strong' || e.maxSeverity === 'hard'
  );
  const mediumCategories = categoryEvidence.filter(e => e.maxSeverity === 'medium');
  const weakCategories = categoryEvidence.filter(e => e.maxSeverity === 'weak');

  // 3. Two independent medium-or-strong categories.
  if (mediumPlusCategories.length >= 2) {
    return {
      verdict: 'bot',
      rule: `two-independent-medium-categories:${mediumPlusCategories.map(c => c.category).join(',')}`,
      score: 4,
      displayScore,
    };
  }

  // 4. One medium category plus at least two weak findings from independent
  //    categories (and those weak categories must not be the medium category).
  if (mediumCategories.length === 1) {
    const mediumCat = mediumCategories[0].category;
    const independentWeak = weakCategories.filter(w => w.category !== mediumCat);
    if (independentWeak.length >= 2) {
      return {
        verdict: 'bot',
        rule: `medium-plus-weak:${mediumCat}+${independentWeak.map(w => w.category).join(',')}`,
        score: 3,
        displayScore,
      };
    }
  }

  // 5. Weak findings from several independent categories corroborate.
  if (weakCategories.length >= 3) {
    return {
      verdict: 'bot',
      rule: `weak-corroboration:${weakCategories.map(w => w.category).join(',')}`,
      score: 2,
      displayScore,
    };
  }

  // 6. Unknown / reduced detection coverage when critical checks are inconclusive.
  //    This is checked BEFORE the suspicious branch so an inconclusive critical
  //    detector is not obscured by a weaker unrelated finding.
  const criticalInconclusive = allFindings.filter(
    f => f.critical && f.status === 'inconclusive'
  ).length;
  if (criticalInconclusive > 0) {
    return {
      verdict: 'unknown',
      rule: 'critical-inconclusive',
      score: 0,
      displayScore,
    };
  }

  // 7. Suspicious: at least one independent finding but not enough for bot.
  if (mediumPlusCategories.length === 1 || weakCategories.length >= 1 || displayScore >= 0.5) {
    return {
      verdict: 'suspicious',
      rule: `single-category-suspicious:${categoryEvidence.map(c => c.category).join(',') || 'none'}`,
      score: displayScore,
      displayScore: displayScore,
    };
  }

  // 8. No evidence of automation.
  return {
    verdict: 'human',
    rule: 'no-automation-evidence',
    score: 0,
    displayScore,
  };
}

function computeRisk(
  verdict: 'human' | 'suspicious' | 'bot' | 'unknown',
  scoredArtifacts: DetectionResult[],
  displayScore: number
): DetectionRisk {
  const evidence = scoredArtifacts.filter(a => a.status === 'finding' && a.severity !== 'info');
  const hasHard = evidence.some(a => a.severity === 'hard');

  if (verdict === 'bot') {
    // Confirmed is reserved for hard-automation evidence; other bot verdicts are high risk.
    return hasHard ? 'confirmed' : 'high';
  }

  if (evidence.length > 0 || displayScore >= 0.5) {
    return 'medium';
  }

  return 'low';
}

function computeConfidence(displayScore: number, coverage: number): number {
  // Confidence that the (risk, coverage) tuple is accurate. Full coverage with no
  // evidence is considered high confidence; strong evidence partially compensates
  // for reduced coverage but the formula is deliberately conservative.
  const evidenceConfidence = Math.min(1, displayScore / SEVERITY_SCORE.hard);
  return Math.round((coverage + (1 - coverage) * evidenceConfidence) * 100) / 100;
}

/**
 * Build per-detector test view from the raw map and the flat findings list.
 */
function buildTests(
  rawResults: DetectorResults,
  findings: DetectionResult[]
): Record<string, NormalizedTestResult> {
  const byDetector = new Map<string, DetectionResult[]>();
  for (const f of findings) {
    const id = f.detectorId ?? 'unknown';
    const list = byDetector.get(id) ?? [];
    list.push(f);
    byDetector.set(id, list);
  }

  const tests: Record<string, NormalizedTestResult> = {};
  for (const [detectorId, raw] of Object.entries(rawResults)) {
    const detectorFindings = byDetector.get(detectorId) ?? [];
    const finding = detectorFindings.find(f => f.status === 'finding') ??
      detectorFindings.find(f => f.status === 'inconclusive') ??
      detectorFindings[0];

    const status = finding?.status ?? 'passed';
    const passed = status === 'passed';

    // Use the most severe result for the per-detector display; if all passed,
    // the helper status is 'info'.
    let severity: DetectionSeverity = finding?.severity ?? 'info';
    if (status === 'passed') severity = 'info';

    const scoreContribution = detectorFindings
      .filter(f => f.status === 'finding' && f.severity !== 'info')
      .reduce((sum, f) => sum + SEVERITY_SCORE[f.severity], 0);

    tests[detectorId] = {
      status,
      passed,
      severity,
      category: finding?.category,
      artifactId: finding?.artifactId,
      context: finding?.context,
      countsAsIndicator: status === 'finding' && severity !== 'info',
      scoreContribution,
      value: raw,
      description: (finding?.description) ?? null,
      findings: detectorFindings,
    };
  }

  return tests;
}

/**
 * Summarize normalized detection results into a scoring result.
 *
 * `rawResults` preserves the legacy per-detector map for JSON/debug output.
 * `findings` is the flat list of structured results emitted by the runner.
 */
export function summarizeResults(
  rawResults: DetectorResults,
  findings: DetectionResult[]
): ScoringResult {
  const scoredArtifacts = deduplicateArtifacts(findings);
  const categoryEvidence = collectCategoryEvidence(scoredArtifacts);

  const { verdict, rule, score, displayScore } = decideVerdict(scoredArtifacts, findings, categoryEvidence);

  const counts = {
    info: 0,
    weak: 0,
    medium: 0,
    strong: 0,
    hard: 0,
  };
  let passedCount = 0;
  let findingCount = 0;
  let inconclusiveCount = 0;

  for (const f of findings) {
    if (f.status === 'passed') {
      passedCount++;
      counts.info++;
    } else if (f.status === 'inconclusive') {
      inconclusiveCount++;
      counts.info++;
    } else {
      findingCount++;
      counts[f.severity]++;
    }
  }

  const criticalResults = findings.filter(f => f.critical);
  const criticalTotal = criticalResults.length;
  const criticalInconclusive = criticalResults.filter(f => f.status === 'inconclusive').length;
  const criticalCompleted = criticalTotal - criticalInconclusive;
  const coverageRatio = criticalTotal > 0 ? criticalCompleted / criticalTotal : 1;
  const coverage = Math.round(coverageRatio * 100) / 100;

  const uniqueEvidenceCount = scoredArtifacts.filter(
    a => a.status === 'finding' && a.severity !== 'info'
  ).length;
  const independentCategoryCount = categoryEvidence.length;

  const risk = computeRisk(verdict, scoredArtifacts, displayScore);
  const confidence = computeConfidence(displayScore, coverage);

  const summary: DetectorSummary = {
    totalTests: Object.keys(rawResults).length,
    passed: passedCount,
    finding: findingCount,
    inconclusive: inconclusiveCount,
    infoFindings: counts.info,
    weakFindings: counts.weak,
    mediumFindings: counts.medium,
    strongFindings: counts.strong,
    hardFindings: counts.hard,
    score,
    verdict,
    risk,
    confidence,
    botDetected: verdict === 'bot',
    suspicious: verdict === 'suspicious',
    coverage: Math.round(coverageRatio * 100),
    criticalChecksTotal: criticalTotal,
    criticalChecksCompleted: criticalCompleted,
    criticalChecksInconclusive: criticalInconclusive,
    uniqueEvidenceCount,
    independentCategoryCount,
    verdictRule: rule,
  };

  let statusClass: string;
  let statusText: string;
  if (verdict === 'bot') {
    statusClass = 'bot';
    statusText = `${risk.toUpperCase()} BOT (score: ${score}, coverage: ${Math.round(coverageRatio * 100)}%)`;
  } else if (verdict === 'suspicious') {
    statusClass = 'pending';
    statusText = `${risk.toUpperCase()} RISK / ${Math.round(coverageRatio * 100)}% COVERAGE (score: ${score})`;
  } else if (verdict === 'unknown') {
    statusClass = 'pending';
    statusText = `${risk.toUpperCase()} RISK / ${Math.round(coverageRatio * 100)}% COVERAGE (reduced coverage)`;
  } else {
    statusClass = 'human';
    statusText = `${risk.toUpperCase()} RISK / ${Math.round(coverageRatio * 100)}% COVERAGE — no automation detected`;
  }

  return {
    tests: buildTests(rawResults, findings),
    findings,
    scoredArtifacts,
    summary,
    uiStatus: { statusClass, statusText },
  };
}
