/**
 * UI rendering helpers for detector results
 */
import type { RawDetectorValue, UIStatus } from './detector-types';

export interface ResultElementOptions {
  label: string;
  value: RawDetectorValue;
  isBoolean?: boolean;
  details?: unknown;
  showLikelySource?: boolean;
}

/**
 * Create a result item element for the UI
 * Supports: PASSED, FAILED (WEAK, MEDIUM, STRONG), INCONCLUSIVE
 */
export function createResultElement(
  label: string,
  value: RawDetectorValue,
  isBoolean = true,
  details: unknown = null,
  showLikelySource = false
): HTMLElement {
  const div = document.createElement('div');
  div.className = 'result-item';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'label';
  labelSpan.textContent = label;

  // Determine status from raw value and details
  const detailsObj = details && typeof details === 'object' ? details : null;
  const isInconclusive = !isBoolean && detailsObj && (detailsObj as Record<string, unknown>).inconclusive === true;

  // Special case: stack trace source — only fail when automation source is confirmed
  const isStackTraceDevTools = showLikelySource && detailsObj && (detailsObj as Record<string, string>).likelySource === 'devtools';

  const isFailed = isStackTraceDevTools
    ? false
    : (!isInconclusive && (isBoolean ? value === true : (value !== false && value !== null && value !== undefined)));

  // Determine display label based on severity info in details
  let displayLabel: string;
  let displayClass: string;

  if (isInconclusive) {
    displayLabel = 'INCONCLUSIVE';
    displayClass = 'inconclusive';
  } else if (isFailed) {
    let sev = 'strong';
    if (detailsObj) {
      const d = detailsObj as Record<string, unknown>;
      if (d.severity && typeof d.severity === 'string') {
        sev = d.severity.toLowerCase();
      } else if (d.weak === true) {
        sev = 'weak';
      }
    }
    // Map severity to display
    if (sev === 'weak') {
      displayLabel = 'WEAK';
      displayClass = 'weak';
    } else if (sev === 'medium') {
      displayLabel = 'MEDIUM';
      displayClass = 'medium';
    } else {
      displayLabel = 'STRONG';
      displayClass = 'strong';
    }
  } else {
    displayLabel = 'NO';
    displayClass = 'false';
  }

  const valueSpan = document.createElement('span');
  valueSpan.className = `value ${displayClass}`;
  valueSpan.textContent = displayLabel;

  div.appendChild(labelSpan);
  div.appendChild(valueSpan);

  // Add details tooltip for failed or inconclusive tests
  if ((isFailed || isInconclusive) && details) {
    const detailsSpan = document.createElement('span');
    detailsSpan.className = 'result-details';

    let detailsText = '';

    // Special handling for isAutomatedViaStackTrace - show likelySource prominently
    if (showLikelySource && detailsObj && (detailsObj as Record<string, string>).likelySource) {
      detailsText = `[${(detailsObj as Record<string, string>).likelySource.toUpperCase()}] `;
    }

    if (typeof details === 'object' && details !== null) {
      const d = details as Record<string, unknown>;
      if (d.description && typeof d.description === 'string') {
        detailsText += d.description;
      } else if (d.reason && typeof d.reason === 'string') {
        detailsText += `Reason: ${d.reason}`;
        if (d.message && typeof d.message === 'string') {
          detailsText += ` (${d.message})`;
        }
      } else {
        detailsText += JSON.stringify(details).slice(0, 100);
      }
    } else {
      detailsText += String(details);
    }

    detailsSpan.textContent = detailsText;
    detailsSpan.title = detailsText;
    div.appendChild(detailsSpan);
    div.classList.add('has-details');
  }

  return div;
}

/**
 * Show loading state in a container
 */
export function showLoading(container: HTMLElement): void {
  container.innerHTML = '<div class="loading"><span class="spinner"></span>Running detection tests...</div>';
}

/**
 * Update the overall status badge in the UI
 */
export function updateOverallStatus(uiStatus: UIStatus, containerId = 'overall-status'): void {
  const statusContainer = document.getElementById(containerId);
  if (!statusContainer) return;

  statusContainer.textContent = '';
  const badge = document.createElement('span');
  badge.className = `status-badge ${uiStatus.statusClass}`;
  badge.textContent = uiStatus.statusText;
  statusContainer.appendChild(badge);
}
