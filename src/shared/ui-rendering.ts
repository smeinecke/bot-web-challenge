/**
 * UI rendering helpers for detector results
 */
import type { NormalizedTestResult, ScoringResult, UIStatus } from './detector-types';
import { TEST_DESCRIPTIONS } from './test-descriptions';

let modalContainer: HTMLElement | null = null;
let modalTitle: HTMLElement | null = null;
let modalBody: HTMLElement | null = null;

function ensureModal(): HTMLElement {
  if (modalContainer) return modalContainer;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'test-description-modal';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  const header = document.createElement('div');
  header.className = 'modal-header';

  modalTitle = document.createElement('h3');
  modalTitle.className = 'modal-title';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', closeModal);

  header.appendChild(modalTitle);
  header.appendChild(closeBtn);

  modalBody = document.createElement('div');
  modalBody.className = 'modal-body';

  dialog.appendChild(header);
  dialog.appendChild(modalBody);
  overlay.appendChild(dialog);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  document.body.appendChild(overlay);
  modalContainer = overlay;
  return overlay;
}

function openModal(title: string, body: string): void {
  const modal = ensureModal();
  if (modalTitle) modalTitle.textContent = title;
  if (modalBody) modalBody.textContent = body;
  modal.classList.add('visible');
}

function closeModal(): void {
  if (modalContainer) modalContainer.classList.remove('visible');
}

function displayLabelAndClass(severity: string, status: string): { label: string; cls: string } {
  if (status === 'inconclusive') return { label: 'INCONCLUSIVE', cls: 'inconclusive' };
  if (status === 'passed') return { label: 'NO', cls: 'false' };

  switch (severity) {
    case 'hard':
      return { label: 'HARD', cls: 'hard' };
    case 'strong':
      return { label: 'STRONG', cls: 'strong' };
    case 'medium':
      return { label: 'MEDIUM', cls: 'medium' };
    case 'weak':
      return { label: 'WEAK', cls: 'weak' };
    default:
      return { label: 'INFO', cls: 'inconclusive' };
  }
}

function renderDetails(result: NormalizedTestResult): string {
  if (result.findings && result.findings.length > 0) {
    return result.findings
      .filter(f => f.status !== 'passed')
      .map(f => f.description)
      .join('; ') || '';
  }
  if (result.description) return result.description;
  if (result.value && typeof result.value === 'object') {
    const v = result.value as Record<string, unknown>;
    if (typeof v.description === 'string') return v.description;
    if (typeof v.reason === 'string') {
      let text = `Reason: ${v.reason}`;
      if (typeof v.message === 'string') text += ` (${v.message})`;
      return text;
    }
    return JSON.stringify(result.value).slice(0, 120);
  }
  return String(result.value ?? '');
}

/**
 * Create a result item element from a normalized test result.
 *
 * The display severity is taken directly from the scoring result; the UI never
 * independently infers severity from raw values.
 */
export function createResultElement(label: string, result: NormalizedTestResult): HTMLElement {
  const div = document.createElement('div');
  div.className = 'result-item';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'label';
  labelSpan.textContent = label;

  const { label: displayLabel, cls: displayClass } = displayLabelAndClass(result.severity, result.status);

  const valueSpan = document.createElement('span');
  valueSpan.className = `value ${displayClass}`;
  valueSpan.textContent = displayLabel;

  const helpBtn = document.createElement('button');
  helpBtn.className = 'result-help-btn';
  helpBtn.setAttribute('aria-label', `What is ${label}?`);
  helpBtn.title = 'What does this test do?';
  helpBtn.textContent = '?';
  helpBtn.addEventListener('click', () => {
    const description = TEST_DESCRIPTIONS[label] || 'No detailed description available for this test.';
    openModal(label, description);
  });

  const labelWrap = document.createElement('span');
  labelWrap.className = 'result-label-wrap';
  labelWrap.appendChild(labelSpan);
  labelWrap.appendChild(helpBtn);

  div.appendChild(labelWrap);
  div.appendChild(valueSpan);

  if (result.status !== 'passed' && (result.description || result.findings)) {
    const detailsSpan = document.createElement('span');
    detailsSpan.className = 'result-details';
    detailsSpan.textContent = renderDetails(result);
    detailsSpan.title = detailsSpan.textContent;
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

/**
 * Render a full scoring result into a container.
 */
export function renderResults(scoring: ScoringResult, container: HTMLElement): void {
  container.innerHTML = '';

  const resultsGrid = document.createElement('div');
  resultsGrid.className = 'results-grid';

  for (const [name, result] of Object.entries(scoring.tests)) {
    resultsGrid.appendChild(createResultElement(name, result));
  }

  container.appendChild(resultsGrid);
  updateOverallStatus(scoring.uiStatus);
}
