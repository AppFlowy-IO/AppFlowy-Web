import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { createDocumentPageAndNavigate, expandSpaceByName } from '../../support/page-utils';
import { DatabaseViewSelectors, ModalSelectors, PageSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const { Given, When, Then } = createBdd();

const SPACE_NAME = 'General';
const DATABASE_NAME = 'New Database';

async function tabLabels(page: Page): Promise<string[]> {
  const labels = await DatabaseViewSelectors.viewTab(page).allInnerTexts();

  return labels.map((label) => label.trim());
}

Given('a grid database is open for view tab order testing', async ({ page, request }) => {
  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Grid', {
    verify: async (p) => {
      await expect(p.locator('[class*="appflowy-database"]')).toBeVisible({ timeout: 15000 });
      await expect(DatabaseViewSelectors.viewTab(p).first()).toBeVisible({ timeout: 10000 });
    },
  });
  await waitForGridReady(page);
});

When('I add a {string} view from the database tab bar', async ({ page }, viewType: string) => {
  // Let the tab bar settle before interacting; a click during the re-render
  // caused by a previous view creation can be swallowed.
  await page.waitForTimeout(1000);

  const previousCount = await DatabaseViewSelectors.viewTab(page).count();
  const addButton = DatabaseViewSelectors.addViewButton(page);

  await addButton.scrollIntoViewIfNeeded();
  await expect(addButton).toBeVisible({ timeout: 5000 });
  await addButton.click();
  await page.waitForTimeout(500);

  const menu = page.locator('[data-slot="dropdown-menu-content"]');

  await expect(menu).toBeVisible({ timeout: 5000 });
  const menuItem = menu.locator('[role="menuitem"]').filter({ hasText: viewType }).first();

  await expect(menuItem).toBeVisible({ timeout: 5000 });
  await menuItem.click({ force: true });
  await page.waitForTimeout(1000);

  await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(previousCount + 1, { timeout: 15000 });
  await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: viewType })).toBeVisible({ timeout: 15000 });
});

When(
  'I rename the database view tab {string} to {string}',
  async ({ page }, currentLabel: string, nextLabel: string) => {
    const tabSpan = page.locator('[data-testid^="view-tab-"] span').filter({ hasText: currentLabel });

    await expect(tabSpan).toBeVisible({ timeout: 10000 });
    await tabSpan.click({ button: 'right', force: true });
    await page.waitForTimeout(500);

    await expect(DatabaseViewSelectors.tabActionRename(page)).toBeVisible();
    await DatabaseViewSelectors.tabActionRename(page).click({ force: true });
    await expect(ModalSelectors.renameInput(page)).toBeVisible();
    await ModalSelectors.renameInput(page).clear();
    await ModalSelectors.renameInput(page).fill(nextLabel);

    const saveButton = ModalSelectors.renameSaveButton(page);

    await expect(saveButton).toBeEnabled({ timeout: 10000 });
    await saveButton.click();
    await expect(ModalSelectors.renameInput(page)).toBeHidden({ timeout: 10000 });
    await expect(page.locator('[data-testid^="view-tab-"]').filter({ hasText: nextLabel })).toBeVisible({
      timeout: 10000,
    });
  }
);

Then('the database view tabs appear in order {string}', async ({ page }, orderedLabels: string) => {
  const expected = orderedLabels.split(',').map((label) => label.trim());

  await expect
    .poll(async () => tabLabels(page), {
      timeout: 15000,
      message: `Expected database view tabs in order: ${expected.join(', ')}`,
    })
    .toEqual(expected);
});

When('I navigate to another page and reopen the database', async ({ page }) => {
  await createDocumentPageAndNavigate(page);
  await page.waitForTimeout(2000);

  await expandSpaceByName(page, SPACE_NAME);
  await PageSelectors.nameContaining(page, DATABASE_NAME).first().click({ force: true });
  await page.waitForTimeout(3000);

  await expect(DatabaseViewSelectors.viewTab(page).first()).toBeVisible({ timeout: 15000 });
});
