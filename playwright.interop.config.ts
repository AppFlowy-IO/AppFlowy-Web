import { defineConfig } from '@playwright/test';

import base from './playwright.config';

const origin = process.env.APPFLOWY_INTEROP_WEB_URL || 'http://127.0.0.1:3089';

export default defineConfig({
  ...base,
  testDir: './playwright/interop',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240000,
  use: { ...base.use, baseURL: origin, trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${new URL(origin).port || 3089} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
