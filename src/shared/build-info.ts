/**
 * Build information module
 * Constants are injected at build time by Vite
 */

declare const __APP_NAME__: string;
declare const __APP_VERSION__: string;
declare const __SCHEMA_VERSION__: number;
declare const __BUILD_TIME__: string;
declare const __GIT_COMMIT__: string;
declare const __GIT_BRANCH__: string;

export const BUILD_INFO = {
  name: __APP_NAME__,
  version: __APP_VERSION__,
  schemaVersion: __SCHEMA_VERSION__,
  buildTime: __BUILD_TIME__,
  gitCommit: __GIT_COMMIT__,
  gitBranch: __GIT_BRANCH__,
} as const;
