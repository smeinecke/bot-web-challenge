/**
 * JSON output generation module
 */
import { BUILD_INFO } from './build-info';
import type { DetectorSummary, ScoringResult } from './detector-types';
import type { TimingMeasurements } from './timing-checks';

export interface JSONOutput {
  detector: {
    name: string;
    version: string;
    schemaVersion: number;
    buildTime: string;
    gitCommit: string;
    gitBranch: string;
  };
  timestamp: string;
  userAgent: string;
  url: string;
  tests: ScoringResult['tests'];
  findings: ScoringResult['findings'];
  scoredArtifacts: ScoringResult['scoredArtifacts'];
  summary: DetectorSummary;
  trackingStats?: unknown;
  timing?: TimingMeasurements;
}

/**
 * Build the full JSON output from a scoring result.
 */
export function buildJSONOutput(
  scoring: ScoringResult,
  trackingStats?: unknown,
  timingMeasurements?: TimingMeasurements
): JSONOutput {
  return {
    detector: {
      name: BUILD_INFO.name,
      version: BUILD_INFO.version,
      schemaVersion: BUILD_INFO.schemaVersion,
      buildTime: BUILD_INFO.buildTime,
      gitCommit: BUILD_INFO.gitCommit,
      gitBranch: BUILD_INFO.gitBranch,
    },
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: window.location.href,
    tests: scoring.tests,
    findings: scoring.findings,
    scoredArtifacts: scoring.scoredArtifacts,
    summary: scoring.summary,
    ...(trackingStats !== undefined ? { trackingStats } : {}),
    ...(timingMeasurements ? { timing: timingMeasurements } : {}),
  };
}

/**
 * Safely set textContent on an element
 * Never uses innerHTML to prevent XSS
 */
export function setJSONTextContent(element: HTMLElement, json: unknown): void {
  element.textContent = JSON.stringify(json, null, 2);
}
