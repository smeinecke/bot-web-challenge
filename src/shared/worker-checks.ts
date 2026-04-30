/**
 * Web Worker based detection checks
 */
import type { DetectionSeverity } from './detector-types';

export interface WorkerResults {
  userAgent: string;
  webdriver: boolean;
  platform: string;
  hardwareConcurrency: number;
  languages: string[];
  hasCDP: boolean;
  webGLVendor: string;
  webGLRenderer: string;
  hasCDPWorker?: boolean;
  error?: string;
  timeout?: boolean;
  notSupported?: boolean;
}

let workerTestsPromise: Promise<WorkerResults> | null = null;

/**
 * Reset the worker tests cache
 */
export function resetWorkerTestsCache(): void {
  workerTestsPromise = null;
}

/**
 * Run Web Worker based tests (cached — runs at most once per page load)
 */
export function runWorkerTests(): Promise<WorkerResults> {
  if (workerTestsPromise) return workerTestsPromise;

  workerTestsPromise = new Promise((resolve) => {
    try {
      const workerCode = `
        self.onmessage = function(e) {
          const results = {
            userAgent: navigator.userAgent,
            webdriver: navigator.webdriver,
            platform: navigator.platform,
            hardwareConcurrency: navigator.hardwareConcurrency,
            languages: navigator.languages,
            hasCDP: false,
            webGLVendor: 'NA',
            webGLRenderer: 'NA'
          };

          // Check for CDP in worker
          const cdpMarkers = ['__cdp_eval', '__cdp_js_executor', '__selenium_eval'];
          for (const marker of cdpMarkers) {
            if (typeof self[marker] !== 'undefined') {
              results.hasCDP = true;
              break;
            }
          }

          // CDP detection via Error.prepareStackTrace side-effect trap
          try {
            let wasAccessed = false;
            const origPST = Error.prepareStackTrace;
            Error.prepareStackTrace = function() {
              wasAccessed = true;
              return typeof origPST === 'function' ? origPST.apply(this, arguments) : undefined;
            };
            const probe = new Error('');
            console.log(probe);
            Error.prepareStackTrace = origPST;
            results.hasCDPWorker = wasAccessed;
          } catch(_) {}

          // WebGL in worker via OffscreenCanvas
          try {
            const canvas = new OffscreenCanvas(1, 1);
            const gl = canvas.getContext('webgl');
            if (gl) {
              const ext = gl.getExtension('WEBGL_debug_renderer_info');
              if (ext) {
                results.webGLVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
                results.webGLRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
              }
            }
          } catch (_) {}

          self.postMessage(results);
        };
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const worker = new Worker(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const timeoutId = setTimeout(() => {
        worker.terminate();
        resolve({ timeout: true } as WorkerResults);
      }, 2000);

      worker.onmessage = function(e) {
        clearTimeout(timeoutId);
        worker.terminate();
        resolve(e.data as WorkerResults);
      };

      worker.onerror = function(e) {
        clearTimeout(timeoutId);
        worker.terminate();
        resolve({ error: e.message } as WorkerResults);
      };

      worker.postMessage('start');
    } catch (e) {
      const err = e as Error;
      resolve({ error: err.message, notSupported: true } as WorkerResults);
    }
  });

  return workerTestsPromise;
}

/**
 * Compare main context vs worker context values
 * Returns inconclusive status for worker errors/timeouts
 */
export async function checkInconsistentWorkerValues(): Promise<Record<string, unknown> | false> {
  const workerData = await runWorkerTests();

  if (workerData.error) {
    return {
      reason: 'workerError',
      inconclusive: true,
      severity: 'weak' as DetectionSeverity,
      message: workerData.error,
      description: 'Web Worker failed to execute — inconclusive, may be browser restrictions'
    };
  }

  if (workerData.notSupported) {
    return false;
  }

  if (workerData.timeout) {
    return {
      reason: 'workerTimeout',
      inconclusive: true,
      severity: 'weak' as DetectionSeverity,
      description: 'Web Worker timed out — inconclusive, may be browser restrictions or slow device'
    };
  }

  const inconsistencies: string[] = [];
  const details: Record<string, { main: unknown; worker: unknown }> = {};

  if (workerData.userAgent !== navigator.userAgent) {
    inconsistencies.push('userAgent');
    details.userAgent = { main: navigator.userAgent.slice(0, 50) + '...', worker: workerData.userAgent.slice(0, 50) + '...' };
  }

  const mainWebdriver = navigator.webdriver === true;
  const workerWebdriver = workerData.webdriver === true;
  if (mainWebdriver !== workerWebdriver) {
    inconsistencies.push('webdriver');
    details.webdriver = { main: navigator.webdriver, worker: workerData.webdriver };
  }

  if (workerData.platform !== navigator.platform) {
    inconsistencies.push('platform');
    details.platform = { main: navigator.platform, worker: workerData.platform };
  }

  if (workerData.hardwareConcurrency !== navigator.hardwareConcurrency) {
    inconsistencies.push('hardwareConcurrency');
    details.hardwareConcurrency = { main: navigator.hardwareConcurrency, worker: workerData.hardwareConcurrency };
  }

  if (workerData.webGLVendor && workerData.webGLVendor !== 'NA') {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        const mainVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
        const mainRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        if (mainVendor !== workerData.webGLVendor || mainRenderer !== workerData.webGLRenderer) {
          inconsistencies.push('webGL');
          details.webGL = { main: `${mainVendor}/${mainRenderer}`, worker: `${workerData.webGLVendor}/${workerData.webGLRenderer}` };
        }
      }
    } catch {}
  }

  if (inconsistencies.length > 0) {
    return {
      inconsistencies,
      details,
      description: `Worker context differs in: ${inconsistencies.join(', ')} - indicates environment spoofing`
    };
  }

  return false;
}

/**
 * Check CDP in Web Worker — combines marker check and prepareStackTrace trap
 * Returns structured findings with severity based on detection source
 */
export async function checkAutomatedWithCDPInWorker(): Promise<Record<string, unknown> | false> {
  const workerData = await runWorkerTests();

  if (workerData.error || workerData.timeout || workerData.notSupported) {
    return false;
  }

  if (workerData.hasCDP === true || workerData.hasCDPWorker === true) {
    const reason = workerData.hasCDP ? 'workerCDPMarker' : 'workerStackTraceSideEffect';
    const severity: DetectionSeverity = workerData.hasCDP ? 'strong' : 'medium';
    const description = workerData.hasCDP
      ? 'CDP marker found in worker context'
      : 'Worker Error.prepareStackTrace side effect suggests CDP inspection';

    return { reason, severity, category: 'cdp', description };
  }

  return false;
}
