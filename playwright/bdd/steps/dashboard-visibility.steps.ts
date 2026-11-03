import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { reprobePermissions } from '../../support/dashboard-platform-helpers';
import { DashboardSelectors } from '../../support/dashboard-test-helpers';

const { When } = createBdd();

/**
 * Returning to the browser tab re-probes the page's permissions, and the app
 * drops write access until the probe answers (AppBusinessLayer's
 * visibilitychange handler). A headless tab never hides, so the event alone
 * replays the return.
 */
When('I come back to the browser tab and the permissions are re-checked', async ({ page }) => {
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  await reprobePermissions(page);
  // Write access is back once the dashboard offers Edit or Done again.
  await expect(DashboardSelectors.editButton(page).or(DashboardSelectors.doneButton(page))).toBeVisible();
});
