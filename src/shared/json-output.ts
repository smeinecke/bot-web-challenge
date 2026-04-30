/**
 * JSON output generation module
 */
import { BUILD_INFO } from './build-info';
import { summarizeResults } from './scoring';
import type { DetectorResults } from './detector-types';

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
  tests: Record<string, {
    status: string;
    passed: boolean;
    severity: string;
    description?: string | null;
    value: unknown;
  }>;
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    inconclusive: number;
    score: number;
    botDetected: boolean;
    suspicious: boolean;
    indicatorCount: number;
  };
  trackingStats?: unknown;
}

/**
 * Prepare JSON output for detector results
 * Uses textContent for safe rendering (not innerHTML)
 */
export function prepareJSONOutput(results: DetectorResults, trackingStats?: unknown): JSONOutput {
  const { tests, summary } = summarizeResults(results);

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
    tests,
    summary: {
      totalTests: summary.totalTests,
      passed: summary.passed,
      failed: summary.failed,
      inconclusive: summary.inconclusive,
      score: summary.score,
      botDetected: summary.botDetected,
      suspicious: summary.suspicious,
      indicatorCount: summary.indicatorCount,
    },
    ...(trackingStats !== undefined ? { trackingStats } : {}),
  };
}

/**
 * Safely set textContent on an element
 * Never uses innerHTML to prevent XSS
 */
export function setJSONTextContent(element: HTMLElement, json: unknown): void {
  element.textContent = JSON.stringify(json, null, 2);
}
