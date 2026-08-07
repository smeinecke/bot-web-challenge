/**
 * Challenge mode page.
 *
 * This page runs a randomized, nonce-bound subset of detectors and reveals only
 * the fused (risk, coverage, confidence) summary after the attempt has
 * completed. It deliberately does not expose per-detector raw results, JSON
 * output, or debug globals while the challenge is in progress or after it ends.
 */
import {
  buildChallengePlan,
  buildChallengeToken,
  generateChallengeNonce,
  type ChallengePlan,
  type ChallengeResult,
} from '../shared/challenge';
import {
  getStaticDetectors,
  runDetectors,
  summarizeResults,
  showLoading,
  resetWorkerTestsCache,
} from '../shared';

let currentPlan: ChallengePlan | null = null;
let currentResult: ChallengeResult | null = null;

function nonceDisplay(): string {
  return currentPlan?.nonce ?? generateChallengeNonce();
}

function updateChallengeCard(container: HTMLElement): void {
  container.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = 'Challenge Mode';

  const desc = document.createElement('p');
  desc.textContent = 'A randomized, nonce-bound detector plan is generated for each attempt. Individual detector results are hidden until the challenge completes.';

  const nonceLabel = document.createElement('p');
  nonceLabel.innerHTML = `<strong>Challenge nonce:</strong> <code>${nonceDisplay()}</code>`;

  const button = document.createElement('button');
  button.id = 'start-challenge';
  button.className = 'btn-primary';
  button.textContent = 'Start Challenge';
  button.addEventListener('click', startChallenge);

  container.appendChild(heading);
  container.appendChild(desc);
  container.appendChild(nonceLabel);
  container.appendChild(button);
}

async function startChallenge(): Promise<void> {
  const container = document.getElementById('challenge-results');
  const button = document.getElementById('start-challenge') as HTMLButtonElement | null;
  if (button) button.disabled = true;

  if (!container) return;
  showLoading(container);
  resetWorkerTestsCache();

  // Re-roll the nonce at the start of every attempt.
  currentPlan = buildChallengePlan(getStaticDetectors(), 'challenge', {
    seed: generateChallengeNonce(),
  });

  try {
    const { rawResults, findings } = await runDetectors(currentPlan.detectors);
    const scoring = summarizeResults(rawResults, findings);
    currentResult = { plan: currentPlan, scoring };
    renderChallengeSummary(container);
  } catch (e) {
    container.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = `Challenge failed: ${(e as Error).message}`;
    container.appendChild(errorDiv);
  }
}

function renderChallengeSummary(container: HTMLElement): void {
  if (!currentResult) {
    updateChallengeCard(container);
    return;
  }

  const { plan, scoring } = currentResult;
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'card';

  const heading = document.createElement('h2');
  heading.textContent = 'Challenge Complete';
  card.appendChild(heading);

  const nonceP = document.createElement('p');
  nonceP.innerHTML = `<strong>Nonce:</strong> <code>${plan.nonce}</code>`;
  card.appendChild(nonceP);

  const resultTable = document.createElement('table');
  resultTable.className = 'challenge-summary';
  resultTable.innerHTML = `
    <tr><th>Risk</th><td class="risk-${scoring.summary.risk}">${scoring.summary.risk.toUpperCase()}</td></tr>
    <tr><th>Coverage</th><td>${scoring.summary.coverage}%</td></tr>
    <tr><th>Confidence</th><td>${(scoring.summary.confidence * 100).toFixed(0)}%</td></tr>
    <tr><th>Verdict</th><td>${scoring.summary.verdict}</td></tr>
    <tr><th>Rule</th><td>${scoring.summary.verdictRule}</td></tr>
  `;
  card.appendChild(resultTable);

  const tokenHeading = document.createElement('h3');
  tokenHeading.textContent = 'Verification Token';
  card.appendChild(tokenHeading);

  const tokenCode = document.createElement('pre');
  tokenCode.className = 'challenge-token';
  tokenCode.textContent = buildChallengeToken(currentResult);
  card.appendChild(tokenCode);

  const note = document.createElement('p');
  note.className = 'info-section';
  note.textContent = 'In Challenge mode, individual detector results and raw observations are not exposed. Use Lab mode for debugging.';
  card.appendChild(note);

  container.appendChild(card);
}

function init(): void {
  const container = document.getElementById('challenge-results');
  if (!container) return;
  currentPlan = buildChallengePlan(getStaticDetectors(), 'challenge', {
    seed: generateChallengeNonce(),
  });
  updateChallengeCard(container);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
