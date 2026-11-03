import { chromium, defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright/e2e/presentation',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'list',
  outputDir: './test-results/presentation',
  use: {
    baseURL: 'http://127.0.0.1:5183',
    browserName: 'chromium',
    headless: true,
    // Playwright launches its own temporary profile; never attach to personal Chrome.
    launchOptions: { executablePath: chromium.executablePath() },
    viewport: { width: 1440, height: 1100 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node playwright/support/presentation-server.mjs',
    url: 'http://127.0.0.1:5183',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
