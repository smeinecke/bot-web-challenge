/**
 * Detector result type definitions
 *
 * This module defines the canonical structured result model used by all
 * detectors. The old boolean/truthy convention is still accepted through the
 * compatibility adapter in `detector-registry.ts`, but every detector should
 * migrate toward emitting `DetectionResult` (or `DetectionResult[]`) directly.
 */

export type DetectionStatus = 'passed' | 'finding' | 'inconclusive' | 'not-applicable';

export type DetectionSeverity = 'info' | 'weak' | 'medium' | 'strong' | 'hard';

export type DetectionContext = 'main' | 'iframe' | 'blob-iframe' | 'worker' | 'interaction';

export type DetectionCategory =
  | 'webdriver'
  | 'cdp'
  | 'automation-global'
  | 'browser-integrity'
  | 'fingerprint'
  | 'permissions'
  | 'interaction'
  | 'environment'
  | 'api-integrity'
  | 'worker'
  | 'other';

export type DetectionVerdict = 'human' | 'suspicious' | 'bot' | 'unknown';

export type VerdictImpact = 'corroborating' | 'standalone';

/**
 * Structured evidence. Must NOT contain keyboard characters, input values,
 * passwords, clipboard contents, KeyboardEvent.key, or KeyboardEvent.code.
 */
export interface DetectionEvidence {
  [key: string]: unknown;
}

/**
 * Canonical detector result.
 */
export interface DetectionResult {
  /** Whether this check passed, found something, could not complete, or does not apply to this environment/mode. */
  status: DetectionStatus;

  /** Severity of the finding. `passed` results should use `info` severity. */
  severity: DetectionSeverity;

  /** Logical category for evidence-fusion scoring. */
  category: DetectionCategory;

  /**
   * Stable artifact identifier. Two results with the same `artifactId` and
   * `context` are considered the same scored evidence and must not be counted
   * twice.
   */
  artifactId: string;

  /** Realm/context where the artifact was observed. */
  context: DetectionContext;

  /** Short machine-readable reason code. */
  reason: string;

  /** Human-readable description. */
  description: string;

  /**
   * Whether this finding is decisive on its own (`standalone`) or must be
   * combined with other evidence (`corroborating`).
   */
  verdictImpact?: VerdictImpact;

  /** Optional 0-1 confidence. */
  confidence?: number;

  /** Structured, non-sensitive evidence. */
  evidence?: DetectionEvidence;

  /** Original raw value from a legacy detector, kept for debug output only. */
  raw?: unknown;

  /** ID of the detector that emitted this result (filled by the runner). */
  detectorId?: string;

  /** When an artifact is reported by several detectors, all their IDs are listed here. */
  detectorIds?: string[];

  /** Whether this detector is considered critical for coverage. */
  critical?: boolean;
}

/**
 * Raw object finding from legacy detectors.
 */
export interface RawObjectFinding {
  reason?: string;
  description?: string;
  weak?: boolean;
  severity?: DetectionSeverity | string;
  category?: DetectionCategory | string;
  inconclusive?: boolean;
  confidence?: number | string;
  evidence?: DetectionEvidence;
  findings?: DetectionResult[];
  [key: string]: unknown;
}

export type RawDetectorValue =
  | false
  | null
  | undefined
  | true
  | RawObjectFinding
  | DetectionResult
  | DetectionResult[];

/**
 * Legacy page-level results map. Still used to expose raw observations to the
 * UI and JSON export while the scoring engine consumes normalized
 * `DetectionResult[]`.
 */
export type DetectorResults = Record<string, RawDetectorValue>;

export interface DetectorSummary {
  totalTests: number;
  passed: number;
  finding: number;
  inconclusive: number;
  notApplicable: number;
  infoFindings: number;
  weakFindings: number;
  mediumFindings: number;
  strongFindings: number;
  hardFindings: number;
  score: number;
  verdict: DetectionVerdict;
  /** Legacy boolean for consumers that expect `botDetected`. */
  botDetected: boolean;
  /** Legacy boolean for consumers that expect `suspicious`. */
  suspicious: boolean;
  /** 0-100 coverage percentage of critical checks that completed. */
  coverage: number;
  criticalChecksTotal: number;
  criticalChecksCompleted: number;
  criticalChecksInconclusive: number;
  criticalChecksNotApplicable: number;
  /** Number of unique scored artifacts. */
  uniqueEvidenceCount: number;
  /** Number of independent categories represented in scored artifacts. */
  independentCategoryCount: number;

  /** Human-readable rule that produced the final verdict. */
  verdictRule: string;
}

export interface NormalizedTestResult {
  status: DetectionStatus;
  passed: boolean;
  severity: DetectionSeverity;
  category?: DetectionCategory;
  artifactId?: string;
  context?: DetectionContext;
  countsAsIndicator: boolean;
  scoreContribution: number;
  value: RawDetectorValue;
  description: string | null;
  findings?: DetectionResult[];
}

export interface UIStatus {
  statusClass: string;
  statusText: string;
}

export interface ScoringResult {
  tests: Record<string, NormalizedTestResult>;
  /** All structured findings, including duplicates across detectors. */
  findings: DetectionResult[];
  /** Deduplicated artifacts that actually contributed to the score. */
  scoredArtifacts: DetectionResult[];
  summary: DetectorSummary;
  uiStatus: UIStatus;
}

/** Helper: a passed detector result. */
export function pass(
  category: DetectionCategory,
  artifactId: string,
  context: DetectionContext,
  reason = 'no-finding',
  description = 'No anomaly detected',
  evidence?: DetectionEvidence
): DetectionResult {
  return {
    status: 'passed',
    severity: 'info',
    category,
    artifactId,
    context,
    reason,
    description,
    evidence,
  };
}

/** Helper: a not-applicable result for detectors that cannot run in this environment/mode. */
export function notApplicable(
  category: DetectionCategory,
  artifactId: string,
  context: DetectionContext,
  reason: string,
  description: string,
  evidence?: DetectionEvidence
): DetectionResult {
  return {
    status: 'not-applicable',
    severity: 'info',
    category,
    artifactId,
    context,
    reason,
    description,
    evidence,
  };
}

/** Helper: a finding with explicit severity. */
export function finding(
  severity: DetectionSeverity,
  category: DetectionCategory,
  artifactId: string,
  context: DetectionContext,
  reason: string,
  description: string,
  evidence?: DetectionEvidence,
  confidence?: number,
  verdictImpact?: VerdictImpact
): DetectionResult {
  return {
    status: 'finding',
    severity,
    category,
    artifactId,
    context,
    reason,
    description,
    verdictImpact: verdictImpact ?? 'corroborating',
    evidence,
    confidence,
  };
}

/** Helper: an inconclusive result. */
export function inconclusive(
  category: DetectionCategory,
  artifactId: string,
  context: DetectionContext,
  reason: string,
  description: string,
  evidence?: DetectionEvidence
): DetectionResult {
  return {
    status: 'inconclusive',
    severity: 'info',
    category,
    artifactId,
    context,
    reason,
    description,
    evidence,
  };
}
