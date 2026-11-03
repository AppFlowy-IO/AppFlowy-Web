import { defineConfig, devices } from '@playwright/test';

import base from './playwright.integrations.config';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/code-block*.spec.ts',
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  projects: [
    { name: 'chromium-light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'chromium-dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
  ],
});
