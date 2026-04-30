/**
 * Detector result type definitions
 */

export type DetectionStatus = 'passed' | 'failed' | 'inconclusive';
export type DetectionSeverity = 'info' | 'weak' | 'medium' | 'strong';

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

export interface DetectionFinding {
  status: DetectionStatus;
  severity: DetectionSeverity;
  category: DetectionCategory;
  reason?: string;
  description?: string;
  confidence?: number;
  evidence?: Record<string, unknown>;
  countsAsIndicator: boolean;
  scoreContribution: number;
}

export interface RawObjectFinding {
  reason?: string;
  description?: string;
  weak?: boolean;
  severity?: DetectionSeverity | string;
  category?: DetectionCategory | string;
  inconclusive?: boolean;
  confidence?: number | string;
  evidence?: Record<string, unknown>;
  [key: string]: unknown;
}

export type RawDetectorValue =
  | false
  | null
  | undefined
  | true
  | RawObjectFinding;

export type DetectorResults = Record<string, RawDetectorValue>;

export interface DetectorSummary {
  totalTests: number;
  passed: number;
  failed: number;
  inconclusive: number;
  weakFindings: number;
  mediumFindings: number;
  strongFindings: number;
  score: number;
  botDetected: boolean;
  suspicious: boolean;
  indicatorCount: number;
}

export interface NormalizedTestResult {
  status: DetectionStatus;
  passed: boolean;
  inconclusive?: boolean;
  severity: DetectionSeverity;
  countsAsIndicator?: boolean;
  value: RawDetectorValue;
  description: string | null;
}

export interface UIStatus {
  statusClass: string;
  statusText: string;
}

export interface ScoringResult {
  tests: Record<string, NormalizedTestResult>;
  summary: DetectorSummary;
  uiStatus: UIStatus;
}
