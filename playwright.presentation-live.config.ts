import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

import { livePresentationEnvironment } from './playwright/live-presentation/environment';

// Playwright's automatic failure snapshot is separate from trace/screenshots.
// Keep private page content and password controls out of error-context.md too.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
if (process.env.DEBUG) throw new Error('Unset DEBUG before the credential-bearing live presentation suite.');

const environment = livePresentationEnvironment();
const testDir = defineBddConfig({
  features: 'playwright/live-presentation/*.feature',
  steps: 'playwright/live-presentation/*.steps.ts',
  outputDir: 'test-results/presentation-live-generated',
});

/** Opt-in, real localhost services. This config never starts or seeds a backend. */
export default defineConfig({
  testDir,
  outputDir: 'test-results/presentation-live',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: 'list',
  timeout: 900_000,
  expect: { timeout: 30_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: environment.webOrigin,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    // Password login and private source content must never enter recordings.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
});
