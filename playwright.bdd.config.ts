import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import { defineBddConfig } from 'playwright-bdd';

dotenv.config();

const testDir = defineBddConfig({
  features: 'playwright/bdd/features/**/*.feature',
  steps: 'playwright/bdd/steps/**/*.ts',
  outputDir: 'playwright/.features-gen',
  // Live GitHub imports need an explicitly configured, disposable destination.
  tags: 'not @github-sync-live',
});

function optInSuites(): RegExp | undefined {
  const skipped = [
    ...(process.env.RUN_LARGE_DATABASE ? [] : ['@large-database']),
    ...(process.env.RUN_NATHAN_EMPLOYEES ? [] : ['@nathan-employees']),
  ];

  return skipped.length > 0 ? new RegExp(skipped.join('|')) : undefined;
}

export default defineConfig({
  testDir,
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Opt-in suites: the 5000-row database takes minutes to seed (RUN_LARGE_DATABASE=1), and the
  // nathan@appflowy.io employees database only exists on a local server (RUN_NATHAN_EMPLOYEES=1).
  grepInvert: optInSuites(),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html'], ['github'], ['json', { outputFile: 'playwright-report/report.json' }]]
    : 'list',
  timeout: 120000,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15000,
    navigationTimeout: 15000,
    bypassCSP: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: [
            '--disable-gpu-sandbox',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--force-device-scale-factor=1',
            // Respondent contexts share the browser's trust in CI's localhost key.
            ...(process.env.APPFLOWY_TEST_TLS_SPKI
              ? [`--ignore-certificate-errors-spki-list=${process.env.APPFLOWY_TEST_TLS_SPKI}`]
              : []),
          ],
        },
      },
    },
  ],
  expect: {
    timeout: 15000,
  },
});
