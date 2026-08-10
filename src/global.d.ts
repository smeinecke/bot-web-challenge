/**
 * Global type declarations for browser APIs that may not be fully typed
 */

interface NavigatorUAData {
  brands?: Array<{ brand: string; version: string }>;
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?(hints: string[]): Promise<Record<string, unknown>>;
}

interface Navigator {
  userAgentData?: NavigatorUAData;
  webdriver?: boolean | null;
  gpu?: GPU;
}

interface GPUAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
}

interface GPUAdapter {
  info: GPUAdapterInfo;
}

interface GPU {
  requestAdapter(): Promise<GPUAdapter | null>;
}

interface Window {
  [key: string]: unknown;
}

interface Error {
  prepareStackTrace?: (...args: unknown[]) => unknown;
}
