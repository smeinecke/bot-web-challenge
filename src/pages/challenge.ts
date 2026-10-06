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

function updateChallengeCard(container: HTMLElement): void {
  container.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = 'Challenge Mode';

  const desc = document.createElement('p');
  desc.textContent = 'A randomized, nonce-bound detector plan is generated for each attempt. Individual detector results are hidden until the challenge completes.';

  const button = document.createElement('button');
  button.id = 'start-challenge';
  button.className = 'btn-primary';
  button.textContent = 'Start Challenge';
  button.addEventListener('click', startChallenge);

  container.appendChild(heading);
  container.appendChild(desc);
  container.appendChild(button);
}

async function startChallenge(): Promise<void> {
  const container = document.getElementById('challenge-results');
  const button = document.getElementById('start-challenge') as HTMLButtonElement | null;
  if (button) button.disabled = true;

  if (!container) return;
  showLoading(container);
  resetWorkerTestsCache();

  // A fresh nonce-bound plan is generated at the start of every attempt; the
  // nonce is disclosed only once the attempt has a plan to bind to.
  currentPlan = buildChallengePlan(getStaticDetectors(), 'challenge', {
    seed: generateChallengeNonce(),
  });

  try {
    const { rawResults, findings } = await runDetectors(currentPlan.detectors);
    const scoring = summarizeResults(rawResults, findings);
    currentResult = { plan: currentPlan, scoring };
    renderChallengeSummary(container);
  } catch (e) {
    updateChallengeCard(container);
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
  const nonceStrong = document.createElement('strong');
  nonceStrong.textContent = 'Nonce: ';
  const nonceCode = document.createElement('code');
  nonceCode.textContent = plan.nonce;
  nonceP.appendChild(nonceStrong);
  nonceP.appendChild(nonceCode);
  card.appendChild(nonceP);

  const resultTable = document.createElement('table');
  resultTable.className = 'challenge-summary';
  const rows: Array<[string, string, string?]> = [
    ['Risk', scoring.summary.risk.toUpperCase(), `risk-${scoring.summary.risk}`],
    ['Coverage', `${scoring.summary.coverage}%`],
    ['Confidence', `${(scoring.summary.confidence * 100).toFixed(0)}%`],
    ['Verdict', scoring.summary.verdict],
    ['Rule', scoring.summary.verdictRule],
  ];
  for (const [label, value, tdClass] of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = label;
    const td = document.createElement('td');
    if (tdClass) td.className = tdClass;
    td.textContent = value;
    tr.appendChild(th);
    tr.appendChild(td);
    resultTable.appendChild(tr);
  }
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
  note.textContent = 'In Challenge mode, individual detector results and raw observations are not exposed. See the static analysis page for full debugging output.';
  card.appendChild(note);

  const again = document.createElement('button');
  again.id = 'start-challenge';
  again.className = 'btn-primary';
  again.textContent = 'Start New Challenge';
  again.addEventListener('click', () => {
    currentResult = null;
    currentPlan = null;
    updateChallengeCard(container);
  });
  card.appendChild(again);

  container.appendChild(card);
}

function init(): void {
  const container = document.getElementById('challenge-results');
  if (!container) return;
  updateChallengeCard(container);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
