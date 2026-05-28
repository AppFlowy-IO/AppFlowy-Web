import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { EditorSelectors, ShareSelectors } from '../../support/selectors';

const { When } = createBdd();

// Keyed by page so parallel scenarios never share a published URL.
const publishedUrlByPage = new WeakMap<Page, string>();

When('I publish the current page', async ({ page }) => {
  // Give Yjs time to flush the freshly typed content to the server before publishing.
  await page.waitForTimeout(2000);

  // Open the share popover. Evaluate-click bypasses the sticky header overlay that
  // otherwise intercepts pointer events on the share button.
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
  await ShareSelectors.shareButton(page).evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(1000);

  // Switch to the Publish tab and confirm publishing.
  await ShareSelectors.sharePopover(page).getByText('Publish', { exact: true }).click({ force: true });
  await page.waitForTimeout(1000);
  await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible({ timeout: 10000 });
  await expect(ShareSelectors.publishConfirmButton(page)).toBeEnabled();
  await ShareSelectors.publishConfirmButton(page).click({ force: true });
  await page.waitForTimeout(5000);

  // Build the published URL from the namespace + publish name shown in the popover.
  await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 10000 });
  const origin = new URL(page.url()).origin;
  const namespace = ((await ShareSelectors.publishNamespace(page).textContent()) ?? '').trim();
  const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();

  expect(namespace, 'Expected a publish namespace').not.toBe('');
  expect(publishName, 'Expected a publish name').not.toBe('');

  publishedUrlByPage.set(page, `${origin}/${namespace}/${publishName}`);

  // Close the popover so it does not overlap the published view navigation.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
});

When('I open the published page', async ({ page }) => {
  const publishedUrl = publishedUrlByPage.get(page);

  expect(publishedUrl, 'Expected the page to be published before opening it').toBeTruthy();

  await page.goto(publishedUrl as string);
  await expect(page).toHaveURL(new RegExp(new URL(publishedUrl as string).pathname), { timeout: 15000 });
  await expect(EditorSelectors.firstEditor(page)).toBeVisible({ timeout: 15000 });
  // Let the static editor finish hydrating the published document.
  await page.waitForTimeout(2000);
});
