/**
 * Static fingerprinting detector page
 */
import {
  getStaticDetectors,
  runDetectors,
  summarizeResults,
  renderResults,
  showLoading,
  buildJSONOutput,
  setJSONTextContent,
  resetWorkerTestsCache,
  extractTimingMeasurements,
  type DetectorResults,
} from '../shared';

async function runStaticDetection() {
  const { rawResults, findings } = await runDetectors(getStaticDetectors());

  (rawResults as Record<string, unknown>)._debug = {
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    testCount: Object.keys(rawResults).length,
  };

  const scoring = summarizeResults(rawResults, findings);
  console.log('[BotDetector] Detection complete —', scoring.summary.totalTests, 'tests');
  return { rawResults, scoring };
}

function displayResults(scoring: ReturnType<typeof summarizeResults>, container: HTMLElement): void {
  renderResults(scoring, container);
}

async function init(): Promise<void> {
  const resultsContainer = document.getElementById('static-results');
  if (!resultsContainer) return;

  showLoading(resultsContainer);
  await new Promise(r => setTimeout(r, 100));

  try {
    const { rawResults, scoring } = await runStaticDetection();
    displayResults(scoring, resultsContainer);
    (window as unknown as Record<string, DetectorResults>).lastStaticResults = rawResults;
    (window as unknown as Record<string, unknown>).lastStaticScoring = scoring;
  } catch (e) {
    resultsContainer.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = `Error running detection: ${(e as Error).message}`;
    resultsContainer.appendChild(errorDiv);
  }
}

async function simulateBotMode(): Promise<void> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');

  Object.defineProperty(navigator, 'webdriver', {
    get: () => true,
    configurable: true,
  });
  (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_ = {};

  resetWorkerTestsCache();
  await init();

  if (originalDescriptor) {
    Object.defineProperty(navigator, 'webdriver', originalDescriptor);
  } else {
    delete ((navigator as unknown) as Record<string, unknown>).webdriver;
  }
  delete (window as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

(window as unknown as Record<string, unknown>).toggleBotMode = () => {
  const checkbox = document.getElementById('simulate-bot') as HTMLInputElement | null;
  if (checkbox?.checked) {
    simulateBotMode();
  } else {
    location.reload();
  }
};

(window as unknown as Record<string, () => void>).showJSONOutput = () => {
  const scoring = (window as unknown as Record<string, ReturnType<typeof summarizeResults> | undefined>).lastStaticScoring;
  if (!scoring) {
    alert('Results not ready yet. Please wait a moment.');
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

  const rawResults = (window as unknown as Record<string, DetectorResults>).lastStaticResults;
  const json = buildJSONOutput(scoring, undefined, extractTimingMeasurements(rawResults ?? {}));
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
  const scoring = (window as unknown as Record<string, ReturnType<typeof summarizeResults> | undefined>).lastStaticScoring;
  if (!scoring) {
    alert('Results not ready yet.');
    return;
  }
  const rawResults = (window as unknown as Record<string, DetectorResults>).lastStaticResults;
  const json = buildJSONOutput(scoring, undefined, extractTimingMeasurements(rawResults ?? {}));
  navigator.clipboard.writeText(JSON.stringify(json, null, 2)).then(() => {
    alert('JSON copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
};

(window as unknown as Record<string, unknown>).StaticDetector = {
  run: init,
  simulateBot: simulateBotMode,
};
