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
  BoardSelectors,
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
  FieldType,
  itemDirectChildPageItems,
  PageSelectors,
  RowDetailSelectors,
  viewIdFromPageTestId,
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

async function switchToView(page: Page, name: 'Board' | 'Grid' | 'List'): Promise<void> {
  await DatabaseViewSelectors.viewTab(page).filter({ hasText: name }).click();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText(name);
}

async function chooseRowEmoji(page: Page, rowId: string, emojiIndex: number): Promise<string> {
  await DatabaseListSelectors.rowById(page, rowId).click();
  const rowDetail = RowDetailSelectors.modal(page).last();

  await expect(rowDetail).toBeVisible({ timeout: 15_000 });
  await rowDetail.getByTestId('row-title-input').hover();

  const existingIcon = rowDetail.locator('.view-icon').first();

  if (await existingIcon.isVisible().catch(() => false)) {
    await existingIcon.click();
  } else {
    const addIcon = rowDetail.getByTestId('add-icon-button');

    await expect(addIcon).toBeVisible();
    await addIcon.click();
  }

  await page.getByTestId('icon-popover-tab-emoji').click();
  const emojiButton = page.locator('.emoji-picker button.text-xl').nth(emojiIndex);

  await expect(emojiButton).toBeVisible({ timeout: 15_000 });
  const emoji = (await emojiButton.textContent())?.trim() ?? '';

  expect(emoji).not.toBe('');
  await emojiButton.click();
  await expect(page.locator('.emoji-picker')).toHaveCount(0, { timeout: 15_000 });
  await closeListRowDetail(page);
  await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toContainText(emoji);
  return emoji;
}

async function closeListRowDetail(page: Page): Promise<void> {
  await closeRowDetailWithEscape(page);
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 15_000 });
}

async function openDatabaseProperties(page: Page): Promise<void> {
  const trigger = page.getByTestId('database-properties-settings-trigger');

  if (!(await trigger.isVisible().catch(() => false))) {
    await page.getByTestId('database-actions-settings').click();
  }

  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.hover();
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

async function expectOnlyStandaloneListChild(page: Page): Promise<string> {
  const container = PageSelectors.itemByName(page, 'New Database');

  await expect(container).toBeVisible({ timeout: 30_000 });
  const visibleChildren = container.locator(itemDirectChildPageItems(true));

  if ((await visibleChildren.count()) === 0) {
    await container.locator('[data-testid="outline-toggle-expand"]').first().click({ force: true });
  }

  await expect(visibleChildren).toHaveCount(1, { timeout: 30_000 });
  const listChild = visibleChildren.first();

  await expect(listChild.getByTestId('page-name')).toHaveText('List');
  // Referenced database children intentionally use a dot in the sidebar. The
  // breadcrumb icon is selected from that folder child's persisted ViewLayout,
  // so it catches a renamed Grid child even when its collab was locally
  // converted to List.
  await expect(page.getByTestId('breadcrumb-item-list').getByTestId('list-view-icon')).toBeVisible();
  const childRowTestId = await listChild.locator(':scope > [data-testid^="page-"]').first().getAttribute('data-testid');

  return viewIdFromPageTestId(childRowTestId);
}

test.describe('Database List view (Flutter desktop parity)', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 800, width: 1440 });
  });

  test('database_list_basic.dart: creates a standalone List container with one database child', async ({
    page,
    request,
  }) => {
    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'List', {
      verify: async (currentPage) => {
        await expect(DatabaseListSelectors.list(currentPage)).toBeVisible({ timeout: 30000 });
      },
    });

    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('List');
    await expect.poll(() => DatabaseListSelectors.rows(page).count()).toBeGreaterThan(0);
    await expect(DatabaseListSelectors.newRowButton(page)).toBeVisible();
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toHaveCount(0);

    const listViewId = await expectOnlyStandaloneListChild(page);

    expect(page.url()).toContain(listViewId);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('List');
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toHaveCount(0);
    expect(await expectOnlyStandaloneListChild(page)).toBe(listViewId);
  });

  test('database_list_basic.dart: list view displays rows edited through row detail', async ({ page, request }) => {
    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'List', {
      verify: async (currentPage) => {
        await expect(DatabaseListSelectors.list(currentPage)).toBeVisible({ timeout: 30_000 });
      },
    });

    const rows = DatabaseListSelectors.rows(page);

    await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(2);
    const firstRowId = await rows.nth(0).getAttribute('data-row-id');
    const secondRowId = await rows.nth(1).getAttribute('data-row-id');

    expect(firstRowId).toBeTruthy();
    expect(secondRowId).toBeTruthy();

    await DatabaseListSelectors.rowById(page, firstRowId!).click();
    await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15_000 });
    await RowDetailSelectors.titleInput(page).fill('First Row');
    await closeListRowDetail(page);

    await DatabaseListSelectors.rowById(page, secondRowId!).click();
    await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15_000 });
    await RowDetailSelectors.titleInput(page).fill('Second Row');
    await closeListRowDetail(page);

    await expect(page.getByTestId(`list-primary-cell-${firstRowId}`)).toContainText('First Row');
    await expect(page.getByTestId(`list-primary-cell-${secondRowId}`)).toContainText('Second Row');
  });

  test('database_list_basic.dart: creates List from the Grid tab bar and switches both ways', async ({
    page,
    request,
  }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());

    await expect(DatabaseGridSelectors.grid(page)).toBeVisible();
    await expect.poll(() => DatabaseGridSelectors.dataRows(page).count()).toBeGreaterThanOrEqual(3);
    const seededRowCount = await DatabaseGridSelectors.dataRows(page).count();

    await addListView(page);
    await expect(DatabaseGridSelectors.grid(page)).toHaveCount(0);
    await expect(DatabaseListSelectors.rows(page)).toHaveCount(seededRowCount, { timeout: 15_000 });

    await switchToView(page, 'Grid');
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30_000 });
    await expect(DatabaseListSelectors.list(page)).toHaveCount(0);
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(seededRowCount, { timeout: 15_000 });

    await switchToView(page, 'List');
    await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
    await expect(DatabaseGridSelectors.grid(page)).toHaveCount(0);
    await expect(DatabaseListSelectors.rows(page)).toHaveCount(seededRowCount, { timeout: 15_000 });
  });

  test('database_list_basic.dart and database_list_row_icon_test.dart: List layout and row icon persist after navigation', async ({
    page,
    request,
  }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Persistent icon row');
    await addListView(page);
    const row = DatabaseListSelectors.rows(page).filter({ hasText: 'Persistent icon row' }).first();
    const rowId = await row.getAttribute('data-row-id');

    expect(rowId).toBeTruthy();
    const emoji = await chooseRowEmoji(page, rowId!, 0);
    const listUrl = page.url();

    await createDocumentPageAndNavigate(page);
    await expect(DatabaseListSelectors.list(page)).toHaveCount(0);

    await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
    await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
    await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText('List');
    await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toContainText(emoji, { timeout: 30_000 });
  });

  test('database_list_basic.dart: creates List from Board and preserves the Board tab', async ({ page, request }) => {
    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Board', {
      verify: async (currentPage) => {
        await expect(BoardSelectors.boardContainer(currentPage)).toBeVisible({ timeout: 30_000 });
      },
    });

    await addListView(page);
    await expect(DatabaseListSelectors.list(page)).toBeVisible();

    await switchToView(page, 'Board');
    await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 30_000 });
    await expect(DatabaseListSelectors.list(page)).toHaveCount(0);
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

    await openDatabaseProperties(page);
    const hiddenProperty = page.getByTestId(`database-property-${initiallyHiddenFieldId}`);

    await expect(hiddenProperty).toBeVisible({ timeout: 10000 });
    await hiddenProperty.click();
    await expect(DatabaseListSelectors.fieldsForField(page, initiallyHiddenFieldId).first()).toBeVisible();

    await openDatabaseProperties(page);
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

  test('database_list_row_operations.dart: creates a row from List and shares it with Grid', async ({
    page,
    request,
  }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());

    const initialGridRowCount = await DatabaseGridSelectors.dataRows(page).count();

    await addListView(page);
    const initialListRowCount = await DatabaseListSelectors.rows(page).count();

    await DatabaseListSelectors.newRowButton(page).click();
    await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15_000 });
    await closeListRowDetail(page);
    await expect(DatabaseListSelectors.rows(page)).toHaveCount(initialListRowCount + 1, { timeout: 15_000 });

    await switchToView(page, 'Grid');
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(initialGridRowCount + 1, { timeout: 15_000 });
  });

  test('database_list_row_operations.dart: a Grid title edit is reflected in List', async ({ page, request }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Initial Title');
    await addListView(page);
    await expect(DatabaseListSelectors.primaryCells(page).filter({ hasText: 'Initial Title' })).toHaveCount(1);

    await switchToView(page, 'Grid');
    await typeTextIntoCell(page, primaryFieldId, 0, 'Updated Title');
    await switchToView(page, 'List');

    await expect(DatabaseListSelectors.primaryCells(page).filter({ hasText: 'Updated Title' })).toHaveCount(1);
    await expect(DatabaseListSelectors.primaryCells(page).filter({ hasText: 'Initial Title' })).toHaveCount(0);
  });

  test('database_list_row_operations.dart and database_list_row_icon_test.dart: row detail, icon priority, duplicate, and delete parity', async ({
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
    await closeListRowDetail(page);
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
    await expect(page.locator('.emoji-picker')).toHaveCount(0, { timeout: 15_000 });
    await closeListRowDetail(page);
    await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toHaveAttribute('data-primary-indicator', 'icon', {
      timeout: 15000,
    });

    const initialListRowCount = await DatabaseListSelectors.rows(page).count();

    await DatabaseListSelectors.rowById(page, rowId!).click();
    await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('row-detail-more-actions').click();
    await page.getByTestId('row-detail-duplicate').click();
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(DatabaseListSelectors.rows(page)).toHaveCount(initialListRowCount + 1, { timeout: 15000 });
    await expect(DatabaseListSelectors.primaryCells(page).filter({ hasText: 'Lifecycle row' })).toHaveCount(2);

    await DatabaseListSelectors.rowById(page, rowId!).click();
    await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('row-detail-more-actions').click();
    await page.getByTestId('row-detail-delete').click();
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(DatabaseListSelectors.rowById(page, rowId!)).toHaveCount(0, { timeout: 15000 });

    await switchToView(page, 'Grid');
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(initialListRowCount);
    await expect(
      DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).filter({ hasText: 'Lifecycle row' })
    ).toHaveCount(1);
  });

  test('database_list_row_icon_test.dart: row icon updates when changed in row detail', async ({ page, request }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Changing icon row');
    await addListView(page);
    const rowId = await DatabaseListSelectors.rows(page)
      .filter({ hasText: 'Changing icon row' })
      .first()
      .getAttribute('data-row-id');

    expect(rowId).toBeTruthy();
    const firstEmoji = await chooseRowEmoji(page, rowId!, 0);
    const nextEmoji = await chooseRowEmoji(page, rowId!, 1);

    expect(nextEmoji).not.toBe(firstEmoji);
    await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toContainText(nextEmoji);
    await expect(page.getByTestId(`list-primary-cell-${rowId}`)).not.toContainText(firstEmoji);
  });

  test('database_list_row_icon_test.dart: Grid and List both show the same row emoji', async ({ page, request }) => {
    await loginAndCreateGrid(page, request, generateRandomEmail());

    const primaryFieldId = await getPrimaryFieldId(page);

    await typeTextIntoCell(page, primaryFieldId, 0, 'Cross-view icon row');
    await addListView(page);
    const rowId = await DatabaseListSelectors.rows(page)
      .filter({ hasText: 'Cross-view icon row' })
      .first()
      .getAttribute('data-row-id');

    expect(rowId).toBeTruthy();
    const emoji = await chooseRowEmoji(page, rowId!, 0);

    await switchToView(page, 'Grid');
    await expect(DatabaseGridSelectors.rowById(page, rowId!).locator('.custom-icon')).toContainText(emoji, {
      timeout: 15_000,
    });

    await switchToView(page, 'List');
    await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toContainText(emoji);
  });

  test('document_linked_list_test.dart: renders source rows in a Linked List embedded in a document', async ({
    page,
    request,
  }) => {
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
