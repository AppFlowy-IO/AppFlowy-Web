import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { DashboardSelectors } from '../../support/dashboard-test-helpers';

const { When } = createBdd();

const PERMISSION_PROBE_URL = /\/api\/workspace\/[^/]+\/collab\/[^/]+\/permission(?:\?|$)/;

/**
 * Returning to the browser tab re-probes the page's permissions, and the app
 * drops write access until the probe answers (AppBusinessLayer's
 * visibilitychange handler). A headless tab never hides, so the event alone
 * replays the return.
 */
When('I come back to the browser tab and the permissions are re-checked', async ({ page }) => {
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  const reprobe = page.waitForResponse(
    (response) => response.request().method() === 'GET' && PERMISSION_PROBE_URL.test(response.url())
  );

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const response = await reprobe;

  // The server's HTTP cache answers a repeated probe with 304 Not Modified.
  expect(response.ok() || response.status() === 304).toBe(true);
  // Write access is back once the dashboard offers Edit or Done again.
  await expect(DashboardSelectors.editButton(page).or(DashboardSelectors.doneButton(page))).toBeVisible();
});
