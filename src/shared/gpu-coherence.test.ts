import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkWebGLWebGPUCoherence } from './gpu-coherence';

describe('WebGL / WebGPU coherence', () => {
  let originalGetContext: unknown;
  let originalGPU: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalGPU = Object.getOwnPropertyDescriptor(navigator, 'gpu');
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext as any;
    if (originalGPU) {
      Object.defineProperty(navigator, 'gpu', originalGPU);
    } else {
      delete ((navigator as unknown as Record<string, unknown>).gpu);
    }
  });

  function fakeWebGLContext() {
    const UNMASKED_VENDOR_WEBGL = 0x9245;
    const UNMASKED_RENDERER_WEBGL = 0x9246;
    return {
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info'
          ? { UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL }
          : null,
      getParameter: (p: number) => {
        if (p === UNMASKED_VENDOR_WEBGL) return 'NVIDIA Corporation';
        if (p === UNMASKED_RENDERER_WEBGL) return 'GeForce RTX 4090';
        return null;
      },
    };
  }

  it('missing WebGPU is not bot evidence', async () => {
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === 'webgl' || type === 'experimental-webgl') return fakeWebGLContext();
      throw new Error('canvas not supported in this environment');
    } as any;
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });

    const result = await checkWebGLWebGPUCoherence();
    expect(result).toBe(false);
  });

  it('detects a physical WebGL GPU with a software WebGPU adapter', async () => {
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === 'webgl' || type === 'experimental-webgl') return fakeWebGLContext();
      throw new Error('canvas not supported in this environment');
    } as any;
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async () => ({
          info: {
            vendor: 'Google Inc.',
            architecture: 'SwiftShader',
            isFallbackAdapter: true,
          },
        }),
      },
    });

    const result = await checkWebGLWebGPUCoherence();
    expect(result).not.toBe(false);
    expect(result).not.toBe(null);
    if (result) {
      expect(result.status).toBe('finding');
      expect(result.artifactId).toBe('gpu:webgl-webgpu');
      expect(result.severity).toBe('medium');
    }
  });

  it('redacted or missing WebGPU adapter info is not suspicious', async () => {
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === 'webgl' || type === 'experimental-webgl') return fakeWebGLContext();
      throw new Error('canvas not supported in this environment');
    } as any;
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async () => ({ info: {} }),
      },
    });

    const result = await checkWebGLWebGPUCoherence();
    expect(result).toBe(false);
  });
});
