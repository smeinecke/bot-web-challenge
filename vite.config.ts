import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { resolve } from 'path';

function safeExec(command: string): string {
  try {
    return execSync(command).toString().trim();
  } catch {
    return 'unknown';
  }
}

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const isGitHubPages = process.env.GITHUB_PAGES === 'true';

export default defineConfig({
  base: isGitHubPages && repoName ? `/${repoName}/` : '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        static: resolve(__dirname, 'static.html'),
        interactions: resolve(__dirname, 'interactions.html'),
      },
    },
  },
  define: {
    __APP_NAME__: JSON.stringify('bot-web-challenge'),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __SCHEMA_VERSION__: JSON.stringify(1),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(
      process.env.GITHUB_SHA?.slice(0, 7) || safeExec('git rev-parse --short HEAD')
    ),
    __GIT_BRANCH__: JSON.stringify(
      process.env.GITHUB_REF_NAME || safeExec('git rev-parse --abbrev-ref HEAD')
    ),
  },
});
