import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { ShareSelectors } from '../../support/selectors';

const { When, Then } = createBdd();

// The publish / unpublish / editor steps used by the comments scenarios are
// shared global steps defined in publish-custom-url.steps.ts and
// editor-editing.steps.ts.

When('I turn the comments toggle on', async ({ page }) => {
  const toggle = ShareSelectors.publishCommentsSwitch(page);

  await expect(toggle).toBeVisible({ timeout: 10000 });

  if (!(await toggle.isChecked())) {
    // The MUI Switch input is overlaid on the track; force the click so the
    // visually-hidden checkbox receives it reliably.
    await toggle.click({ force: true });
  }

  await expect(toggle).toBeChecked({ timeout: 10000 });
  // Allow the updatePublishConfig round-trip to persist before moving on.
  await page.waitForTimeout(1500);
});

Then('the comments toggle is off', async ({ page }) => {
  const toggle = ShareSelectors.publishCommentsSwitch(page);

  await expect(toggle).toBeVisible({ timeout: 10000 });
  await expect(toggle).not.toBeChecked({ timeout: 10000 });
});

Then('the comments toggle is on', async ({ page }) => {
  const toggle = ShareSelectors.publishCommentsSwitch(page);

  await expect(toggle).toBeVisible({ timeout: 10000 });
  await expect(toggle).toBeChecked({ timeout: 10000 });
});
