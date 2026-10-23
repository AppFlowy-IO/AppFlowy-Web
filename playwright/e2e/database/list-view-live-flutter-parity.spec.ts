import { expect, type Locator, type Page, test } from '@playwright/test';

import { DatabaseViewLayout } from '../../../src/application/types';
import { addPropertyColumn, signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import {
  generateRandomEmail,
  getPrimaryFieldId,
  loginAndCreateGrid,
  setupPageErrorHandling,
  typeTextIntoCell,
} from '../../support/filter-test-helpers';
import { addRows } from '../../support/field-type-helpers';
import { createFieldDirect, setCellDirect } from '../../support/gallery-test-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { setPrimaryCellTextDirect, waitForDatabaseTestContext } from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import {
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
  FieldType,
  itemDirectChildPageItems,
  PageSelectors,
  PersonSelectors,
  RowDetailSelectors,
  viewIdFromPageTestId,
} from '../../support/selectors';
import { expectPeekOpen, setSelectCellDirect } from '../../support/side-peek-helpers';

type FieldInfo = {
  id: string;
  isPrimary: boolean;
  name: string;
  type: FieldType;
};

const FLUTTER_DATABASE_VIEW_DISPLAY_FIELD_TYPES = [
  FieldType.RichText,
  FieldType.Number,
  FieldType.DateTime,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.URL,
  FieldType.Checklist,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
  FieldType.Relation,
  FieldType.Summary,
  FieldType.Translate,
  FieldType.Time,
  FieldType.Media,
  FieldType.Person,
  FieldType.Rollup,
] as const;

const FIELD_TYPES_MISSING_FROM_THE_DEFAULT_GRID = [
  FieldType.Number,
  FieldType.DateTime,
  FieldType.MultiSelect,
  FieldType.URL,
  FieldType.Checklist,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
  FieldType.Relation,
  FieldType.Summary,
  FieldType.Translate,
  FieldType.Time,
  FieldType.Media,
  FieldType.Person,
  FieldType.Rollup,
] as const;

async function databaseViewIds(page: Page): Promise<string[]> {
  return DatabaseViewSelectors.viewTab(page).evaluateAll((tabs) =>
    tabs
      .map((tab) => tab.getAttribute('data-testid')?.replace(/^view-tab-/, ''))
      .filter((viewId): viewId is string => Boolean(viewId))
  );
}

async function activeViewId(page: Page): Promise<string> {
  const testId = await DatabaseViewSelectors.activeViewTab(page).getAttribute('data-testid');

  if (!testId?.startsWith('view-tab-')) throw new Error(`Unable to read active database view ID from ${testId}`);
  return testId.slice('view-tab-'.length);
}

async function addListView(page: Page): Promise<string> {
  const previousViewIds = new Set(await databaseViewIds(page));

  await DatabaseViewSelectors.addViewButton(page).click();
  await DatabaseViewSelectors.viewTypeOption(page, 'List').click();

  let listViewId = '';

  await expect
    .poll(
      async () => {
        listViewId = (await databaseViewIds(page)).find((viewId) => !previousViewIds.has(viewId)) ?? '';
        return listViewId;
      },
      { timeout: 20_000 }
    )
    .not.toBe('');
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${listViewId}`);
  await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
  return listViewId;
}

async function switchToView(page: Page, viewId: string, layout: 'Grid' | 'List') {
  await DatabaseViewSelectors.viewTab(page, viewId).click();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${viewId}`);

  if (layout === 'Grid') {
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
  }
}

async function openDatabaseProperties(page: Page): Promise<void> {
  const trigger = page.getByTestId('database-properties-settings-trigger');

  if (!(await trigger.isVisible().catch(() => false))) {
    await page.getByTestId('database-actions-settings').click();
  }

  await expect(trigger).toBeVisible({ timeout: 10_000 });
  // Click pins the Radix submenu open while Pragmatic DnD moves the pointer
  // through it; a hover-only submenu is allowed to close during native drag.
  await trigger.click();
  await expect(propertyItems(page).first()).toBeVisible({ timeout: 10_000 });
}

async function closeDatabaseSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(
    page.locator('[data-slot="dropdown-menu-content"]:visible, [data-slot="dropdown-menu-sub-content"]:visible')
  ).toHaveCount(0);
}

function propertyItems(page: Page) {
  return page.locator('[role="menuitem"][data-testid^="database-property-"]:visible');
}

async function propertyOrder(page: Page): Promise<string[]> {
  return propertyItems(page).evaluateAll((items) =>
    items
      .map((item) => item.getAttribute('data-testid')?.replace(/^database-property-/, ''))
      .filter((fieldId): fieldId is string => Boolean(fieldId))
  );
}

async function ensurePropertyVisible(page: Page, fieldId: string): Promise<void> {
  const item = page.getByTestId(`database-property-${fieldId}`);
  const toggle = page.getByTestId(`database-property-visibility-${fieldId}`);

  await item.scrollIntoViewIfNeeded();
  const label = await toggle.getAttribute('aria-label');

  if (label?.startsWith('Show ')) await toggle.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(toggle).toHaveAttribute('aria-label', /^Hide /);
}

async function ensurePropertyHidden(page: Page, fieldId: string): Promise<void> {
  const item = page.getByTestId(`database-property-${fieldId}`);
  const toggle = page.getByTestId(`database-property-visibility-${fieldId}`);

  await item.scrollIntoViewIfNeeded();
  const label = await toggle.getAttribute('aria-label');

  if (label?.startsWith('Hide ')) await toggle.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(toggle).toHaveAttribute('aria-label', /^Show /);
}

async function dragPropertyBefore(page: Page, sourceFieldId: string, targetFieldId: string): Promise<void> {
  const sourceItem = page.getByTestId(`database-property-${sourceFieldId}`);
  const sourceHandle = sourceItem.locator('.cursor-grab');
  const targetItem = page.getByTestId(`database-property-${targetFieldId}`);

  await sourceItem.scrollIntoViewIfNeeded();
  await targetItem.scrollIntoViewIfNeeded();
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetItem.boundingBox();

  if (!sourceBox || !targetBox) throw new Error('Properties drag source or target has no layout box');

  await expect(sourceItem).toHaveAttribute('draggable', 'true');
  const sourcePoint = { x: sourceBox.x + 8, y: sourceBox.y + sourceBox.height / 2 };
  const targetPoint = {
    x: targetBox.x + Math.min(targetBox.width / 2, 80),
    y: targetBox.y + Math.min(targetBox.height * 0.15, 4),
  };

  // Traverse Radix's submenu grace area instead of teleporting the pointer
  // from its trigger to the portalled content (which intentionally dismisses
  // a hover submenu).
  await page.mouse.move(sourcePoint.x, sourcePoint.y, { steps: 20 });
  await expect(targetItem).toBeVisible();
  await page.mouse.down();
  await page.waitForTimeout(150);
  await expect(targetItem).toBeVisible();
  await page.mouse.move(sourcePoint.x + 8, sourcePoint.y - 4, { steps: 5 });
  await page.waitForTimeout(150);
  await expect(targetItem).toBeVisible();
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 20 });
  await page.waitForTimeout(250);
  await page.mouse.up();

  await expect
    .poll(async () => {
      const order = (await activeViewFields(page)).map((field) => field.id);
      return order.indexOf(sourceFieldId) < order.indexOf(targetFieldId);
    })
    .toBe(true);
}

async function activeViewFields(page: Page): Promise<FieldInfo[]> {
  await waitForDatabaseTestContext(page);
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    const fields = database.get('fields');

    return view
      .get('field_orders')
      .toArray()
      .map(({ id }: { id: string }) => {
        const field = fields.get(id);

        return {
          id,
          isPrimary: Boolean(field?.get('is_primary')),
          name: String(field?.get('name') ?? ''),
          type: Number(field?.get('ty')),
        };
      });
  });
}

async function activeRowOrderCount(page: Page): Promise<number> {
  await waitForDatabaseTestContext(page);
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);

    return view
      .get('row_orders')
      .toArray()
      .filter((row: { is_deleted?: boolean }) => !row.is_deleted).length;
  });
}

async function addFieldThroughGridUI(page: Page, fieldType: FieldType): Promise<FieldInfo> {
  const beforeFields = await activeViewFields(page);
  const beforeIds = new Set(beforeFields.map((field) => field.id));

  await addPropertyColumn(page, fieldType);
  // Relation creation closes its MUI dialog but intentionally leaves the
  // property dropdown mounted. Clear any remaining menu before the next add.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  let addedField: FieldInfo | undefined;

  await expect
    .poll(
      async () => {
        addedField = (await activeViewFields(page)).find((field) => !beforeIds.has(field.id));
        return addedField?.type;
      },
      { timeout: 20_000 }
    )
    .toBe(fieldType);

  return addedField as FieldInfo;
}

async function seedPrimaryTitles(page: Page, titles: string[]): Promise<void> {
  await waitForDatabaseTestContext(page);
  await page.evaluate(async (rowTitles) => {
    const win = window as any;
    const ctx = win.__TEST_DATABASE_CONTEXT__;
    const Y = win.Y;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    const fields = database.get('fields');
    const fieldOrders = view.get('field_orders').toArray() as Array<{ id: string }>;
    const primaryFieldId =
      fieldOrders.find(({ id }) => Boolean(fields.get(id)?.get('is_primary')))?.id ?? fieldOrders[0]?.id;
    const rowOrders = view.get('row_orders').toArray() as Array<{ id: string; is_deleted?: boolean }>;

    if (!primaryFieldId) throw new Error('Cannot seed List titles without a primary field');

    const activeRows = rowOrders.filter((row) => !row.is_deleted);

    if (activeRows.length !== rowTitles.length) {
      throw new Error(`Expected ${rowTitles.length} rows before title seeding, got ${activeRows.length}`);
    }

    for (let index = 0; index < activeRows.length; index += 1) {
      const rowId = activeRows[index].id;
      const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow?.(rowId));

      if (!rowDoc) throw new Error(`Row ${rowId} was not available for test seeding`);

      rowDoc.transact(() => {
        const row = rowDoc.getMap('data').get('data');
        const cells = row.get('cells');
        let cell = cells.get(primaryFieldId);

        if (!cell) {
          cell = new Y.Map();
          cells.set(primaryFieldId, cell);
        }

        const now = String(Math.floor(Date.now() / 1000));

        cell.set('data', rowTitles[index]);
        cell.set('field_type', 0);
        cell.set('created_at', cell.get('created_at') || now);
        cell.set('last_modified', now);
        row.set('last_modified', now);
      });
    }
  }, titles);
}

async function scrollStandaloneListToLoadAllRows(page: Page, expectedCount: number): Promise<string[]> {
  const list = DatabaseListSelectors.list(page);
  const seenTitles = new Set<string>();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    (await DatabaseListSelectors.primaryCells(page).allTextContents())
      .map((title) => title.trim())
      .filter(Boolean)
      .forEach((title) => seenTitles.add(title));

    if (seenTitles.size >= expectedCount) break;

    await list.evaluate((element) => {
      const pageScroller = element.closest('.appflowy-scroll-container');
      const scrollElement =
        element.scrollHeight > element.clientHeight
          ? element
          : pageScroller instanceof HTMLElement
          ? pageScroller
          : element;

      scrollElement.scrollTop = Math.min(scrollElement.scrollTop + 500, scrollElement.scrollHeight);
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(200);
  }

  return [...seenTitles];
}

type StandaloneListRoute = {
  containerViewId: string;
  listViewId: string;
};

async function expectStandaloneListRoute(page: Page, expectedRoute?: StandaloneListRoute): Promise<StandaloneListRoute> {
  const container = expectedRoute
    ? PageSelectors.itemByViewId(page, expectedRoute.containerViewId)
    : PageSelectors.itemByName(page, 'New Database');

  await expect(container).toBeVisible({ timeout: 30_000 });
  const containerRow = container.locator(':scope > [data-testid^="page-"]').first();
  const containerViewId = viewIdFromPageTestId(await containerRow.getAttribute('data-testid'));
  const visibleChildren = container.locator(itemDirectChildPageItems(true));

  if ((await visibleChildren.count()) === 0) {
    await containerRow.getByTestId('outline-toggle-expand').click({ force: true });
  }

  await expect(visibleChildren).toHaveCount(1, { timeout: 30_000 });
  const listChild = visibleChildren.first();
  const listChildRow = listChild.locator(':scope > [data-testid^="page-"]').first();
  const listViewId = viewIdFromPageTestId(await listChildRow.getAttribute('data-testid'));

  await expect(listChild.getByTestId('page-name')).toHaveText('List');
  await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${listViewId}`);
  await expect(DatabaseViewSelectors.activeViewTab(page).getByTestId('list-view-icon')).toBeVisible();
  await expect(page.getByTestId('breadcrumb-item-list').getByTestId('list-view-icon')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/app/[^/]+/${listViewId}(?:[/?#]|$)`));

  await waitForDatabaseTestContext(page);
  const activeDatabaseView = await page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);

    return {
      activeViewId: String(ctx.activeViewId),
      layout: Number(view?.get('layout')),
    };
  });

  expect(activeDatabaseView).toEqual({ activeViewId: listViewId, layout: DatabaseViewLayout.List });
  if (expectedRoute) expect({ containerViewId, listViewId }).toEqual(expectedRoute);
  return { containerViewId, listViewId };
}

async function chooseStandaloneRowEmoji(page: Page, rowId: string, emojiIndex: number): Promise<string> {
  await DatabaseListSelectors.rowById(page, rowId).click();
  const rowDetail = RowDetailSelectors.modal(page).last();

  await expect(rowDetail).toBeVisible({ timeout: 15_000 });
  await rowDetail.getByTestId('row-title-input').hover();

  // Keep this scoped to the row detail's actual icon. Broad button/SVG
  // selectors can accidentally open the full-page navigation control.
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
  await closeRowDetailWithEscape(page);
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toContainText(emoji);
  return emoji;
}

test.describe('List live Flutter parity', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 800, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
  });

  test('database_list_property_order_test.dart: drag Done before Name, hide it, and persist both changes', async ({
    page,
  }) => {
    const gridViewId = await activeViewId(page);
    const primaryFieldId = await getPrimaryFieldId(page);
    const initialFields = await activeViewFields(page);
    const nameField = initialFields.find((field) => field.name === 'Name');
    const doneField = initialFields.find((field) => field.name === 'Done');

    expect(nameField?.id).toBe(primaryFieldId);
    expect(doneField?.type).toBe(FieldType.Checkbox);
    await typeTextIntoCell(page, primaryFieldId, 0, 'ListPropertyOrderRow');

    const listViewId = await addListView(page);

    await openDatabaseProperties(page);
    await ensurePropertyVisible(page, doneField!.id);
    const beforeOrder = await propertyOrder(page);

    expect(beforeOrder).toContain(nameField!.id);
    expect(beforeOrder).toContain(doneField!.id);
    if (beforeOrder.indexOf(doneField!.id) > beforeOrder.indexOf(nameField!.id)) {
      await dragPropertyBefore(page, doneField!.id, nameField!.id);
    }

    const reordered = await propertyOrder(page);

    expect(reordered.indexOf(doneField!.id)).toBeLessThan(reordered.indexOf(nameField!.id));
    await closeDatabaseSettings(page);

    const titledRow = DatabaseListSelectors.rows(page).filter({ hasText: 'ListPropertyOrderRow' }).first();
    const rowId = await titledRow.getAttribute('data-row-id');

    if (!rowId) throw new Error('ListPropertyOrderRow did not expose a row ID');

    const checkbox = page.getByTestId(`list-checkbox-cell-${rowId}-${doneField!.id}`);
    const primary = page.getByTestId(`list-primary-cell-${rowId}`);

    await expect(checkbox).toBeVisible();
    await expect(primary).toContainText('ListPropertyOrderRow');
    const checkboxBox = await checkbox.boundingBox();
    const primaryBox = await primary.boundingBox();

    expect(checkboxBox).not.toBeNull();
    expect(primaryBox).not.toBeNull();
    expect(checkboxBox!.x + checkboxBox!.width / 2).toBeLessThan(primaryBox!.x + primaryBox!.width / 2);

    const rowFieldOrder = await titledRow
      .locator('.list-property-cell, .list-primary-field')
      .evaluateAll(
        (cells, primaryId) => cells.map((cell) => cell.getAttribute('data-field-id') || String(primaryId)),
        primaryFieldId
      );

    expect(rowFieldOrder.indexOf(doneField!.id)).toBeLessThan(rowFieldOrder.indexOf(primaryFieldId));

    await openDatabaseProperties(page);
    await ensurePropertyHidden(page, doneField!.id);
    await closeDatabaseSettings(page);
    await expect(titledRow.locator(`[data-testid^="list-field-${doneField!.id}-"]`)).toHaveCount(0);

    await switchToView(page, gridViewId, 'Grid');
    await switchToView(page, listViewId, 'List');
    await expect(DatabaseListSelectors.fieldsForField(page, doneField!.id)).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(DatabaseListSelectors.list(page)).toBeVisible({ timeout: 30_000 });
    await expect(DatabaseListSelectors.primaryCells(page).filter({ hasText: 'ListPropertyOrderRow' })).toHaveCount(1);
    await expect(DatabaseListSelectors.fieldsForField(page, doneField!.id)).toHaveCount(0);

    await openDatabaseProperties(page);
    const persistedOrder = await propertyOrder(page);

    expect(persistedOrder.indexOf(doneField!.id)).toBeLessThan(persistedOrder.indexOf(nameField!.id));
    await expect(page.getByTestId(`database-property-visibility-${doneField!.id}`)).toHaveAttribute(
      'aria-label',
      /^Show /
    );
    await closeDatabaseSettings(page);
  });

  test('database_view_display.dart: List Properties shows every supported field type', async ({ page }) => {
    test.setTimeout(300_000);

    const initialFields = await activeViewFields(page);

    expect(initialFields.map((field) => field.type).sort((a, b) => a - b)).toEqual([
      FieldType.RichText,
      FieldType.SingleSelect,
      FieldType.Checkbox,
    ]);

    for (const fieldType of FIELD_TYPES_MISSING_FROM_THE_DEFAULT_GRID) {
      await addFieldThroughGridUI(page, fieldType);
    }

    const gridFields = await activeViewFields(page);

    expect(gridFields.map((field) => field.type).sort((a, b) => a - b)).toEqual(
      [...FLUTTER_DATABASE_VIEW_DISPLAY_FIELD_TYPES].sort((a, b) => a - b)
    );

    await addListView(page);
    const listFields = await activeViewFields(page);
    const primaryField = listFields.find((field) => field.isPrimary);

    expect(listFields.map((field) => field.type)).toEqual(gridFields.map((field) => field.type));
    expect(primaryField?.type).toBe(FieldType.RichText);

    await openDatabaseProperties(page);
    await expect(propertyItems(page)).toHaveCount(FLUTTER_DATABASE_VIEW_DISPLAY_FIELD_TYPES.length);

    for (const field of listFields) {
      await expect(page.getByTestId(`database-property-${field.id}`)).toBeAttached();
      if (field.isPrimary) {
        await expect(page.getByTestId(`database-property-visibility-${field.id}`)).toHaveAttribute(
          'aria-label',
          /^Hide /
        );
      } else {
        // Exercise Show for every property, including Type, regardless of its initial visibility.
        await ensurePropertyHidden(page, field.id);
        await expect(DatabaseListSelectors.fieldsForField(page, field.id)).toHaveCount(0);
        await ensurePropertyVisible(page, field.id);
      }
    }

    for (const field of listFields.filter((field) => !field.isPrimary)) {
      await expect(page.getByTestId(`database-property-visibility-${field.id}`)).toHaveAttribute('aria-label', /^Hide /);
    }

    await closeDatabaseSettings(page);
    const firstRow = DatabaseListSelectors.rows(page).first();
    const rowId = await firstRow.getAttribute('data-row-id');

    if (!rowId) throw new Error('The first List row did not expose a row ID');

    await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toBeAttached();
    for (const field of listFields.filter((field) => !field.isPrimary)) {
      await expect(page.getByTestId(`list-field-${field.id}-${rowId}`)).toBeAttached();
    }
  });

  test('database_list_load_more.dart: 100 rows load incrementally and retain count across Grid and List', async ({
    page,
  }) => {
    test.setTimeout(300_000);

    const gridViewId = await activeViewId(page);
    const rowsToAdd = 100 - (await activeRowOrderCount(page));

    expect(rowsToAdd).toBeGreaterThanOrEqual(0);
    await addRows(page, rowsToAdd);
    await expect.poll(() => activeRowOrderCount(page), { timeout: 60_000 }).toBe(100);

    const titles = Array.from({ length: 100 }, (_, index) => `Item ${index + 1}`);

    await seedPrimaryTitles(page, titles);
    await expect(DatabaseGridSelectors.grid(page)).toContainText('Item 1', { timeout: 20_000 });

    const listViewId = await addListView(page);

    expect(await activeRowOrderCount(page)).toBe(100);
    await expect(DatabaseListSelectors.primaryCells(page)).toHaveCount(50, { timeout: 30_000 });
    await expect(DatabaseListSelectors.primaryCells(page).first()).toContainText('Item 1');

    const seenTitles = await scrollStandaloneListToLoadAllRows(page, 100);

    expect(seenTitles).toHaveLength(100);
    expect(seenTitles).toEqual(expect.arrayContaining(['Item 1', 'Item 50', 'Item 100']));
    await expect(DatabaseListSelectors.primaryCells(page)).toHaveCount(100);

    // Flutter's `create new row in list view increases count` case performs
    // this action at the bottom of the 100-row List before switching views.
    await DatabaseListSelectors.newRowButton(page).scrollIntoViewIfNeeded();
    await DatabaseListSelectors.newRowButton(page).click();
    await expect.poll(() => activeRowOrderCount(page), { timeout: 30_000 }).toBe(101);
    await closeRowDetailWithEscape(page);
    await DatabaseListSelectors.list(page).evaluate((element) => {
      const pageScroller = element.closest('.appflowy-scroll-container');
      const scrollElement =
        element.scrollHeight > element.clientHeight
          ? element
          : pageScroller instanceof HTMLElement
          ? pageScroller
          : element;

      scrollElement.scrollTop = scrollElement.scrollHeight;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    await expect(DatabaseListSelectors.primaryCells(page)).toHaveCount(101, { timeout: 30_000 });

    await switchToView(page, gridViewId, 'Grid');
    expect(await activeRowOrderCount(page)).toBe(101);
    expect(await DatabaseGridSelectors.dataRows(page).count()).toBeGreaterThanOrEqual(10);

    await switchToView(page, listViewId, 'List');
    expect(await activeRowOrderCount(page)).toBe(101);
    await expect(DatabaseListSelectors.primaryCells(page)).toHaveCount(50, { timeout: 30_000 });
    await expect(DatabaseListSelectors.primaryCells(page).first()).toContainText('Item 1');
  });
});

test.describe('Standalone List navigation parity', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 800, width: 1440 });
  });

  test('database_list_basic.dart and database_list_row_icon_test.dart: standalone List persists through outline navigation', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'List', {
      verify: async (currentPage) => {
        await expect(DatabaseListSelectors.list(currentPage)).toBeVisible({ timeout: 30_000 });
      },
    });

    await expect.poll(() => DatabaseListSelectors.rows(page).count(), { timeout: 30_000 }).toBeGreaterThan(0);
    const standaloneRoute = await expectStandaloneListRoute(page);

    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toHaveCount(0);
    const rowId = await DatabaseListSelectors.rows(page).first().getAttribute('data-row-id');

    if (!rowId) throw new Error('The standalone List did not expose a first row ID');
    const emoji = await chooseStandaloneRowEmoji(page, rowId, 0);

    // A full reload catches persistence of the standalone child route, its
    // List layout/icon metadata, and the row icon before navigating away.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectStandaloneListRoute(page, standaloneRoute);
    await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toContainText(emoji, { timeout: 30_000 });

    const documentViewId = await createDocumentPageAndNavigate(page);

    await expect(page).toHaveURL(new RegExp(`/app/[^/]+/${documentViewId}(?:[/?#]|$)`));
    await expect(DatabaseListSelectors.list(page)).toHaveCount(0);

    // Reload while away, then exercise the same outline/container route as
    // Flutter's openPage(listName, layout: Grid). Do not deep-link the child.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(`#editor-${documentViewId}`)).toBeVisible({ timeout: 30_000 });
    const container = PageSelectors.itemByViewId(page, standaloneRoute.containerViewId);
    const containerRow = container.locator(`:scope > [data-testid="page-${standaloneRoute.containerViewId}"]`);

    await expect(containerRow).toBeVisible({ timeout: 30_000 });
    await containerRow.getByTestId('page-name').click();

    await expectStandaloneListRoute(page, standaloneRoute);
    await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' })).toHaveCount(0);
    await expect(page.getByTestId(`list-primary-cell-${rowId}`)).toContainText(emoji, { timeout: 30_000 });
  });
});

// ---------------------------------------------------------------------------
// Desktop PR #1475 "revamp: database list view" (list_row.dart,
// desktop_list_card_cell_style.dart, group_header.dart, list_group_widgets.dart)
// ---------------------------------------------------------------------------

const REVAMP_ROW_TITLES = ['Revamp Amber', 'Revamp Birch', 'Revamp Cedar'];

/** Desktop content box: spacing.m padding, borderRadius.m, a 20px title row (62px with a property line). */
const LIST_ROW_PADDING = 8;
const LIST_ROW_RADIUS = '8px';
const LIST_WIDE_ROW_HEIGHT = 36;
const LIST_NARROW_ROW_HEIGHT = 62;

/** Ids introduced by the revamp. `selectors.ts` is shared with in-flight work, so they stay local. */
const ListRevampLocators = {
  content: (page: Page, rowId: string) => page.getByTestId(`list-row-content-${rowId}`),
  title: (page: Page, rowId: string) => page.getByTestId(`list-row-title-${rowId}`),
  trailing: (page: Page, rowId: string) => page.getByTestId(`list-row-trailing-${rowId}`),
  trailingCells: (page: Page, rowId: string) =>
    page.getByTestId(`list-row-trailing-${rowId}`).locator('.list-property-cell'),
  peekButton: (page: Page, rowId: string) => page.getByTestId(`list-row-peek-${rowId}`),
  groupHeaders: (page: Page) => page.locator('[data-testid^="list-group-header-"]'),
  groupRows: (page: Page, groupId: string) =>
    page.locator(`section[data-group-id="${groupId}"] [data-testid^="list-row-"][data-row-id]`),
  collapseToggle: (header: Locator) => header.getByTestId('list-group-collapse-toggle'),
  collapseIcon: (header: Locator) => header.getByTestId('list-group-collapse-icon'),
};

type Box = { height: number; width: number; x: number; y: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();

  if (!box) throw new Error(`${locator} has no layout box`);
  return box;
}

function rightOf(box: Box): number {
  return box.x + box.width;
}

function bottomOf(box: Box): number {
  return box.y + box.height;
}

/** Resolves a semantic token through a probe element, so the assertion holds in every theme. */
async function resolvedToken(page: Page, property: 'backgroundColor' | 'color', token: string): Promise<string> {
  return page.evaluate(
    ([cssProperty, cssToken]) => {
      const probe = document.createElement('span');

      probe.style[cssProperty] = `var(${cssToken})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe)[cssProperty];

      probe.remove();
      return value;
    },
    [property, token] as const
  );
}

async function seedRevampTitles(page: Page): Promise<void> {
  const rowCount = await activeRowOrderCount(page);
  const titles = Array.from({ length: rowCount }, (_, index) => REVAMP_ROW_TITLES[index] ?? `Revamp row ${index + 1}`);

  await seedPrimaryTitles(page, titles);
  await expect(DatabaseGridSelectors.grid(page)).toContainText(titles[0], { timeout: 20_000 });
}

async function listRowIdByTitle(page: Page, title: string): Promise<string> {
  const row = DatabaseListSelectors.rows(page).filter({ hasText: title }).first();

  await expect(row).toBeVisible({ timeout: 15_000 });
  const rowId = await row.getAttribute('data-row-id');

  if (!rowId) throw new Error(`The List row "${title}" did not expose a row ID`);
  return rowId;
}

async function fieldIdByName(page: Page, name: string): Promise<string> {
  const field = (await activeViewFields(page)).find((candidate) => candidate.name === name);

  if (!field) throw new Error(`The active view has no property named "${name}"`);
  return field.id;
}

/** Parks the pointer on the active view tab: outside every row, its gutter and the peek button. */
async function leaveListRows(page: Page): Promise<void> {
  await DatabaseViewSelectors.activeViewTab(page).hover();
}

async function groupListByField(page: Page, fieldId: string): Promise<void> {
  await page.getByTestId('database-actions-settings').click();
  const trigger = page.getByTestId('list-group-settings-trigger');

  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
  await expect(page.getByTestId('list-group-settings-menu')).toBeVisible();
  await page.getByTestId(`list-group-by-field-${fieldId}`).click();
  await closeDatabaseSettings(page);
  await expect(ListRevampLocators.groupHeaders(page).first()).toBeVisible({ timeout: 15_000 });
}

/** Picks the first workspace member through the grid's Person menu; the member list loads from the server. */
async function assignFirstMemberInGrid(page: Page, rowId: string, fieldId: string): Promise<void> {
  const gridCell = DatabaseGridSelectors.cellByIds(page, rowId, fieldId);

  await gridCell.scrollIntoViewIfNeeded();
  await gridCell.click();
  await expect(PersonSelectors.personCellMenu(page)).toBeVisible({ timeout: 10_000 });
  const option = page.locator('[data-testid^="person-option-"]').first();

  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expect(gridCell.locator('[data-slot="avatar"]').first()).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(PersonSelectors.personCellMenu(page)).toBeHidden();
}

/**
 * Desktop flips to the narrow layout once `maxWidth - leadingWidth < 480`. The
 * web measures the List box once and tells every row, so the viewport shrinks
 * step by step until the rows report it; the width at which the outline drawer
 * closes is not hard-coded.
 */
async function shrinkViewportUntilNarrow(page: Page, row: Locator): Promise<number> {
  for (const width of [900, 760, 640, 560, 480]) {
    await page.setViewportSize({ height: 800, width });

    // Closing the responsive sidebar animates the content width. A row can
    // briefly become narrow and then wide again, so wait for stable geometry
    // before deciding whether this viewport is narrow enough.
    let previous = '';
    let stableSamples = 0;

    await expect
      .poll(
        async () => {
          const current = await row.evaluate((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();

            return JSON.stringify([element.getAttribute('data-layout'), x, y, width, height]);
          });

          stableSamples = current === previous ? stableSamples + 1 : 0;
          previous = current;
          return stableSamples;
        },
        { intervals: [100], message: 'List row geometry settles after resizing the viewport' }
      )
      .toBeGreaterThanOrEqual(5);

    if ((await row.getAttribute('data-layout')) === 'narrow') return width;
  }

  throw new Error('No viewport width switched the List rows to the narrow layout');
}

test.describe('List revamp (desktop PR #1475)', () => {
  test.beforeEach(async ({ page, request }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 800, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
    await seedRevampTitles(page);
  });

  test('list_row.dart: wide rows keep the 8px/8px content box with right-anchored, primary-colored properties', async ({
    page,
  }) => {
    await addListView(page);
    const rowId = await listRowIdByTitle(page, 'Revamp Amber');
    // Created directly after the List exists, so the List shows them without a Properties round trip.
    const numberFieldId = await createFieldDirect(page, { fieldType: FieldType.Number, name: 'Estimate' });
    const dateFieldId = await createFieldDirect(page, { fieldType: FieldType.DateTime, name: 'Due' });

    await setCellDirect(page, rowId, numberFieldId, FieldType.Number, '42');
    await setCellDirect(page, rowId, dateFieldId, FieldType.DateTime, '1735689600', { include_time: false });

    const row = DatabaseListSelectors.rowById(page, rowId);
    const content = ListRevampLocators.content(page, rowId);
    const trailingCells = ListRevampLocators.trailingCells(page, rowId);
    const numberCell = page.getByTestId(`list-field-${numberFieldId}-${rowId}`);

    await expect(numberCell).toContainText('42');
    // Type and Done (default positions 1-2) plus the two properties created above.
    await expect(trailingCells).toHaveCount(4);
    await expect(trailingCells.last()).toHaveAttribute('data-field-id', dateFieldId);
    await expect(row).toHaveAttribute('data-layout', 'wide');

    expect(
      await content.evaluate((element) => {
        const style = getComputedStyle(element);

        return { borderRadius: style.borderRadius, flexDirection: style.flexDirection, padding: style.padding };
      })
    ).toEqual({ borderRadius: LIST_ROW_RADIUS, flexDirection: 'row', padding: `${LIST_ROW_PADDING}px` });

    const rowBox = await boxOf(row);
    const contentBox = await boxOf(content);
    const lastCellBox = await boxOf(trailingCells.last());

    expect(Math.abs(rowBox.height - LIST_WIDE_ROW_HEIGHT)).toBeLessThanOrEqual(1);
    expect(Math.abs(contentBox.height - LIST_WIDE_ROW_HEIGHT)).toBeLessThanOrEqual(1);
    // SingleChildScrollView(reverse: true): cells that fit sit flush against the padding edge.
    expect(Math.abs(rightOf(lastCellBox) - (rightOf(contentBox) - LIST_ROW_PADDING))).toBeLessThanOrEqual(1);
    // Padding(left: spacing.l) before every trailing cell, the first one included.
    expect(await trailingCells.evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).paddingLeft))).toEqual([
      '12px',
      '12px',
      '12px',
      '12px',
    ]);

    // desktopListCardCellStyleMap: caption.standard (12/18) in textColorScheme.primary, no longer the hint color.
    const numberStyle = await numberCell
      .locator(':scope > *')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);

        return { color: style.color, fontSize: style.fontSize, lineHeight: style.lineHeight };
      });
    const [primary, secondary] = await Promise.all([
      resolvedToken(page, 'color', '--text-primary'),
      resolvedToken(page, 'color', '--text-secondary'),
    ]);

    expect(numberStyle).toEqual({ color: primary, fontSize: '12px', lineHeight: '18px' });
    expect(primary).not.toBe(secondary);

    // The hover fill (fillColorScheme.contentHover) follows the whole row, like desktop's MouseRegion.
    const idleFill = await content.evaluate((element) => getComputedStyle(element).backgroundColor);
    const hoverFill = await resolvedToken(page, 'backgroundColor', '--fill-content-hover');

    expect(hoverFill).not.toBe(idleFill);
    await row.hover();
    await expect.poll(() => content.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(hoverFill);
  });

  test('list_row.dart: the hover peek button is a 20px ghost button after the title that opens the side peek', async ({
    page,
  }) => {
    await addListView(page);
    const rowId = await listRowIdByTitle(page, 'Revamp Birch');
    const row = DatabaseListSelectors.rowById(page, rowId);
    const peekButton = ListRevampLocators.peekButton(page, rowId);
    const primary = page.getByTestId(`list-primary-cell-${rowId}`);

    // Desktop inserts _PeekButton only while hovering; the web keeps it in the DOM but hidden.
    await expect(peekButton).toBeAttached();
    await expect(peekButton).toBeHidden();

    await row.hover();
    await expect(peekButton).toBeVisible();
    await expect(peekButton).toHaveAttribute('aria-label', 'Open as side peek');
    const peekBox = await boxOf(peekButton);
    const primaryBox = await boxOf(primary);

    // FlowySvg side_peek_s at 20px with EdgeInsets.zero, HSpace(spacing.s) after the title.
    expect(Math.abs(peekBox.width - 20)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(peekBox.height - 20)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(peekBox.x - rightOf(primaryBox) - 6)).toBeLessThanOrEqual(2);
    expect(await peekButton.evaluate((element) => getComputedStyle(element).borderRadius)).toBe(LIST_ROW_RADIUS);

    await leaveListRows(page);
    await expect(peekButton).toBeHidden();

    await row.hover();
    await expect(peekButton).toBeVisible();
    await peekButton.click();
    await expectPeekOpen(page, 'side', 'Revamp Birch');
    // The side peek is nonmodal: the List stays on screen next to it.
    await expect(DatabaseListSelectors.list(page)).toBeVisible();
    await closeRowDetailWithEscape(page);
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0, { timeout: 15_000 });
  });

  test('list_row.dart: below kListRowNarrowBreakpoint the properties stack under the title with a 12px indent', async ({
    page,
  }) => {
    await addListView(page);
    const rowId = await listRowIdByTitle(page, 'Revamp Amber');
    const numberFieldId = await createFieldDirect(page, { fieldType: FieldType.Number, name: 'Estimate' });

    await setCellDirect(page, rowId, numberFieldId, FieldType.Number, '42');
    // Leave one property line so the first trailing cell has text to measure.
    await openDatabaseProperties(page);
    await ensurePropertyHidden(page, await fieldIdByName(page, 'Type'));
    await ensurePropertyHidden(page, await fieldIdByName(page, 'Done'));
    await closeDatabaseSettings(page);

    const row = DatabaseListSelectors.rowById(page, rowId);
    const content = ListRevampLocators.content(page, rowId);
    const title = ListRevampLocators.title(page, rowId);
    const trailing = ListRevampLocators.trailing(page, rowId);
    const numberCell = page.getByTestId(`list-field-${numberFieldId}-${rowId}`);

    await expect(numberCell).toContainText('42');
    await expect(ListRevampLocators.trailingCells(page, rowId)).toHaveCount(1);
    await expect(row).toHaveAttribute('data-layout', 'wide');

    await shrinkViewportUntilNarrow(page, row);
    // One List-level measurement reaches every mounted row.
    await expect
      .poll(() =>
        DatabaseListSelectors.rows(page).evaluateAll((rows) =>
          rows.every((element) => element.getAttribute('data-layout') === 'narrow')
        )
      )
      .toBe(true);
    expect(await content.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('column');
    // Left-anchored (reverse: false) on the second line.
    expect(await trailing.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('row');

    const rowBox = await boxOf(row);
    const contentBox = await boxOf(content);
    const titleBox = await boxOf(title);
    const trailingBox = await boxOf(trailing);
    const cellBox = await boxOf(numberCell);
    const cellTextBox = await boxOf(numberCell.locator(':scope > *').first());

    // Column(title row, SizedBox(height: spacing.s), properties): 8 + 20 + 6 + 20 + 8.
    expect(Math.abs(rowBox.height - LIST_NARROW_ROW_HEIGHT)).toBeLessThanOrEqual(1);
    expect(Math.abs(titleBox.width - (contentBox.width - 2 * LIST_ROW_PADDING))).toBeLessThanOrEqual(1);
    expect(trailingBox.y).toBeGreaterThanOrEqual(bottomOf(titleBox) + 5);
    // The first cell's 12px left padding indents the property line relative to the title.
    expect(Math.abs(cellBox.x - titleBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(cellTextBox.x - (titleBox.x + 12))).toBeLessThanOrEqual(1);

    await page.setViewportSize({ height: 800, width: 1440 });
    await expect(row).toHaveAttribute('data-layout', 'wide');
    await expect.poll(async () => (await boxOf(row)).height).toBeLessThanOrEqual(LIST_WIDE_ROW_HEIGHT + 1);
  });

  test('list_row.dart: an overflowing trailing strip keeps its right end visible and scrolls with the wheel', async ({
    page,
  }) => {
    await addListView(page);
    const rowId = await listRowIdByTitle(page, 'Revamp Amber');

    await setPrimaryCellTextDirect(page, rowId, 'Revamp Amber with a deliberately long title that takes real room');
    // A long text property before a short one: the strip overflows while its last cell stays short.
    const notesFieldId = await createFieldDirect(page, { fieldType: FieldType.RichText, name: 'Notes' });
    const numberFieldId = await createFieldDirect(page, { fieldType: FieldType.Number, name: 'Estimate' });

    await setSelectCellDirect(page, rowId, 'Type', 'Design');
    await setCellDirect(page, rowId, notesFieldId, FieldType.RichText, 'overflow '.repeat(60).trim());
    await setCellDirect(page, rowId, numberFieldId, FieldType.Number, '42');

    const row = DatabaseListSelectors.rowById(page, rowId);
    const trailing = ListRevampLocators.trailing(page, rowId);
    const cells = ListRevampLocators.trailingCells(page, rowId);
    const metrics = () =>
      trailing.evaluate((element: HTMLElement) => ({
        clientWidth: element.clientWidth,
        scrollLeft: element.scrollLeft,
        scrollWidth: element.scrollWidth,
        scrollbarHeight: element.offsetHeight - element.clientHeight,
      }));

    await expect(page.getByTestId(`list-field-${numberFieldId}-${rowId}`)).toContainText('42');
    await expect(cells).toHaveCount(4);
    await expect(cells.last()).toHaveAttribute('data-field-id', numberFieldId);
    await expect(row).toHaveAttribute('data-layout', 'wide');

    const before = await metrics();

    expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);
    // reverse: true. Offset 0 is the right end, and no classic scrollbar eats the 20px strip.
    expect(before.scrollLeft).toBe(0);
    expect(before.scrollbarHeight).toBe(0);

    const stripBox = await boxOf(trailing);
    const lastBox = await boxOf(cells.last());
    const firstBox = await boxOf(cells.first());

    expect(lastBox.x).toBeGreaterThanOrEqual(stripBox.x - 0.5);
    expect(Math.abs(rightOf(lastBox) - rightOf(stripBox))).toBeLessThanOrEqual(1);
    expect(firstBox.x).toBeLessThan(stripBox.x);
    expect(Math.abs((await boxOf(row)).height - LIST_WIDE_ROW_HEIGHT)).toBeLessThanOrEqual(1);

    // Hovering adds the peek button to the title row; measure the clipped cell after that.
    await trailing.hover();
    const firstHoveredBox = await boxOf(cells.first());

    // A horizontal wheel delta (trackpad, or Shift+wheel on a mouse) scrolls the hidden overflow back in.
    await page.mouse.wheel(-240, 0);
    await expect.poll(async () => (await metrics()).scrollLeft, { timeout: 5_000 }).not.toBe(0);
    await expect.poll(async () => (await boxOf(cells.first())).x, { timeout: 5_000 }).toBeGreaterThan(firstHoveredBox.x);
  });

  test('desktop_list_card_cell_style.dart: Person cells show 20px avatars only and keep the name for screen readers', async ({
    page,
  }) => {
    const gridViewId = await activeViewId(page);
    const listViewId = await addListView(page);
    const rowId = await listRowIdByTitle(page, 'Revamp Amber');
    const personFieldId = await createFieldDirect(page, { fieldType: FieldType.Person, name: 'Owner' });

    await switchToView(page, gridViewId, 'Grid');
    await assignFirstMemberInGrid(page, rowId, personFieldId);
    await switchToView(page, listViewId, 'List');

    const listCell = page.getByTestId(`list-field-${personFieldId}-${rowId}`);
    const avatar = listCell.locator('[data-slot="avatar"]').first();
    const name = listCell.locator('.person-cell-name').first();

    await expect(avatar).toBeVisible({ timeout: 15_000 });
    const avatarBox = await boxOf(avatar);
    const cellBox = await boxOf(listCell);

    // PersonCardCellStyle(hideName: true): a 20px AFAvatar and nothing else after the 12px cell padding.
    expect(Math.abs(avatarBox.width - 20)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(avatarBox.height - 20)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(cellBox.width - 12 - avatarBox.width)).toBeLessThanOrEqual(1);
    // The name stays in the DOM for screen readers (Tailwind sr-only), not as visible text.
    await expect(name).toBeAttached();
    await expect(name).not.toBeEmpty();
    expect(
      await name.evaluate((element) => {
        const style = getComputedStyle(element);

        return { clip: style.clip, height: style.height, position: style.position, width: style.width };
      })
    ).toEqual({ clip: 'rect(0px, 0px, 0px, 0px)', height: '1px', position: 'absolute', width: '1px' });
  });

  test('group_header.dart and list_group_widgets.dart: a 24px filled-arrow collapse toggle and a borderless footer', async ({
    page,
  }) => {
    const typeFieldId = await fieldIdByName(page, 'Type');

    await addListView(page);
    const amberRowId = await listRowIdByTitle(page, 'Revamp Amber');
    const birchRowId = await listRowIdByTitle(page, 'Revamp Birch');

    await setSelectCellDirect(page, amberRowId, 'Type', 'Design');
    await setSelectCellDirect(page, birchRowId, 'Type', 'Build');
    await groupListByField(page, typeFieldId);

    const header = ListRevampLocators.groupHeaders(page).filter({ hasText: 'Design' }).first();

    await expect(header).toBeVisible({ timeout: 15_000 });
    const groupId = await header.getAttribute('data-group-id');

    if (!groupId) throw new Error('The Design group header did not expose a group ID');

    const toggle = ListRevampLocators.collapseToggle(header);
    const icon = ListRevampLocators.collapseIcon(header);
    const groupRows = ListRevampLocators.groupRows(page, groupId);
    const footer = DatabaseListSelectors.groupFooterById(page, groupId);

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(icon).toHaveAttribute('data-collapsed', 'false');
    await expect(groupRows).toHaveCount(1);

    // AFGhostButton.normal(size m, padding 2) around a 20px FlowySvg arrow_down_filled_s.
    const toggleBox = await boxOf(toggle);
    const iconBox = await boxOf(icon);
    const labelBox = await boxOf(header.getByTestId('list-group-option-tag'));

    expect(Math.abs(toggleBox.width - 24)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(toggleBox.height - 24)).toBeLessThanOrEqual(0.5);
    expect(await toggle.evaluate((element) => getComputedStyle(element).borderRadius)).toBe(LIST_ROW_RADIUS);
    expect(Math.abs(iconBox.width - 20)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(iconBox.height - 20)).toBeLessThanOrEqual(0.5);
    // 24px button + HSpace(spacing.m): the name still starts 32px into the header.
    expect(Math.abs(labelBox.x - (toggleBox.x + 32))).toBeLessThanOrEqual(1);

    // ListGroupFooter lost its bottom border and keeps its 36px "New row" button.
    expect(
      await footer.evaluate((element) => {
        const style = getComputedStyle(element);

        return { borderBottomWidth: style.borderBottomWidth, height: style.height };
      })
    ).toEqual({ borderBottomWidth: '0px', height: '36px' });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(icon).toHaveAttribute('data-collapsed', 'true');
    await expect(groupRows).toHaveCount(0);
    await expect(footer).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(icon).toHaveAttribute('data-collapsed', 'false');
    await expect(groupRows).toHaveCount(1);
    await expect(footer).toBeVisible();
  });
});
