import { defineConfig, devices } from '@playwright/test';

/**
 * Opt-in screenshot gallery for the workspace permission UI (Web PR #621). It seeds a synthetic
 * "Demo" workspace through the APIs of an isolated loopback stack; see
 * playwright/e2e/app/permission-gallery.capture.spec.ts for the required variables.
 */
export default defineConfig({
  testDir: './playwright/e2e/app',
  testMatch: ['permission-gallery.capture.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 300000,
  reporter: 'list',
  outputDir: process.env.APPFLOWY_GALLERY_RESULTS_DIR ?? `test-results/permission-gallery-${Date.now()}`,
  use: {
    baseURL: process.env.BASE_URL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
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
      deviceScaleFactor: 1,
      launchOptions: {
        executablePath: process.env.APPFLOWY_TEST_CHROMIUM_EXECUTABLE,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
      },
    },
  }],
  expect: { timeout: 30000 },
});
