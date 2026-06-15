import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import * as dotenv from 'dotenv';

dotenv.config();

const testDir = defineBddConfig({
  features: 'playwright/bdd/features/**/*.feature',
  steps: 'playwright/bdd/steps/**/*.ts',
  outputDir: 'playwright/.features-gen',
});

export default defineConfig({
  testDir,
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
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
          args: ['--disable-gpu-sandbox', '--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
        },
      },
    },
  ],
  expect: {
    timeout: 15000,
  },
});
