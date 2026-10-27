import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const executable = path.join(
  homedir(),
  'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);

// Playwright owns a fresh temporary profile. Never connect to an existing browser.
if (!process.env.CI && !existsSync(executable))
  throw new Error('An isolated Chrome for Testing installation is required.');
export default defineConfig({
  testDir: './playwright/e2e/integrations',
  testMatch: 'pdf.spec.ts',
  // Each theme owns its browser context and Vite worker. Run the two projects
  // together so browser installation does not consume the CI test budget.
  workers: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: { executablePath: process.env.CI ? undefined : executable },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'pdf-light', use: { colorScheme: 'light' } },
    { name: 'pdf-dark', use: { colorScheme: 'dark' } },
  ],
});
