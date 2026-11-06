import { defineConfig, devices } from '@playwright/test';

/**
 * The config of `capture.spec.ts`, which regenerates this directory's screenshots (README.md).
 * No other Playwright config reaches this directory (`playwright.config.ts` runs
 * `playwright/e2e`, the BDD config runs `playwright/bdd/features`), so the capture never runs in
 * CI or in the e2e suites; it runs only with `-c` and this file.
 *
 * It names no default stack: BASE_URL must point at the disposable stack to capture.
 */
const baseURL = process.env.BASE_URL;

if (!baseURL) {
  throw new Error('Set BASE_URL to the Web origin of the stack to capture (see README.md)');
}

export default defineConfig({
  testDir: '.',
  testMatch: 'capture.spec.ts',
  outputDir: '../../../../test-results/mcp-connect-flow-capture',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  // One serial journey: two sign-ins, three switches of AI apps and a 30-second policy wait.
  timeout: 10 * 60 * 1000,
  expect: { timeout: 15000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    headless: true,
    viewport: { width: 1360, height: 900 },
    deviceScaleFactor: 1,
    // Settings → MCP copies the server URL.
    permissions: ['clipboard-read', 'clipboard-write'],
    actionTimeout: 15000,
    navigationTimeout: 30000,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
