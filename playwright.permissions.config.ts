import { defineConfig, devices } from '@playwright/test';

// Explicit opt-in fixture; no setup, seeding, server start, or .env mutation.
export default defineConfig({
  testDir: './playwright/e2e/app',
  testMatch: ['space-group-permission-lifecycle.spec.ts', 'space-group-permission-boundaries.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 240000,
  reporter: 'list',
  outputDir: process.env.APPFLOWY_PERMISSION_OUTPUT_DIR ?? `test-results/permissions-${Date.now()}`,
  use: {
    baseURL: process.env.BASE_URL,
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 60000,
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1440, height: 900 },
      launchOptions: {
        executablePath: process.env.APPFLOWY_TEST_CHROMIUM_EXECUTABLE,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      },
    },
  }],
  expect: { timeout: 30000 },
});
