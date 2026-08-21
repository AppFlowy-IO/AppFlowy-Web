import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { loginAndCreateGrid } from '../../support/filter-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { DatabaseGallerySelectors, HeaderSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, Then, When } = createBdd();

Given('an editable Gallery database is open for readonly parity', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await loginAndCreateGrid(page, request, generateRandomEmail());

  const documentViewId = await createDocumentPageAndNavigate(page);

  // Page locking is intentionally available only on documents. A linked
  // Gallery mounted in that document inherits the ordinary App read-only
  // context, matching the existing List readonly BDD convention.
  await insertLinkedDatabaseViaSlash(page, documentViewId, 'New Database', 'Gallery');
  await expect(DatabaseGallerySelectors.gallery(page)).toBeVisible({ timeout: 30_000 });
});

Then('Gallery add-row actions are available before locking', async ({ page }) => {
  await expect(DatabaseGallerySelectors.newRowButton(page)).toBeVisible();
  await expect(page.getByTestId('database-new-row-button')).toBeVisible();
});

When('I lock the mounted Gallery database', async ({ page }) => {
  await HeaderSelectors.moreActionsButton(page).click();
  const lockItem = page.getByTestId('more-page-lock');

  await expect(lockItem).toBeVisible();
  await lockItem.click();
  await expect(page.getByTestId('page-locked-badge')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(DatabaseGallerySelectors.gallery(page)).toBeVisible();
});

Then('the Gallery add row action is hidden in readonly mode', async ({ page }) => {
  await expect(DatabaseGallerySelectors.newRowButton(page)).toHaveCount(0);
  await expect(page.getByTestId('database-new-row-button')).toHaveCount(0);
});
