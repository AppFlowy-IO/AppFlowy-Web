import { expect, type Page, test } from '@playwright/test';

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
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { waitForDatabaseTestContext } from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import {
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
  FieldType,
  itemDirectChildPageItems,
  PageSelectors,
  RowDetailSelectors,
  viewIdFromPageTestId,
} from '../../support/selectors';

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

    for (const [index, field] of listFields.entries()) {
      await expect(page.getByTestId(`database-property-${field.id}`)).toBeAttached();
      await expect(page.getByTestId(`database-property-visibility-${field.id}`)).toHaveAttribute(
        'aria-label',
        field.isPrimary || index < 3 ? /^Hide / : /^Show /
      );
      if (!field.isPrimary) await ensurePropertyVisible(page, field.id);
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
