/**
 * WebGL / WebGPU adapter coherence.
 *
 * This module is intentionally isolated so that future changes to WebGPU
 * support (adapter info shape, fallback markers, etc.) can be adjusted without
 * touching the rest of the detection pipeline.
 */
import { finding, inconclusive, type DetectionResult } from './detector-types';

const SOFTWARE_RENDERERS = ['SwiftShader', 'llvmpipe', 'software', 'Google SwiftShader'];

interface WebGLRendererInfo {
  vendor?: string;
  renderer?: string;
}

function getWebGLUnmaskedInfo(): WebGLRendererInfo | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;

    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return null;

    const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string | null;
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string | null;
    return { vendor: vendor ?? undefined, renderer: renderer ?? undefined };
  } catch {
    return null;
  }
}

function looksLikePhysicalGPU(info: WebGLRendererInfo): boolean {
  if (!info.vendor || !info.renderer) return false;
  const text = `${info.vendor} ${info.renderer}`.toLowerCase();
  return !SOFTWARE_RENDERERS.some((s) => text.includes(s.toLowerCase()));
}

function looksLikeSoftwareAdapter(info: GPUAdapterInfo): boolean {
  if (info.isFallbackAdapter === true) return true;
  const text = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.device ?? ''} ${info.description ?? ''}`.toLowerCase();
  return SOFTWARE_RENDERERS.some((s) => text.includes(s.toLowerCase())) || text.includes('fallback');
}

/**
 * Request a WebGPU adapter and compare its reported info with the unmasked
 * WebGL vendor/renderer.
 *
 * Only a clear contradiction is reported: WebGL claims a physical GPU while
 * WebGPU explicitly identifies a software/fallback adapter. Missing or redacted
 * WebGPU information is never treated as suspicious.
 */
export async function checkWebGLWebGPUCoherence(): Promise<DetectionResult | false | null> {
  try {
    if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') {
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter || !adapter.info) {
      return false;
    }

    const webglInfo = getWebGLUnmaskedInfo();
    if (!webglInfo || !webglInfo.vendor || !webglInfo.renderer) {
      // WebGL info is missing/redacted, so no meaningful comparison is possible.
      return false;
    }

    const gpuInfo = adapter.info;
    const hasGpuInfo = gpuInfo.vendor || gpuInfo.architecture || gpuInfo.device || gpuInfo.description || gpuInfo.isFallbackAdapter === true;
    if (!hasGpuInfo) {
      return false;
    }

    const webglPhysical = looksLikePhysicalGPU(webglInfo);
    const webgpuSoftware = looksLikeSoftwareAdapter(gpuInfo);

    if (webglPhysical && webgpuSoftware) {
      return finding(
        'medium',
        'fingerprint',
        'gpu:webgl-webgpu',
        'main',
        'webgl-physical-webgpu-software',
        'WebGL reports a physical GPU while WebGPU identifies a software/fallback adapter',
        { webgl: webglInfo, webgpu: gpuInfo }
      );
    }

    return false;
  } catch (e) {
    return inconclusive(
      'fingerprint',
      'gpu:webgl-webgpu',
      'main',
      'webgpu-inspection-error',
      `WebGL/WebGPU coherence check failed: ${(e as Error).message}`
    );
  }
}
