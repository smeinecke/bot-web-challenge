/**
 * Centralized scoring module for detector results
 */
import type {
  DetectorResults,
  ScoringResult,
  DetectionSeverity,
  RawDetectorValue,
} from './detector-types';

// Severity weights for scoring
const SEVERITY_SCORE: Record<DetectionSeverity, number> = {
  info: 0,
  weak: 0.5,
  medium: 1,
  strong: 2,
};

// Thresholds
const BOT_DETECTED_THRESHOLD = 2;
const SUSPICIOUS_THRESHOLD = 0.5;

/**
 * Extract severity from a raw detector value
 * Respects explicit severity/weak flags in result objects
 */
function getSeverity(
  _name: string,
  value: RawDetectorValue,
  defaultSeverity: DetectionSeverity = 'medium'
): { severity: DetectionSeverity; weight: number } {
  // If value is an object, check for explicit severity/weak flags
  if (value && typeof value === 'object') {
    const sev = value.severity as unknown;
    if (typeof sev === 'string' && sev in SEVERITY_SCORE) {
      const typedSev = sev as DetectionSeverity;
      return { severity: typedSev, weight: SEVERITY_SCORE[typedSev] };
    }
    if (value.weak === true) {
      return { severity: 'weak', weight: 0.5 };
    }
  }

  // Fallback to default
  return { severity: defaultSeverity, weight: SEVERITY_SCORE[defaultSeverity] };
}

/**
 * Determine if a result is inconclusive
 */
function isInconclusive(value: RawDetectorValue): boolean {
  return value !== false && value !== null && value !== undefined &&
    typeof value === 'object' && value.inconclusive === true;
}

/**
 * Determine if a result is a failure
 * Inconclusive is NOT a failure
 */
function isFailed(value: RawDetectorValue): boolean {
  if (value === false || value === null || value === undefined) return false;
  if (isInconclusive(value)) return false;
  return true;
}

/**
 * Summarize detection results with proper scoring
 * Fixes issues:
 * - Inconclusive results don't count as failures
 * - Object-valued results are scored based on their severity/weak flags
 * - Proper indicator counting
 */
export function summarizeResults(results: DetectorResults): ScoringResult {
  const tests: ScoringResult['tests'] = {};
  let totalTests = 0;
  let passed = 0;
  let failed = 0;
  let inconclusiveCount = 0;
  let weakFindings = 0;
  let mediumFindings = 0;
  let strongFindings = 0;
  let score = 0;
  const indicatorDetails: Array<{ test: string; description: string; severity: string }> = [];

  function countIndicator(name: string, description: string, severity: DetectionSeverity, weight: number) {
    score += weight;
    indicatorDetails.push({ test: name, description, severity });
  }

  // Process each test result
  for (const [name, value] of Object.entries(results)) {
    // Skip internal/debug keys
    if (name.startsWith('_')) continue;

    const testInconclusive = isInconclusive(value);
    const testFailed = isFailed(value);
    const testPassed = !testFailed && !testInconclusive;

    // Determine severity from value or use defaults based on test name patterns
    let defaultSeverity: DetectionSeverity = 'medium';
    if (/^(hasBotUserAgent|isPlaywright|isPhantom|isNightmare|isSequentum|isSeleniumChromeDefault|hasWebdriverTrue|hasWebdriverInFrameTrue|isAutomatedWithCDP|isIframeOverridden|hasMissingBrowserChrome|hasAutomationGlobalsExtended|hasBlobIframeCDPIssue|isHeadlessChrome)$/.test(name)) {
      defaultSeverity = 'strong';
    } else if (/^(hasInconsistentClientHints|hasWebGLInconsistent|hasCDPMouseLeak|hasInconsistentGPUFeatures|hasHeadlessChromeDefaultScreenResolution|hasNavigatorIntegrityViolation|isAutomatedWithCDPInWebWorker|isAutomatedViaStackTrace|hasInconsistentChromeObject)$/.test(name)) {
      defaultSeverity = 'medium';
    } else if (/^(hasSuspiciousWeakSignals|hasCanvasAvailabilityIssue|hasAudioFingerprintIssue|hasScreenAvailabilityAnomaly|hasTouchInconsistency|hasPermissionsInconsistency|hasPluginsMimeTypesIssue|hasLocaleTimezoneIntlIssue|hasViewportScreenCoherenceIssue|hasHighHardwareConcurrency|suspiciousClientSideBehavior|superHumanSpeed|hasAdvancedBotSignals)$/.test(name)) {
      defaultSeverity = 'weak';
    }

    // Special case: stack trace detection - only count if likelySource is 'automation'
    if (name === 'isAutomatedViaStackTrace') {
      const obj = value && typeof value === 'object' ? value as Record<string, unknown> : null;
      const isAutomation = obj?.likelySource === 'automation';
      const severity: DetectionSeverity = isAutomation ? 'strong' : 'info';
      const weight = isAutomation ? 2 : 0;
      const desc = obj?.description as string | undefined;

      tests[name] = {
        status: isAutomation ? 'failed' : 'passed',
        passed: !isAutomation,
        severity,
        value,
        description: desc ?? null,
      };

      totalTests++;
      if (isAutomation) {
        failed++;
        strongFindings++;
        countIndicator(name, desc ?? 'Automation detected via stack trace', 'strong', weight);
      } else {
        passed++;
      }
      continue;
    }

    // Worker values: inconclusive results should be weak, not failures
    if (name === 'hasInconsistentWorkerValues' && testInconclusive) {
      tests[name] = {
        status: 'inconclusive',
        passed: false,
        inconclusive: true,
        severity: 'weak',
        value,
        description: (value && typeof value === 'object' && value.description) ? value.description : 'Worker test inconclusive',
      };
      totalTests++;
      inconclusiveCount++;
      // Inconclusive doesn't add to score
      continue;
    }

    // Special case: Chrome object inconsistency - can be weak or medium depending on reason
    if (name === 'hasInconsistentChromeObject' && testFailed && value && typeof value === 'object') {
      // chromeMissing is stronger (missing window.chrome on Chromium)
      // chromeShallow is weaker (has chrome but no expected subobjects)
      const specificSeverity: DetectionSeverity = value.reason === 'chromeMissing' ? 'medium' : 'weak';
      const weight = value.reason === 'chromeMissing' ? 1 : 0.5;

      tests[name] = {
        status: 'failed',
        passed: false,
        severity: specificSeverity,
        countsAsIndicator: true,
        value,
        description: value.description ?? null,
      };

      totalTests++;
      failed++;
      if (specificSeverity === 'weak') weakFindings++;
      else if (specificSeverity === 'medium') mediumFindings++;
      else if (specificSeverity === 'strong') strongFindings++;
      countIndicator(name, value.description ?? 'Chrome object inconsistent', specificSeverity, weight);
      continue;
    }

    const { severity, weight } = getSeverity(name, value, defaultSeverity);

    // Only count as indicator if it has significant weight and is failed
    const countsAsIndicator = testFailed && weight >= 0.5;

    tests[name] = {
      status: testInconclusive ? 'inconclusive' : testFailed ? 'failed' : 'passed',
      passed: testPassed,
      inconclusive: testInconclusive || undefined,
      severity,
      countsAsIndicator,
      value,
      description: (testFailed || testInconclusive) && value && typeof value === 'object' && value.description
        ? value.description
        : null,
    };

    totalTests++;
    if (testInconclusive) {
      inconclusiveCount++;
    } else if (testFailed) {
      failed++;
      if (severity === 'weak') weakFindings++;
      else if (severity === 'medium') mediumFindings++;
      else if (severity === 'strong') strongFindings++;
      if (countsAsIndicator) {
        const desc = value && typeof value === 'object' && value.description
          ? value.description
          : 'Detected';
        countIndicator(name, desc, severity, weight);
      }
    } else {
      passed++;
    }
  }

  const indicatorCount = indicatorDetails.length;
  const botDetected = score >= BOT_DETECTED_THRESHOLD;
  const suspicious = score >= SUSPICIOUS_THRESHOLD && score < BOT_DETECTED_THRESHOLD;

  const summary = {
    totalTests,
    passed,
    failed,
    inconclusive: inconclusiveCount,
    weakFindings,
    mediumFindings,
    strongFindings,
    score: Math.round(score * 10) / 10,
    botDetected,
    suspicious,
    indicatorCount,
  };

  let statusClass: string;
  let statusText: string;
  if (botDetected) {
    statusClass = 'bot';
    statusText = `BOT DETECTED (score: ${summary.score})`;
  } else if (suspicious) {
    statusClass = 'pending';
    statusText = `SUSPICIOUS (score: ${summary.score})`;
  } else {
    statusClass = 'human';
    statusText = 'HUMAN';
  }

  return { tests, summary, uiStatus: { statusClass, statusText } };
}
