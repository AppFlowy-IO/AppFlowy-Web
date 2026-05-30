import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { ShareSelectors } from '../../support/selectors';

const { When, Then } = createBdd();

// Ensures the share popover is open and the Publish tab is selected. Safe to call
// whether the popover is currently closed or already showing the publish panel.
async function ensurePublishPanelOpen(page: Page) {
  const popover = ShareSelectors.sharePopover(page);

  if (!(await popover.isVisible().catch(() => false))) {
    // Evaluate-click bypasses the sticky header overlay that intercepts pointer events.
    await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
    await ShareSelectors.shareButton(page).evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(1000);
  }

  const publishTab = popover.getByText('Publish', { exact: true });

  if (await publishTab.isVisible().catch(() => false)) {
    await publishTab.click({ force: true });
    await page.waitForTimeout(500);
  }
}

When('I publish the page from the share panel', async ({ page }) => {
  // Give Yjs time to flush freshly typed content to the server before publishing.
  await page.waitForTimeout(2000);

  await ensurePublishPanelOpen(page);

  const confirm = ShareSelectors.publishConfirmButton(page);

  await expect(confirm).toBeVisible({ timeout: 15000 });
  // The publish button is disabled while share details (re)load — wait for it to enable.
  await expect
    .poll(async () => confirm.isEnabled().catch(() => false), {
      timeout: 30000,
      message: 'Expected the publish button to become enabled',
    })
    .toBe(true);
  await confirm.click();

  // Wait for the publish round-trip and the link preview (with the name input) to render.
  await expect(ShareSelectors.publishNameInput(page)).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1000);
});

When('I change the publish path name to {string}', async ({ page }, name: string) => {
  const input = ShareSelectors.publishNameInput(page);

  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(name);
  // Enter commits the new name (PublishLinkPreview saves on Enter / blur).
  await input.press('Enter');
  await page.waitForTimeout(2500);
});

When('I unpublish the page from the share panel', async ({ page }) => {
  await ensurePublishPanelOpen(page);

  await expect(ShareSelectors.unpublishButton(page)).toBeVisible({ timeout: 10000 });
  await ShareSelectors.unpublishButton(page).click({ force: true });

  // Some flows show a confirmation dialog before unpublishing.
  const confirm = ShareSelectors.confirmUnpublishButton(page);

  if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirm.click({ force: true });
  }

  // After unpublishing, the panel returns to the unpublished state with the publish button.
  await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible({ timeout: 30000 });
});

Then('the publish path name is {string}', async ({ page }, expectedName: string) => {
  await expect(ShareSelectors.publishNameInput(page)).toBeVisible({ timeout: 10000 });
  await expect
    .poll(async () => (await ShareSelectors.publishNameInput(page).inputValue()).trim(), {
      timeout: 15000,
      message: `Expected the publish path name to remain "${expectedName}" after republishing`,
    })
    .toBe(expectedName);
});
