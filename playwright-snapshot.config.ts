import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Snapshot config: same as main config but with screenshots always captured.
 */
export default defineConfig({
  testDir: './playwright/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 120000,

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    screenshot: 'on',
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
          ],
        },
      },
    },
  ],

  expect: {
    timeout: 15000,
  },
});
