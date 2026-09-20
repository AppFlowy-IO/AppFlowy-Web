import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import { defineBddConfig } from 'playwright-bdd';

dotenv.config();

const testDir = defineBddConfig({
  features: 'playwright/bdd/features/integrations/github-sync.feature',
  steps: 'playwright/bdd/steps/github-sync.steps.ts',
  outputDir: 'playwright/.features-gen-github-sync',
});

// A real import owns its configured destination. Retrying against that same space
// would exercise reopening an existing binding instead of initial setup.
export default defineConfig({
  testDir,
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 600_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/github-sync', open: 'never' }]],
  outputDir: 'test-results/github-sync',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    bypassCSP: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
        launchOptions: {
          args: [
            '--disable-gpu-sandbox',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            ...(process.env.APPFLOWY_TEST_TLS_SPKI
              ? [`--ignore-certificate-errors-spki-list=${process.env.APPFLOWY_TEST_TLS_SPKI}`]
              : []),
          ],
        },
      },
    },
  ],
  expect: { timeout: 15_000 },
});
