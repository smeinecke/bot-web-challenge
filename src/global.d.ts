/**
 * Global type declarations for browser APIs that may not be fully typed
 */

interface Navigator {
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>;
    platform?: string;
    mobile?: boolean;
  };
  webdriver?: boolean;
}

interface Window {
  [key: string]: unknown;
}

interface Error {
  prepareStackTrace?: (...args: unknown[]) => unknown;
}
