import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { ShareSelectors } from '../../support/selectors';

const { When, Then } = createBdd();
const publishedPageByEditorPage = new WeakMap<Page, Page>();

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

When('I turn the comments toggle off', async ({ page }) => {
  const toggle = ShareSelectors.publishCommentsSwitch(page);

  await expect(toggle).toBeVisible({ timeout: 10000 });

  if (await toggle.isChecked()) {
    await toggle.click({ force: true });
  }

  await expect(toggle).not.toBeChecked({ timeout: 10000 });
  await page.waitForTimeout(1500);
});

When('I close and reopen the publish panel', async ({ page }) => {
  const popover = ShareSelectors.sharePopover(page);

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden({ timeout: 10000 });

  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
  await ShareSelectors.shareButton(page).evaluate((element: HTMLElement) => element.click());
  await expect(popover).toBeVisible({ timeout: 10000 });

  const publishTab = popover.getByTestId('publish-tab');

  if (await publishTab.isVisible().catch(() => false)) {
    await publishTab.click({ force: true });
  }

  await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible({ timeout: 10000 });
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

When('I open the published page in another tab', async ({ page }) => {
  const popupPromise = page.waitForEvent('popup');

  await expect(ShareSelectors.visitSiteButton(page)).toBeVisible({ timeout: 10000 });
  await ShareSelectors.visitSiteButton(page).click({ force: true });

  const publishedPage = await popupPromise;

  await publishedPage.waitForLoadState('domcontentloaded');
  publishedPageByEditorPage.set(page, publishedPage);
});

Then('the published comment panel is visible', async ({ page }) => {
  const publishedPage = publishedPageByEditorPage.get(page);

  expect(publishedPage, 'Expected the published page to be open in another tab').toBeTruthy();
  await expect(publishedPage!.getByTestId('global-comment')).toBeVisible({ timeout: 30000 });
});

Then('the published comment panel is hidden', async ({ page }) => {
  const publishedPage = publishedPageByEditorPage.get(page);

  expect(publishedPage, 'Expected the published page to be open in another tab').toBeTruthy();
  await expect(publishedPage!.getByTestId('global-comment')).toBeHidden({ timeout: 30000 });
});
