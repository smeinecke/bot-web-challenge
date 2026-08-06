/**
 * Interactions detector page
 */
import {
  getAllDetectors,
  runDetectors,
  summarizeResults,
  renderResults,
  buildJSONOutput,
  setJSONTextContent,
  resetWorkerTestsCache,
  startTracking,
  resetTracking,
  tracking,
  type TrackingState,
  type DetectorResults,
} from '../shared';

function onFormSubmit(e: Event): void {
  e.preventDefault();
  tracking.submitTime = Date.now();
  analyzeAndShowResults();

  const resultsCard = document.getElementById('results-card');
  if (resultsCard) {
    resultsCard.style.display = 'block';
    setTimeout(() => {
      resultsCard.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }
}

async function analyzeAndShowResults(): Promise<void> {
  const container = document.getElementById('interaction-results');
  if (container) {
    container.innerHTML = '<div class="loading"><span class="spinner"></span>Analyzing interactions...</div>';
  }

  setTimeout(async () => {
    const { rawResults, findings } = await runDetectors(getAllDetectors());
    const scoring = summarizeResults(rawResults, findings);

    if (container) {
      renderResults(scoring, container);
      addTrackingStats(container);
    }

    (window as unknown as Record<string, DetectorResults>).lastInteractionResults = rawResults;
    (window as unknown as Record<string, unknown>).lastInteractionScoring = scoring;
  }, 100);
}

function addTrackingStats(container: HTMLElement): void {
  const statsDiv = document.createElement('div');
  statsDiv.className = 'info-section';
  const heading = document.createElement('h3');
  heading.textContent = 'Tracking Statistics';
  const ul = document.createElement('ul');
  const stats = [
    `Mouse events: ${tracking.mouseEvents.length}`,
    `Key events: ${tracking.keyEvents.length}`,
    `Input events: ${tracking.inputEvents.length}`,
    `Mouse path length: ${Math.round(tracking.mousePathLength)} px`,
    `Total keystrokes: ${tracking.totalKeystrokes}`,
    `Form completion time: ${tracking.submitTime && tracking.firstFocusTime ?
      (tracking.submitTime - tracking.firstFocusTime) + ' ms' : 'N/A'}`
  ];
  stats.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
  });
  statsDiv.appendChild(heading);
  statsDiv.appendChild(ul);
  container.appendChild(statsDiv);
}

let originalWebdriverDescriptor: PropertyDescriptor | undefined;
let simulationActive = false;

async function simulateBotMode(): Promise<void> {
  if (!simulationActive) {
    originalWebdriverDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
    simulationActive = true;
  }

  Object.defineProperty(navigator, 'webdriver', {
    get: () => true,
    configurable: true,
  });
  (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_ = {};

  resetWorkerTestsCache();

  const emailField = document.getElementById('email') as HTMLInputElement | null;
  const passwordField = document.getElementById('password') as HTMLInputElement | null;

  if (emailField) {
    emailField.value = 'test@example.com';
    emailField.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (passwordField) {
    passwordField.value = 'password123';
    passwordField.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const now = Date.now();
  tracking.totalKeystrokes = 25;
  tracking.firstFocusTime = now - 200;
  tracking.submitTime = now;
  tracking.formStartTime = now - 500;
  tracking.hasTrustedFocus = true;
  tracking.hasUntrustedEvent = true;
  tracking.clicksAtZero = 1;
  tracking.clicksAtExactCenter = 3;

  for (let i = 0; i < 50; i++) {
    tracking.mouseEvents.push({
      type: 'move',
      x: 100 + i * 5,
      y: 200,
      screenX: 100 + i * 5,
      screenY: 200,
      time: now - (50 - i) * 16,
      screenMismatch: true,
      isTrusted: false,
    });
    tracking.cdpLeakChecks.push({
      suspicious: true,
      reason: 'simulated_cdp_mouse_leak',
      confidence: 'medium',
      description: 'Simulated CDP screen coordinate leak',
    });
  }

  tracking.mouseEvents.push({ type: 'down', x: 0, y: 0, isTrusted: false, time: now } as Record<string, unknown>);
  tracking.mouseEvents.push({ type: 'down', x: 0, y: 0, isTrusted: false, time: now + 1 } as Record<string, unknown>);
  tracking.mouseEvents.push({ type: 'down', x: 0, y: 0, isTrusted: false, time: now + 2 } as Record<string, unknown>);

  analyzeAndShowResults();
}

function restoreBotMode(): void {
  if (originalWebdriverDescriptor) {
    Object.defineProperty(navigator, 'webdriver', originalWebdriverDescriptor);
  } else {
    delete ((navigator as unknown) as Record<string, unknown>).webdriver;
  }

  delete (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_;
  resetWorkerTestsCache();
  simulationActive = false;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    startTracking();
    const form = document.getElementById('login-form');
    form?.addEventListener('submit', onFormSubmit);
  });
} else {
  startTracking();
  const form = document.getElementById('login-form');
  form?.addEventListener('submit', onFormSubmit);
}

(window as unknown as Record<string, unknown>).toggleBotMode = () => {
  const checkbox = document.getElementById('simulate-bot') as HTMLInputElement | null;
  if (checkbox?.checked) {
    simulateBotMode();
  } else {
    restoreBotMode();
    resetTracking();
    const container = document.getElementById('interaction-results');
    if (container) container.innerHTML = '';
    (window as unknown as Record<string, DetectorResults | null>).lastInteractionResults = null;
    (window as unknown as Record<string, unknown | null>).lastInteractionScoring = null;
    const resultsCard = document.getElementById('results-card');
    if (resultsCard) resultsCard.style.display = 'none';
  }
};

(window as unknown as Record<string, () => void>).showJSONOutput = () => {
  const scoring = (window as unknown as Record<string, ReturnType<typeof summarizeResults> | undefined>).lastInteractionScoring;
  if (!scoring) {
    alert('Please submit the form first to generate results.');
    return;
  }

  let jsonDiv = document.getElementById('json-output');
  if (!jsonDiv) {
    jsonDiv = document.createElement('div');
    jsonDiv.id = 'json-output';
    jsonDiv.className = 'card';
    (jsonDiv as HTMLElement).style.marginTop = '1rem';
    const container = document.querySelector('.container');
    container?.appendChild(jsonDiv);
  }

  const json = buildJSONOutput(scoring, {
    mouseEvents: tracking.mouseEvents.length,
    keyEvents: tracking.keyEvents.length,
    inputEvents: tracking.inputEvents.length,
    mousePathLength: Math.round(tracking.mousePathLength),
    totalKeystrokes: tracking.totalKeystrokes,
    formCompletionTime: tracking.submitTime && tracking.firstFocusTime ?
      tracking.submitTime - tracking.firstFocusTime : null,
  });

  jsonDiv.innerHTML = `
    <h3>JSON Output (for FlareSolverr integration)</h3>
    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.75rem; max-height: 400px; overflow-y: auto;"><code></code></pre>
  `;
  const code = jsonDiv.querySelector('code');
  if (code) {
    setJSONTextContent(code as HTMLElement, json);
  }
  jsonDiv.scrollIntoView({ behavior: 'smooth' });
};

(window as unknown as Record<string, () => void>).copyJSON = () => {
  const scoring = (window as unknown as Record<string, ReturnType<typeof summarizeResults> | undefined>).lastInteractionScoring;
  if (!scoring) {
    alert('Please submit the form first.');
    return;
  }
  const json = buildJSONOutput(scoring, {
    mouseEvents: tracking.mouseEvents.length,
    keyEvents: tracking.keyEvents.length,
    inputEvents: tracking.inputEvents.length,
    mousePathLength: Math.round(tracking.mousePathLength),
    totalKeystrokes: tracking.totalKeystrokes,
    formCompletionTime: tracking.submitTime && tracking.firstFocusTime ?
      tracking.submitTime - tracking.firstFocusTime : null,
  });
  navigator.clipboard.writeText(JSON.stringify(json, null, 2)).then(() => {
    alert('JSON copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
};

(window as unknown as Record<string, unknown>).InteractionDetector = {
  start: startTracking,
  reset: resetTracking,
  analyze: analyzeAndShowResults,
  simulateBot: simulateBotMode,
  getTrackingData: (): TrackingState => tracking,
};
