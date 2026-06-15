import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createNamedDocumentPage } from '../../support/duplicate-test-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, Before } = createBdd();

type FavoriteState = {
  viewId: string;
};

const stateByPage = new WeakMap<Page, FavoriteState>();

function requireState(page: Page): FavoriteState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Favorite test state was not initialized for this page');
  }

  return state;
}

const favoriteButton = (page: Page) => page.getByTestId('favorite-button');

// A favorited page renders as a Favorite-variant outline item, whose inner row
// id is `favorite-view-<viewId>`. Scoping by this id avoids matching the same
// page in the regular space list (which uses `app-view-<viewId>`).
const favoriteSectionItem = (page: Page, viewId: string) => page.locator(`#favorite-view-${viewId}`);

Before(async ({ page }) => {
  stateByPage.delete(page);
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

Given('I am signed in with a new account', async ({ page, request }) => {
  await signInAndWaitForApp(page, request, generateRandomEmail());
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
});

Given('I have created and opened a document page named {string}', async ({ page }, name: string) => {
  const viewId = await createNamedDocumentPage(page, name);

  stateByPage.set(page, { viewId });

  // Allow the rename to sync to the server so the favorites list reflects it.
  await page.waitForTimeout(1500);
  await expect(favoriteButton(page)).toBeVisible({ timeout: 15000 });
});

When('I click the header favorite button', async ({ page }) => {
  const button = favoriteButton(page);

  await expect(button).toBeEnabled({ timeout: 15000 });
  await button.click({ force: true });
  // The click fires an API round-trip then reloads the favorites list.
  await page.waitForTimeout(1500);
});

Then('the header favorite button is active', async ({ page }) => {
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
});

Then('the header favorite button is not active', async ({ page }) => {
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 });
});

Then('the Favorites section lists the page named {string}', async ({ page }, name: string) => {
  const { viewId } = requireState(page);
  const item = favoriteSectionItem(page, viewId);

  await expect(item).toBeVisible({ timeout: 15000 });
  await expect(item.getByTestId('page-name')).toHaveText(name, { timeout: 15000 });
});

Then('the Favorites section does not list the page', async ({ page }) => {
  const { viewId } = requireState(page);

  await expect(favoriteSectionItem(page, viewId)).toHaveCount(0, { timeout: 15000 });
});
