import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { getPrimaryFieldId, loginAndCreateGrid, typeTextIntoCell } from '../../support/filter-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { closeRowDetailWithEscape, typeInRowDocument } from '../../support/row-detail-helpers';
import { DatabaseListSelectors, HeaderSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then } = createBdd();

async function openFirstListRow(page: Parameters<typeof DatabaseListSelectors.rows>[0]) {
  const firstRow = DatabaseListSelectors.rows(page).first();
  const opener = firstRow.getByRole('button', { name: 'Open row' });

  // The full-row opener intentionally leaves pointer events to cells and row
  // actions. Exercising its keyboard contract is deterministic and mirrors an
  // ordinary click on the non-interactive row surface.
  await opener.focus();
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');
}

Given('an editable List database is open for readonly parity', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await loginAndCreateGrid(page, request, generateRandomEmail());

  const primaryFieldId = await getPrimaryFieldId(page);

  await typeTextIntoCell(page, primaryFieldId, 0, 'Readonly List row');
  const documentViewId = await createDocumentPageAndNavigate(page);

  // Page locking is intentionally available only on documents. A linked List
  // mounted in that document inherits the same App read-only context as a
  // standalone database, while keeping the ordinary (non-Publish) renderer.
  await insertLinkedDatabaseViaSlash(page, documentViewId, 'New Database', 'List');
  await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });

  // Materialize document content while editable so the readonly assertion
  // exercises the mounted row editor rather than an empty-document fallback.
  await openFirstListRow(page);
  await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15_000 });
  await typeInRowDocument(page, 'Readonly document content');
  await closeRowDetailWithEscape(page);
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(DatabaseListSelectors.list(page)).toBeVisible();
});

Then('List mutation controls are available before locking', async ({ page }) => {
  const firstRow = DatabaseListSelectors.rows(page).first();

  await expect(DatabaseListSelectors.newRowButton(page)).toBeVisible();
  await firstRow.hover();
  await expect(firstRow.getByTestId('row-accessory-button')).toBeVisible();
  await expect(page.locator('[data-testid^="list-checkbox-cell-"]').first()).toBeEnabled();
});

When('I lock the mounted List database', async ({ page }) => {
  await HeaderSelectors.moreActionsButton(page).click();
  const lockItem = page.getByTestId('more-page-lock');

  await expect(lockItem).toBeVisible();
  await lockItem.click();
  await expect(page.getByTestId('page-locked-badge')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(DatabaseListSelectors.list(page)).toBeVisible();
});

Then('the List add row action is hidden in readonly mode', async ({ page }) => {
  await expect(DatabaseListSelectors.newRowButton(page)).toHaveCount(0);
  await expect(page.getByTestId('database-new-row-button')).toHaveCount(0);
});

Then('List row mutations and inline cell editing are disabled', async ({ page }) => {
  const firstRow = DatabaseListSelectors.rows(page).first();

  await expect(firstRow).toBeVisible();
  await expect(firstRow.locator('[data-testid^="list-row-actions-"]')).toHaveCount(0);
  await expect(firstRow.getByTestId('row-accessory-button')).toHaveCount(0);
  await expect(firstRow.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="list-checkbox-cell-"]').first()).toBeDisabled();
});

When('I open the first List row detail while readonly', async ({ page }) => {
  await openFirstListRow(page);
  await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15_000 });
});

Then('the List row detail remains open and readonly', async ({ page }) => {
  const modal = RowDetailSelectors.modal(page).last();
  const title = modal.getByTestId('row-title-input');
  const editor = modal.getByTestId('editor-content').first();

  await expect(modal).toBeVisible();
  await expect.poll(() => title.evaluate((element) => (element as HTMLTextAreaElement).readOnly)).toBe(true);
  await expect(modal.getByTestId('row-detail-open-full-page')).toBeVisible();
  await expect(modal.getByTestId('row-detail-more-actions')).toHaveCount(0);
  await expect(modal.getByTestId('add-icon-button')).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Add Cover', exact: true })).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'New property', exact: true })).toHaveCount(0);
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor).toHaveAttribute('contenteditable', 'false');
});
