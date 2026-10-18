import { defineConfig, devices } from '@playwright/test';

import { galleryLaunchOptions } from './playwright/support/permission-gallery-browser';

/**
 * Opt-in screenshot gallery and videos of the workspace permission UI (Web PR #621). Both seed a
 * synthetic "Demo" workspace through the APIs of an isolated loopback stack; see
 * playwright/e2e/app/permission-gallery.capture.spec.ts for the required variables, and
 * permission-videos.capture.spec.ts for the videos (which also need APPFLOWY_PERMISSION_VIDEOS=1).
 */
export default defineConfig({
  testDir: './playwright/e2e/app',
  testMatch: ['permission-gallery.capture.spec.ts', 'permission-videos.capture.spec.ts'],
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
      // The gallery's Chromium and flags, shared with the video spec (see the helper).
      launchOptions: galleryLaunchOptions(),
    },
  }],
  expect: { timeout: 30000 },
});
