import { defineConfig, devices } from '@playwright/test';

import base from './playwright.config';

export default defineConfig(base, {
  testDir: './playwright/e2e/integrations',
  // Each worker starts Vite; keep the local default as small as the CI default.
  workers: 1,
  use: {
    ...base.use,
    bypassCSP: false,
    permissions: [],
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-math-dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' }, testMatch: '**/math-equation.spec.ts' },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: '**/connections.spec.ts' },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: '**/connections.spec.ts' },
  ],
});
