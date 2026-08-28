import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { FieldType, SortCondition } from '../../../src/application/database-yjs/database.type';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  addGalleryView,
  createFieldDirect,
  getActiveRowIds,
  setFiltersDirect,
  setSortsDirect,
} from '../../support/gallery-test-helpers';
import { createNamedGridDatabase, createOneWayRelationField } from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { DatabaseGallerySelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, Then, When } = createBdd();

const configuredPages = new WeakSet<Page>();

Given('the Gallery test app is initialized', async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ height: 900, width: 1440 });
});

When('the Gallery user signs in anonymously', async ({ page, request }) => {
  await signInAndWaitForApp(page, request, generateRandomEmail());
});

Then('the Gallery user sees the home page with get started page', async ({ page }) => {
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });
  await expect(page.locator('[data-testid="inline-add-page"], [data-testid="new-page-button"]').first()).toBeVisible({
    timeout: 20_000,
  });
});

When('the user sets up a gallery with relation filter', async ({ page }) => {
  const target = await createNamedGridDatabase(page, 'Gallery Relation Target', ['Linked Row Target']);
  const source = await createNamedGridDatabase(page, 'Gallery Relation Source', ['Existing one', 'Existing two']);
  const relationFieldId = await createOneWayRelationField(page, {
    fieldName: 'Linked Row',
    relatedDatabaseId: target.databaseId,
  });
  const vipOptionId = 'gallery_vip_option';
  const priorityFieldId = await createFieldDirect(page, {
    fieldType: FieldType.SingleSelect,
    name: 'Priority',
    selectOptions: [{ id: vipOptionId, name: 'VIP' }],
  });
  const lastModifiedFieldId = await createFieldDirect(page, {
    fieldType: FieldType.LastEditedTime,
    name: 'Last modified',
  });

  expect(source.databaseId).not.toBe(target.databaseId);
  await addGalleryView(page);
  await setSortsDirect(page, [{ condition: SortCondition.Descending, fieldId: lastModifiedFieldId }]);
  await setFiltersDirect(
    page,
    [
      {
        condition: 2,
        content: JSON.stringify([target.rowIds[0]]),
        fieldId: relationFieldId,
        fieldType: FieldType.Relation,
      },
      {
        condition: 0,
        content: vipOptionId,
        fieldId: priorityFieldId,
        fieldType: FieldType.SingleSelect,
      },
    ],
    { advanced: true }
  );
  await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(0);
  configuredPages.add(page);
});

When('the user clicks the new row button in the database toolbar', async ({ page }) => {
  expect(configuredPages.has(page)).toBe(true);
  const before = await getActiveRowIds(page);

  await page.getByTestId('database-new-row-button').click();
  await expect.poll(() => getActiveRowIds(page), { timeout: 20_000 }).toHaveLength(before.length + 1);
});

Then('the Gallery row detail page is visible', async ({ page }) => {
  await expect(RowDetailSelectors.modal(page).last()).toBeVisible({ timeout: 15_000 });
});

When('the user expands hidden fields in Gallery row detail', async ({ page }) => {
  const modal = RowDetailSelectors.modal(page).last();
  const showHidden = modal.getByRole('button', { name: /Show \d+ hidden fields?/i });

  await expect(showHidden).toBeVisible({ timeout: 15_000 });
  await showHidden.click();
});

Then('the Gallery row detail page shows relation value {string}', async ({ page }, value: string) => {
  await expect(RowDetailSelectors.modal(page).last()).toContainText(value, { timeout: 30_000 });
});

Then('the Gallery row detail page shows select option {string}', async ({ page }, option: string) => {
  await expect(RowDetailSelectors.modal(page).last()).toContainText(option, { timeout: 20_000 });
});

When('the user edits the Gallery row title to {string}', async ({ page }, title: string) => {
  const input = RowDetailSelectors.titleInput(page);

  await expect(input).toBeVisible();
  await input.fill(title);
  await expect(input).toHaveValue(title);
});

When('the user closes the Gallery row detail page', async ({ page }) => {
  await closeRowDetailWithEscape(page);
  await expect(DatabaseGallerySelectors.gallery(page)).toBeVisible({ timeout: 15_000 });
  // Desktop stores second-resolution timestamps for Last modified. Keeping
  // creations in distinct seconds makes the migrated descending-sort assertion
  // deterministic without changing production state.
  await page.waitForTimeout(1_100);
});

Then('the gallery card at position {int} has title {string}', async ({ page }, position: number, title: string) => {
  await expect(DatabaseGallerySelectors.titles(page).nth(position)).toHaveText(title, { timeout: 20_000 });
});
