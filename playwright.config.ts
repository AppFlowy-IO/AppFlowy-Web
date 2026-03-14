import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export default defineConfig({
  testDir: './playwright/e2e',
  testMatch: '**/*.spec.ts',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Limit parallel workers on CI */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use */
  reporter: process.env.CI ? [['list'], ['html'], ['github']] : 'list',

  /* Global test timeout – E2E tests involve login + DB creation + interactions */
  timeout: 120000,

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: process.env.BASE_URL || 'http://localhost:3000',

    /* Viewport matching Cypress config */
    viewport: { width: 1440, height: 900 },

    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* No video by default (matching Cypress config) */
    video: 'off',

    /* Timeouts matching Cypress config */
    actionTimeout: 15000,
    navigationTimeout: 15000,

    /* Bypass CSP (equivalent to chromeWebSecurity: false) */
    bypassCSP: true,

    /* Grant clipboard permissions */
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  /* Configure projects for major browsers */
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
          ],
        },
      },
    },
  ],

  /* Expect configuration */
  expect: {
    timeout: 15000,
  },

  /* Run your local dev server before starting the tests */
  // Uncomment and configure if needed:
  // webServer: {
  //   command: 'pnpm dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
