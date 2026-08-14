import { expect, type Page, test } from '@playwright/test';

import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import {
  addFilterByFieldName,
  changeFilterCondition,
  deleteFilter,
  enterFilterText,
  generateRandomEmail,
  getPrimaryFieldId,
  loginAndCreateGrid,
  setupPageErrorHandling,
  TextFilterCondition,
  typeTextIntoCell,
} from '../../support/filter-test-helpers';
import { addFieldWithType } from '../../support/field-type-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { closeRowDetailWithEscape, typeInRowDocument } from '../../support/row-detail-helpers';
import {
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
  FieldType,
  RowControlsSelectors,
  RowDetailSelectors,
} from '../../support/selectors';
import {
  addSortByFieldName,
  changeSortDirection,
  closeSortMenu,
  openSortMenu,
  SortDirection,
} from '../../support/sort-test-helpers';

async function addListView(page: Page): Promise<void> {
  await DatabaseViewSelectors.addViewButton(page).click();
  await expect(DatabaseViewSelectors.viewTypeOption(page, 'List')).toBeVisible({ timeout: 10000 });
  await DatabaseViewSelectors.viewTypeOption(page, 'List').click();
  await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30000 });
}

async function switchToView(page: Page, name: 'Grid' | 'List'): Promise<void> {
  await DatabaseViewSelectors.viewTab(page).filter({ hasText: name }).click();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText(name);
}

async function closeDatabaseSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(
    page.locator('[data-slot="dropdown-menu-content"]:visible, [data-slot="dropdown-menu-sub-content"]:visible')
  ).toHaveCount(0);
}

async function expectFirstListRowFieldOrder(
  page: Page,
  primaryFieldId: string,
  expectedFieldIds: string[]
): Promise<void> {
  const firstRow = DatabaseListSelectors.rows(page).first();

  await expect(firstRow).toBeVisible();
  await expect
    .poll(
      () =>
        firstRow
          .locator('.list-primary-field, .list-property-cell')
          .evaluateAll(
            (cells, primaryId) => cells.map((cell) => cell.getAttribute('data-field-id') || String(primaryId)),
            primaryFieldId
          ),
      { timeout: 15000 }
    )
    .toEqual(expectedFieldIds);
}

async function expectListTitles(page: Page, titles: string[]): Promise<void> {
  await expect(DatabaseListSelectors.primaryCells(page)).toHaveCount(titles.length, { timeout: 15000 });
  await expect(DatabaseListSelectors.primaryCells(page)).toHaveText(titles, { timeout: 15000 });
}

test.describe('Database List view (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 800, width: 1440 });
  });

  test('creates a standalone List page with rows and desktop controls', async ({ page, request }) => {
    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'List', {
      verify: async (currentPage) => {
        await expect(DatabaseListSelectors.list(currentPage)).toBeVisible({ timeout: 30000 });
      },
    });

    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('List');
    await expect.poll(() => DatabaseListSelectors.rows(page).count()).toBeGreaterThan(0);
    await expect(DatabaseListSelectors.newRowButton(page)).toBeVisible();
  });

  test("creates List from Grid, keeps Desktop's first three ordered fields, and persists visibility per view", async ({
    page,
    request,
  }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Visible in both views');
    await addFieldWithType(page, FieldType.RichText);
    await addFieldWithType(page, FieldType.RichText);

    const orderedFieldIds = await page
      .locator('[data-testid^="grid-field-header-"]')
      .evaluateAll((headers) => [
        ...new Set(
          headers
            .map((header) => header.getAttribute('data-testid')?.replace('grid-field-header-', ''))
            .filter((fieldId): fieldId is string => Boolean(fieldId))
        ),
      ]);
    const nonPrimaryFieldIds = orderedFieldIds.filter((fieldId) => fieldId !== primaryFieldId);
    // Desktop uses the absolute field index for its three-field cutoff. With
    // the primary field first, the first two non-primary fields are visible.
    const expectedVisibleFieldIds = nonPrimaryFieldIds.slice(0, 2);
    const expectedHiddenFieldIds = nonPrimaryFieldIds.slice(2);
    const initiallyHiddenFieldId = expectedHiddenFieldIds[0];
    const listOnlyHiddenFieldId = expectedVisibleFieldIds[0];

    expect(nonPrimaryFieldIds.length).toBeGreaterThan(3);
    if (!initiallyHiddenFieldId || !listOnlyHiddenFieldId) {
      throw new Error('Expected both visible and hidden non-primary List fields');
    }

    await addListView(page);
    await expect(DatabaseListSelectors.primaryCells(page).first()).toContainText('Visible in both views');

    for (const fieldId of expectedVisibleFieldIds) {
      await expect(DatabaseListSelectors.fieldsForField(page, fieldId).first()).toBeVisible();
    }
    for (const fieldId of expectedHiddenFieldIds) {
      await expect(DatabaseListSelectors.fieldsForField(page, fieldId)).toHaveCount(0);
    }
    const expectedInitialFieldOrder = orderedFieldIds.filter(
      (fieldId) => fieldId === primaryFieldId || expectedVisibleFieldIds.includes(fieldId)
    );

    await expectFirstListRowFieldOrder(page, primaryFieldId, expectedInitialFieldOrder);

    await page.getByTestId('database-actions-settings').click();
    await page.getByTestId('database-properties-settings-trigger').hover();
    const hiddenProperty = page.getByTestId(`database-property-${initiallyHiddenFieldId}`);

    await expect(hiddenProperty).toBeVisible({ timeout: 10000 });
    await hiddenProperty.click();
    await expect(DatabaseListSelectors.fieldsForField(page, initiallyHiddenFieldId).first()).toBeVisible();

    const listOnlyHiddenProperty = page.getByTestId(`database-property-${listOnlyHiddenFieldId}`);

    await expect(listOnlyHiddenProperty).toBeVisible();
    await listOnlyHiddenProperty.click();
    await expect(DatabaseListSelectors.fieldsForField(page, listOnlyHiddenFieldId)).toHaveCount(0);
    await closeDatabaseSettings(page);

    await switchToView(page, 'Grid');
    await expect(DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first()).toContainText(
      'Visible in both views'
    );
    await expect(DatabaseGridSelectors.dataRowCellsForField(page, listOnlyHiddenFieldId).first()).toBeVisible();
    await switchToView(page, 'List');
    await expect(DatabaseListSelectors.fieldsForField(page, initiallyHiddenFieldId).first()).toBeVisible();
    await expect(DatabaseListSelectors.fieldsForField(page, listOnlyHiddenFieldId)).toHaveCount(0);

    const expectedPersistedFieldOrder = orderedFieldIds.filter(
      (fieldId) =>
        fieldId === primaryFieldId ||
        fieldId === initiallyHiddenFieldId ||
        (expectedVisibleFieldIds.includes(fieldId) && fieldId !== listOnlyHiddenFieldId)
    );

    await expectFirstListRowFieldOrder(page, primaryFieldId, expectedPersistedFieldOrder);
  });

  test('applies filter and sort in List and reacts to direction and deletion changes', async ({ page, request }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Zulu skip');
    await typeTextIntoCell(page, primaryFieldId, 1, 'Beta target');
    await typeTextIntoCell(page, primaryFieldId, 2, 'Alpha target');
    await addListView(page);

    await addSortByFieldName(page, 'Name');
    await expectListTitles(page, ['Alpha target', 'Beta target', 'Zulu skip']);

    await addFilterByFieldName(page, 'Name');
    await changeFilterCondition(page, TextFilterCondition.TextContains);
    await enterFilterText(page, 'target');
    await page.keyboard.press('Escape');
    await expectListTitles(page, ['Alpha target', 'Beta target']);

    await openSortMenu(page);
    await changeSortDirection(page, 0, SortDirection.Descending);
    await closeSortMenu(page);
    await expectListTitles(page, ['Beta target', 'Alpha target']);

    await deleteFilter(page);
    await expectListTitles(page, ['Zulu skip', 'Beta target', 'Alpha target']);
  });

  test('opens rows, prioritizes icon over document, and shares duplicate/delete changes with Grid', async ({
    page,
    request,
  }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Lifecycle row');
    await addListView(page);

    const lifecycleRow = DatabaseListSelectors.rows(page).filter({ hasText: 'Lifecycle row' }).first();
    const rowId = await lifecycleRow.getAttribute('data-row-id');

    expect(rowId).toBeTruthy();
    await lifecycleRow.click();
    await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15000 });

    await typeInRowDocument(page, 'List document content');
    await closeRowDetailWithEscape(page);
    await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toHaveAttribute('data-primary-indicator', 'document', {
      timeout: 15000,
    });

    await DatabaseListSelectors.rowById(page, rowId!).click();
    const rowDetail = RowDetailSelectors.modal(page);

    await expect(rowDetail).toBeVisible({ timeout: 15000 });
    await rowDetail.getByTestId('row-title-input').hover();
    const addIcon = rowDetail.getByTestId('add-icon-button');

    await expect(addIcon).toBeVisible();
    await addIcon.click();
    await page.getByTestId('icon-popover-tab-emoji').click();
    const emojiButton = page.locator('.emoji-picker button.text-xl').first();

    await expect(emojiButton).toBeVisible({ timeout: 15000 });
    await emojiButton.click();
    await closeRowDetailWithEscape(page);
    await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toHaveAttribute('data-primary-indicator', 'icon', {
      timeout: 15000,
    });

    const initialListRowCount = await DatabaseListSelectors.rows(page).count();

    await DatabaseListSelectors.rowById(page, rowId!).hover();
    await DatabaseListSelectors.rowById(page, rowId!).getByTestId('row-accessory-button').click();
    await RowControlsSelectors.rowMenuDuplicate(page).click();
    await expect(DatabaseListSelectors.rows(page)).toHaveCount(initialListRowCount + 1, { timeout: 15000 });
    await expect(DatabaseListSelectors.primaryCells(page).filter({ hasText: 'Lifecycle row' })).toHaveCount(2);

    await DatabaseListSelectors.rowById(page, rowId!).hover();
    await DatabaseListSelectors.rowById(page, rowId!).getByTestId('row-accessory-button').click();
    await RowControlsSelectors.rowMenuDelete(page).click();
    await RowControlsSelectors.deleteRowConfirmButton(page).click();
    await expect(DatabaseListSelectors.rowById(page, rowId!)).toHaveCount(0, { timeout: 15000 });

    await switchToView(page, 'Grid');
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(initialListRowCount);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).filter({ hasText: 'Lifecycle row' })
    ).toHaveCount(1);
  });

  test('renders source rows in a Linked List embedded in a document', async ({ page, request }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'List Row 1');
    await typeTextIntoCell(page, primaryFieldId, 1, 'List Row 2');
    await typeTextIntoCell(page, primaryFieldId, 2, 'List Row 3');

    const documentViewId = await createDocumentPageAndNavigate(page);

    await insertLinkedDatabaseViaSlash(page, documentViewId, 'New Database', 'List');

    const editor = page.locator(`#editor-${documentViewId}`);
    const embeddedList = editor.getByTestId('database-list');

    await expect(embeddedList).toBeVisible({ timeout: 30000 });
    await expect(embeddedList.locator('[data-testid^="list-primary-cell-"]')).toContainText([
      'List Row 1',
      'List Row 2',
      'List Row 3',
    ]);
  });
});
