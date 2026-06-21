import { expect, Page } from '@playwright/test';

import { createDatabaseView, waitForGridReady } from './database-ui-helpers';
import { renameCurrentPage } from './duplicate-test-helpers';
import { typeTextIntoCell } from './field-type-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  FieldType,
  GridFieldSelectors,
  PageSelectors,
  PropertyMenuSelectors,
  RowDetailSelectors,
} from './selectors';
import { waitForDatabaseDocReady } from './yjs-inject-helpers';

export enum RelationLimit {
  NoLimit = 0,
  OneOnly = 1,
}

export enum RelationFilterCondition {
  RelationIsEmpty = 0,
  RelationIsNotEmpty = 1,
  RelationContains = 2,
  RelationDoesNotContain = 3,
}

export interface DatabaseFixtureInfo {
  databaseId: string;
  pageId: string;
  viewId: string;
  rowIds: string[];
  primaryFieldId: string;
}

interface RelationFieldOptions {
  fieldName: string;
  relatedDatabaseId: string;
  isTwoWay?: boolean;
  reciprocalFieldId?: string;
  reciprocalFieldName?: string;
  sourceLimit?: RelationLimit;
  targetLimit?: RelationLimit;
}

function makeTestId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function waitForDatabaseTestContext(page: Page): Promise<void> {
  await waitForDatabaseDocReady(page);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const win = window as any;
          const ctx = win.__TEST_DATABASE_CONTEXT__;

          return Boolean(
            ctx?.databaseDoc &&
              ctx?.activeViewId &&
              ctx?.createRow
          );
        }),
      { timeout: 20000, message: 'Waiting for database test context bridge' }
    )
    .toBe(true);
}

async function waitForActiveDatabasePage(page: Page, pageId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((expectedPageId) => {
          const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
          const titlePageId = document
            .querySelector('[data-testid="page-title-input"]')
            ?.id
            ?.replace('editor-title-', '');

          return Boolean(
            ctx?.databaseDoc &&
              ctx?.activeViewId &&
              (ctx.databasePageId === expectedPageId ||
                ctx.activeViewId === expectedPageId ||
                titlePageId === expectedPageId)
          );
        }, pageId),
      { timeout: 20000, message: `Waiting for database page ${pageId} to become active` }
    )
    .toBe(true);
}

export async function getCurrentDatabaseInfo(page: Page): Promise<DatabaseFixtureInfo> {
  await waitForDatabaseTestContext(page);

  let currentInfo: DatabaseFixtureInfo | null = null;

  await expect
    .poll(
      async () => {
        currentInfo = await page
          .evaluate(() => {
            const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

            if (!ctx?.databaseDoc || !ctx?.activeViewId) return null;

            const doc = ctx.databaseDoc;
            const database = doc.getMap('data').get('database');
            const view = database?.get('views')?.get(ctx.activeViewId);

            if (!database || !view) return null;

            const fieldOrders = view.get('field_orders').toArray() as Array<{ id: string }>;
            const fields = database.get('fields');
            const titlePageId = document
              .querySelector('[data-testid="page-title-input"]')
              ?.id
              ?.replace('editor-title-', '');
            const primaryFieldId =
              fieldOrders.find((order) => Boolean(fields.get(order.id)?.get('is_primary')))?.id || fieldOrders[0]?.id;

            return {
              databaseId: database.get('id') || doc.guid,
              pageId: titlePageId || ctx.databasePageId || ctx.activeViewId,
              viewId: ctx.activeViewId,
              rowIds: view.get('row_orders').toArray().map((row: { id: string }) => row.id),
              primaryFieldId,
            };
          })
          .catch(() => null);

        return Boolean(currentInfo);
      },
      { timeout: 20000, message: 'Waiting for current database info' }
    )
    .toBe(true);

  return currentInfo as DatabaseFixtureInfo;
}

export async function createNamedGridDatabase(
  page: Page,
  pageName: string,
  rowNames: string[]
): Promise<DatabaseFixtureInfo> {
  await createDatabaseView(page, 'Grid', 7000);
  await waitForGridReady(page);
  await renameCurrentDatabasePage(page, pageName);
  await seedPrimaryRows(page, rowNames);
  return getCurrentDatabaseInfo(page);
}

export async function renameCurrentDatabasePage(page: Page, pageName: string): Promise<void> {
  await waitForDatabaseTestContext(page);

  const titleInput = PageSelectors.titleInput(page).first();

  await expect(titleInput).toBeVisible({ timeout: 15000 });

  try {
    await titleInput.fill(pageName);
    await page.keyboard.press('Enter');
    await expect(titleInput).toContainText(pageName, { timeout: 7000 });
  } catch {
    const titleId = await titleInput.getAttribute('id');
    const currentPageId = titleId?.replace('editor-title-', '');
    const renamedViaContext = await page.evaluate(async (name) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const titleViewId = document
        .querySelector('[data-testid="page-title-input"]')
        ?.id
        ?.replace('editor-title-', '');

      if (!ctx?.updatePage || !titleViewId) return false;

      await ctx.updatePage(titleViewId, { name });
      return true;
    }, pageName);

    if (!renamedViaContext && currentPageId) {
      await page.evaluate(async ({ currentPageId, pageName }) => {
        const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

        await ctx?.updatePage?.(currentPageId, { name: pageName });
      }, { currentPageId, pageName });
    } else if (!renamedViaContext) {
      await renameCurrentPage(page, pageName);
    }
  }

  await expect(titleInput).toContainText(pageName, { timeout: 20000 });
  await PageSelectors.itemByName(page, pageName).waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
}

export async function openGridDatabaseByName(page: Page, pageName: string): Promise<DatabaseFixtureInfo> {
  const pageItem = PageSelectors.itemByName(page, pageName);

  await expect(pageItem).toBeVisible({ timeout: 20000 });
  await pageItem.click({ force: true });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          return document.querySelector('[data-testid="page-title-input"]')?.textContent ?? '';
        }),
      { timeout: 20000, message: `Waiting for database page "${pageName}" to become active` }
    )
    .toContain(pageName);
  await waitForGridReady(page);
  await waitForDatabaseTestContext(page);
  return getCurrentDatabaseInfo(page);
}

export async function openGridDatabaseByPageId(page: Page, pageId: string): Promise<DatabaseFixtureInfo> {
  const pageItem = PageSelectors.itemByViewId(page, pageId);

  await expect(pageItem).toBeVisible({ timeout: 20000 });
  await pageItem.click({ force: true });
  await waitForActiveDatabasePage(page, pageId);
  await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
  await waitForDatabaseTestContext(page);
  return getCurrentDatabaseInfo(page);
}

export async function renameDatabasePageByPageIdDirect(page: Page, pageId: string, pageName: string): Promise<void> {
  await waitForDatabaseTestContext(page);
  await page.evaluate(
    async ({ pageName, pageId }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

      if (!ctx?.updatePage) {
        throw new Error('Database test context updatePage bridge is unavailable');
      }

      await ctx.updatePage(pageId, { name: pageName });
    },
    { pageName, pageId }
  );
  await PageSelectors.itemByName(page, pageName).waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
}

export async function seedPrimaryRows(page: Page, rowNames: string[]): Promise<void> {
  await ensureGridRows(page, rowNames.length);
  const { primaryFieldId } = await getCurrentDatabaseInfo(page);

  for (let index = 0; index < rowNames.length; index += 1) {
    await typeTextIntoCell(page, primaryFieldId, index, rowNames[index]);
  }

  for (const rowName of rowNames) {
    await expect(DatabaseGridSelectors.grid(page)).toContainText(rowName, { timeout: 20000 });
  }
}

export async function ensureGridRows(page: Page, minimumRows: number): Promise<void> {
  await waitForGridReady(page);

  while ((await DatabaseGridSelectors.dataRows(page).count()) < minimumRows) {
    await DatabaseGridSelectors.newRowButton(page).scrollIntoViewIfNeeded();
    await DatabaseGridSelectors.newRowButton(page).click({ force: true });
    await page.waitForTimeout(800);
  }
}

export async function createOneWayRelationField(
  page: Page,
  options: RelationFieldOptions
): Promise<string> {
  const fieldId = makeTestId('rel');

  await addRelationFieldToCurrentDatabase(page, fieldId, options);
  await expect(GridFieldSelectors.fieldHeader(page, fieldId).last()).toBeVisible({ timeout: 20000 });
  return fieldId;
}

export async function createTwoWayRelationFields(
  page: Page,
  options: {
    sourceFieldName: string;
    relatedViewId: string;
    relatedDatabaseId: string;
    reciprocalFieldName: string;
    sourceLimit?: RelationLimit;
    reciprocalLimit?: RelationLimit;
  }
): Promise<{ sourceFieldId: string; reciprocalFieldId: string }> {
  const sourceFieldId = makeTestId('rel_src');
  const reciprocalFieldId = makeTestId('rel_dst');

  await page.evaluate(
    async (args) => {
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const sourceDoc = ctx.databaseDoc;
      const sourceDatabase = sourceDoc.getMap('data').get('database');
      const sourceDatabaseId = sourceDatabase.get('id') || sourceDoc.guid;
      const relatedDoc =
        args.relatedViewId === ctx.databasePageId || args.relatedViewId === ctx.activeViewId
          ? sourceDoc
          : await ctx.loadView(args.relatedViewId);
      const relatedDatabase = relatedDoc.getMap('data').get('database');

      function addRelationField(databaseDoc: any, database: any, fieldId: string, fieldName: string, option: any) {
        const Y = win.Y;
        const now = String(Math.floor(Date.now() / 1000));
        const field = new Y.Map();
        const typeOptionMap = new Y.Map();
        const typeOption = new Y.Map();

        field.set('name', fieldName);
        field.set('id', fieldId);
        field.set('ty', 10);
        field.set('created_at', now);
        field.set('last_modified', now);
        field.set('is_primary', false);
        field.set('icon', '');

        typeOption.set('database_id', option.databaseId);
        typeOption.set('is_two_way', true);
        typeOption.set('reciprocal_field_id', option.reciprocalFieldId);
        typeOption.set('reciprocal_field_name', option.reciprocalFieldName);
        typeOption.set('source_limit', option.sourceLimit ?? 0);
        typeOption.set('target_limit', option.targetLimit ?? 0);
        typeOptionMap.set('10', typeOption);
        field.set('type_option', typeOptionMap);

        databaseDoc.transact(() => {
          database.get('fields').set(fieldId, field);
          database.get('views').forEach((view: any) => {
            const fieldOrders = view.get('field_orders');
            const alreadyOrdered = fieldOrders.toArray().some((order: { id: string }) => order.id === fieldId);

            if (!alreadyOrdered) {
              fieldOrders.push([{ id: fieldId }]);
            }

            const fieldSettings = view.get('field_settings');

            if (!fieldSettings.get(fieldId)) {
              const setting = new Y.Map();

              setting.set('visibility', 0);
              fieldSettings.set(fieldId, setting);
            }
          });
        });
      }

      addRelationField(sourceDoc, sourceDatabase, args.sourceFieldId, args.sourceFieldName, {
        databaseId: args.relatedDatabaseId,
        reciprocalFieldId: args.reciprocalFieldId,
        reciprocalFieldName: args.reciprocalFieldName,
        sourceLimit: args.sourceLimit,
      });

      addRelationField(relatedDoc, relatedDatabase, args.reciprocalFieldId, args.reciprocalFieldName, {
        databaseId: sourceDatabaseId,
        reciprocalFieldId: args.sourceFieldId,
        reciprocalFieldName: args.sourceFieldName,
        sourceLimit: args.reciprocalLimit,
      });
    },
    {
      ...options,
      sourceFieldId,
      reciprocalFieldId,
      sourceLimit: options.sourceLimit ?? RelationLimit.NoLimit,
      reciprocalLimit: options.reciprocalLimit ?? RelationLimit.NoLimit,
    }
  );

  await expect(GridFieldSelectors.fieldHeader(page, sourceFieldId).last()).toBeVisible({ timeout: 20000 });
  return { sourceFieldId, reciprocalFieldId };
}

export async function setRelationCellDirect(
  page: Page,
  fieldId: string,
  rowIndex: number,
  targetRowIds: string[]
): Promise<void> {
  await page.evaluate(
    async ({ fieldId, rowIndex, targetRowIds, relationFieldType }) => {
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const Y = win.Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const databaseId = database.get('id') || doc.guid;
      const view = database.get('views').get(ctx.activeViewId);
      const rowId = view.get('row_orders').toArray()[rowIndex].id;
      let rowDoc = ctx.rowMap?.[rowId];

      if (!rowDoc && ctx.ensureRow) {
        rowDoc = await ctx.ensureRow(rowId);
      }

      if (!rowDoc) {
        rowDoc = await ctx.createRow(`${databaseId}_rows_${rowId}`);
      }

      rowDoc.transact(() => {
        const now = String(Math.floor(Date.now() / 1000));
        const root = rowDoc.getMap('data');
        const row = root.get('data');
        const cells = row.get('cells');
        let cell = cells.get(fieldId);

        if (!cell) {
          cell = new Y.Map();
          cells.set(fieldId, cell);
        }

        const data = new Y.Array();

        if (targetRowIds.length > 0) {
          data.push(targetRowIds);
        }

        cell.set('created_at', cell.get('created_at') || now);
        cell.set('last_modified', now);
        cell.set('field_type', relationFieldType);
        cell.set('data', data);
        row.set('last_modified', now);
      });
    },
    { fieldId, rowIndex, targetRowIds, relationFieldType: FieldType.Relation }
  );
}

/**
 * Test-only helper. Replaces *all* existing filters on the active view with a
 * single relation filter (or an advanced wrapper around it). Use this to seed
 * a known-good filter state — it does NOT exercise the production filter UI.
 */
export async function setOnlyRelationFilterDirect(
  page: Page,
  fieldId: string,
  condition: RelationFilterCondition,
  targetRowIds: string[] = [],
  options: { advanced?: boolean } = {}
): Promise<string> {
  const filterId = makeTestId('rel_filter');

  await waitForDatabaseTestContext(page);
  await page.evaluate(
    ({ condition, fieldId, filterId, targetRowIds, advanced, relationFieldType }) => {
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const Y = win.Y;

      if (!ctx?.databaseDoc || !ctx?.activeViewId) {
        throw new Error('Database test context bridge is unavailable');
      }

      const database = ctx.databaseDoc.getMap('data').get('database');
      const view = database.get('views').get(ctx.activeViewId);
      let filters = view.get('filters');

      if (!filters) {
        filters = new Y.Array();
        view.set('filters', filters);
      }

      const createFilter = () => {
        const filter = new Y.Map();

        filter.set('id', filterId);
        filter.set('field_id', fieldId);
        filter.set('condition', condition);
        filter.set('content', targetRowIds.length > 0 ? JSON.stringify(targetRowIds) : '');
        filter.set('ty', relationFieldType);
        filter.set('filter_type', 2);
        return filter;
      };

      filters.delete(0, filters.length);

      if (advanced) {
        const root = new Y.Map();
        const children = new Y.Array();

        root.set('id', `${filterId}_root`);
        root.set('filter_type', 0);
        children.push([createFilter()]);
        root.set('children', children);
        filters.push([root]);
        return;
      }

      filters.push([createFilter()]);
    },
    {
      condition,
      fieldId,
      filterId,
      targetRowIds,
      advanced: options.advanced ?? false,
      relationFieldType: FieldType.Relation,
    }
  );

  return filterId;
}

/**
 * @deprecated Use `setOnlyRelationFilterDirect` — same behavior, clearer name.
 * Kept as an alias for backwards compatibility with existing test files.
 */
export const addRelationFilterDirect = setOnlyRelationFilterDirect;

export async function updateRelationFilterDirect(
  page: Page,
  filterId: string,
  updates: {
    condition?: RelationFilterCondition;
    targetRowIds?: string[];
  }
): Promise<void> {
  await waitForDatabaseTestContext(page);
  await page.evaluate(
    ({ filterId, updates }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

      if (!ctx?.databaseDoc || !ctx?.activeViewId) {
        throw new Error('Database test context bridge is unavailable');
      }

      const database = ctx.databaseDoc.getMap('data').get('database');
      const view = database.get('views').get(ctx.activeViewId);
      const filters = view.get('filters');

      const findFilter = (nodes: any[]): any => {
        for (const node of nodes) {
          if (node?.get?.('id') === filterId) return node;
          const children = node?.get?.('children');
          if (children) {
            const found = findFilter(children.toArray());
            if (found) return found;
          }
        }

        return null;
      };

      const filter = filters ? findFilter(filters.toArray()) : null;

      if (!filter) {
        throw new Error(`Relation filter ${filterId} not found`);
      }

      if (updates.condition !== undefined) {
        filter.set('condition', updates.condition);
      }

      if (updates.targetRowIds !== undefined) {
        filter.set('content', updates.targetRowIds.length > 0 ? JSON.stringify(updates.targetRowIds) : '');
      }
    },
    { filterId, updates }
  );
}

export async function convertCurrentFiltersToAdvancedDirect(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as any;
    const ctx = win.__TEST_DATABASE_CONTEXT__;
    const Y = win.Y;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    const filters = view.get('filters');

    if (!filters || filters.length === 0) return;

    const firstFilter = filters.get(0);
    if (Number(firstFilter?.get?.('filter_type')) === 0 || Number(firstFilter?.get?.('filter_type')) === 1) return;

    const root = new Y.Map();
    const children = new Y.Array();

    root.set('id', `advanced_root_${Date.now()}`);
    root.set('filter_type', 0);
    filters.toArray().forEach((filter: any) => {
      const clone = new Y.Map();

      filter.forEach((value: unknown, key: string) => {
        clone.set(key, value);
      });
      children.push([clone]);
    });
    root.set('children', children);
    filters.delete(0, filters.length);
    filters.push([root]);
  });
}

export async function deleteCurrentDatabaseRowDirect(page: Page, rowId: string): Promise<void> {
  await waitForDatabaseTestContext(page);
  await page.evaluate((rowId) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

    if (!ctx?.databaseDoc) {
      throw new Error('Database test context bridge is unavailable');
    }

    const database = ctx.databaseDoc.getMap('data').get('database');

    database.get('views').forEach((view: any) => {
      const rows = view.get('row_orders');
      const index = rows.toArray().findIndex((row: { id: string }) => row.id === rowId);

      if (index >= 0) {
        rows.delete(index);
      }
    });
  }, rowId);
}

export async function expectVisibleRowCount(page: Page, count: number): Promise<void> {
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(count, { timeout: 20000 });
}

export async function expectGridRowsVisible(page: Page, rowIds: string[]): Promise<void> {
  for (const rowId of rowIds) {
    await expect(DatabaseGridSelectors.rowById(page, rowId)).toBeVisible({ timeout: 20000 });
  }
}

export async function expectGridRowsHidden(page: Page, rowIds: string[]): Promise<void> {
  for (const rowId of rowIds) {
    await expect(DatabaseGridSelectors.rowById(page, rowId)).toHaveCount(0, { timeout: 20000 });
  }
}

export async function deleteFieldFromGridHeader(page: Page, fieldId: string): Promise<void> {
  await GridFieldSelectors.fieldHeader(page, fieldId).last().click({ force: true });
  await expect(page.locator('[role="menuitem"]').filter({ hasText: /^Delete$/i }).first()).toBeVisible({
    timeout: 10000,
  });
  await page.locator('[role="menuitem"]').filter({ hasText: /^Delete$/i }).first().click();

  const confirmDialog = page.getByRole('dialog').filter({ hasText: /Are you sure\?/i });
  const confirmButton = confirmDialog.getByRole('button', { name: /^Delete$/i });

  await expect(confirmButton).toBeEnabled({ timeout: 10000 });
  await confirmButton.click();
  await expect(confirmDialog).toBeHidden({ timeout: 10000 });
  await expect(GridFieldSelectors.fieldHeader(page, fieldId)).toHaveCount(0, { timeout: 20000 });
}

export async function expectFieldHeaderHidden(page: Page, fieldId: string): Promise<void> {
  await expect(GridFieldSelectors.fieldHeader(page, fieldId)).toHaveCount(0, { timeout: 20000 });
}

/**
 * Returns the field IDs in the active database's order (visible + ordered).
 * Reads directly from the YJS context so it doesn't depend on grid header
 * rendering for determining "what fields exist".
 */
export async function getDatabaseFieldIdsDirect(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    const fieldOrders = view.get('field_orders').toArray() as Array<{ id: string }>;

    return fieldOrders.map((order) => order.id).filter((id) => Boolean(database.get('fields').get(id)));
  });
}

/**
 * Returns the numeric field type for a given field id in the active database.
 */
export async function getFieldTypeDirect(page: Page, fieldId: string): Promise<number | null> {
  return page.evaluate((fieldId) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const field = database.get('fields').get(fieldId);

    if (!field) return null;
    const type = field.get('ty');

    return type === undefined ? null : Number(type);
  }, fieldId);
}

/**
 * Drives the production "Add property → Relation" UI flow:
 *   1. Click + new property in the active grid.
 *   2. Hover the property type submenu trigger.
 *   3. Click the Relation option, which opens RelationCreationDialog.
 *   4. Pick the target database from the candidate list.
 *   5. Submit the dialog.
 * Returns the new field id (the field that appeared after submit).
 */
export async function createRelationViaCreationDialog(
  page: Page,
  args: { relatedDatabaseId: string; relatedDatabaseName: string }
): Promise<string> {
  const before = new Set(await getDatabaseFieldIdsDirect(page));

  await PropertyMenuSelectors.newPropertyButton(page).first().scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="grid-new-property-button"]');

    if (el) (el as HTMLElement).click();
  });

  const trigger = PropertyMenuSelectors.propertyTypeTrigger(page).first();

  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click({ force: true });
  await PropertyMenuSelectors.propertyTypeOption(page, FieldType.Relation).waitFor({
    state: 'visible',
    timeout: 10000,
  });
  await PropertyMenuSelectors.propertyTypeOption(page, FieldType.Relation).click({ force: true });

  const dialog = page.getByTestId('relation-creation-dialog');

  await expect(dialog).toBeVisible({ timeout: 15000 });

  const candidate = page.getByTestId(`relation-candidate-${args.relatedDatabaseId}`);

  await expect(candidate).toBeVisible({ timeout: 15000 });
  await candidate.click({ force: true });

  await page.getByTestId('modal-ok-button').last().click({ force: true });
  await expect(dialog).toBeHidden({ timeout: 15000 });

  let newFieldId = '';

  await expect
    .poll(
      async () => {
        const after = await getDatabaseFieldIdsDirect(page);
        const fresh = after.find((id) => !before.has(id));

        if (fresh) {
          newFieldId = fresh;
          return true;
        }

        return false;
      },
      { timeout: 20000, message: 'Waiting for new relation field to appear' }
    )
    .toBe(true);

  return newFieldId;
}

/**
 * Switches an existing field to a different field type via the Property menu.
 * Used to exercise `useSwitchPropertyType` end-to-end (and its round-3
 * fire-and-forget reciprocal cleanup when leaving Relation).
 */
export async function switchFieldTypeViaPropertyMenu(
  page: Page,
  fieldId: string,
  fieldType: number
): Promise<void> {
  await GridFieldSelectors.fieldHeader(page, fieldId).last().click({ force: true });
  await expect(PropertyMenuSelectors.editPropertyMenuItem(page).first()).toBeVisible({ timeout: 10000 });
  await PropertyMenuSelectors.editPropertyMenuItem(page).first().click({ force: true });

  const trigger = PropertyMenuSelectors.propertyTypeTrigger(page).first();

  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click({ force: true });
  await PropertyMenuSelectors.propertyTypeOption(page, fieldType).waitFor({
    state: 'visible',
    timeout: 10000,
  });
  await PropertyMenuSelectors.propertyTypeOption(page, fieldType).click({ force: true });

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect.poll(() => getFieldTypeDirect(page, fieldId), { timeout: 15000 }).toBe(fieldType);
}

/**
 * Drives the Property menu "Duplicate" action and returns the new (copy) field id.
 */
export async function duplicateFieldViaPropertyMenu(page: Page, fieldId: string): Promise<string> {
  const before = new Set(await getDatabaseFieldIdsDirect(page));

  await GridFieldSelectors.fieldHeader(page, fieldId).last().click({ force: true });
  await expect(page.locator('[role="menuitem"]').filter({ hasText: /^Duplicate$/i }).first()).toBeVisible({
    timeout: 10000,
  });
  await page.locator('[role="menuitem"]').filter({ hasText: /^Duplicate$/i }).first().click({ force: true });

  let newFieldId = '';

  await expect
    .poll(
      async () => {
        const after = await getDatabaseFieldIdsDirect(page);
        const fresh = after.find((id) => !before.has(id));

        if (fresh) {
          newFieldId = fresh;
          return true;
        }

        return false;
      },
      { timeout: 20000, message: 'Waiting for duplicated field to appear' }
    )
    .toBe(true);

  return newFieldId;
}

/**
 * Returns whether a field with the given id currently exists in the active
 * database's fields map. Useful for cross-database verification (open the
 * other database via openGridDatabaseByPageId, then call this).
 *
 * Waits up to 10s for the test context to settle — back-to-back grid
 * navigations occasionally land on a transient frame where
 * `__TEST_DATABASE_CONTEXT__` has been deleted by the outgoing provider's
 * cleanup before the incoming provider's effect re-publishes it.
 */
export async function fieldExistsDirect(page: Page, fieldId: string): Promise<boolean> {
  let result = false;

  await expect
    .poll(
      async () => {
        const status = await page.evaluate((id) => {
          const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

          if (!ctx?.databaseDoc) return null;
          const database = ctx.databaseDoc.getMap('data').get('database');

          return Boolean(database?.get?.('fields')?.get?.(id));
        }, fieldId);

        if (status === null) return null;
        result = Boolean(status);
        return 'ok';
      },
      { timeout: 10000, message: 'Waiting for database context to be available' }
    )
    .toBe('ok');

  return result;
}

export async function expectRelationPickerFirstRow(page: Page, rowName: string): Promise<void> {
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();

  await expect(popover).toBeVisible({ timeout: 15000 });
  await expect
    .poll(
      async () =>
        popover.locator('[data-row-id]').evaluateAll((items) =>
          items.map((item) => item.textContent?.trim()).filter(Boolean)
        ),
      { timeout: 20000, message: 'Waiting for relation picker rows' }
    )
    .toContain(rowName);

  await expect(popover.locator('[data-row-id]').first()).toContainText(rowName, { timeout: 20000 });
}

export async function openRelationFilterMenu(page: Page): Promise<void> {
  await expect(DatabaseFilterSelectors.filterCondition(page).first()).toBeVisible({ timeout: 15000 });
  await DatabaseFilterSelectors.filterCondition(page).first().click({ force: true });
  await expect(page.getByTestId('relation-filter')).toBeVisible({ timeout: 20000 });
}

export async function getRelationCellRowIdsDirect(
  page: Page,
  fieldId: string,
  rowId: string
): Promise<string[]> {
  return page.evaluate(
    async ({ fieldId, rowId }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      let rowDoc = ctx.rowMap?.[rowId];

      if (!rowDoc && ctx.ensureRow) {
        rowDoc = await ctx.ensureRow(rowId);
      }

      if (!rowDoc) return [];

      const row = rowDoc.getMap('data').get('data');
      const cell = row?.get('cells')?.get(fieldId);
      const data = cell?.get('data');

      if (!data) return [];
      if (typeof data.toArray === 'function') return data.toArray().map(String);
      if (Array.isArray(data)) return data.map(String);

      try {
        const parsed = JSON.parse(String(data));

        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    },
    { fieldId, rowId }
  );
}

export async function openRelationCellMenu(page: Page, fieldId: string, rowIndex: number): Promise<void> {
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);

  await expect(cell).toBeVisible({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  await cell.click({ force: true });
  await expect(page.locator('[data-radix-popper-content-wrapper]').last()).toBeVisible({ timeout: 15000 });
}

export async function selectRelationRowByName(page: Page, rowName: string): Promise<void> {
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  const option = popover.getByText(rowName, { exact: true }).first();

  await expect(popover).toBeVisible({ timeout: 15000 });

  if (!(await option.isVisible({ timeout: 5000 }).catch(() => false))) {
    const searchInput = popover.locator('input').first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(rowName);
    }
  }

  await expect(option).toBeVisible({ timeout: 20000 });
  await option.click({ force: true });
  await page.waitForTimeout(800);
}

export async function closeRelationMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(0, { timeout: 10000 });
}

/**
 * Type a query into the search input of the open relation picker. Used by
 * the create-and-link tests where the desired target row doesn't exist yet.
 */
export async function typeInRelationPickerSearch(page: Page, query: string): Promise<void> {
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  const searchInput = popover.locator('input').first();

  await expect(searchInput).toBeVisible({ timeout: 10000 });
  await searchInput.fill(query);
  // Allow the BlocSelector / list to debounce — the create button only
  // renders once `searchInput.trim().length > 0`.
  await page.waitForTimeout(200);
}

/**
 * Click the "Create {query} in {target}" footer action of the relation
 * picker. Mirrors desktop's `_CreateAndLinkRowAction` (commit c811059939):
 * creates a row in the target db with the typed query as its primary cell
 * and links it in one step.
 */
export async function clickCreateAndLinkInRelationPicker(page: Page): Promise<void> {
  const createButton = page.getByTestId('relation-create-and-link');

  await expect(createButton).toBeVisible({ timeout: 10000 });
  await expect(createButton).toBeEnabled({ timeout: 5000 });
  await createButton.click({ force: true });
  // The bloc round-trips create + link asynchronously; give the UI a beat
  // to update the picker's linked-row partition before the next assertion.
  await page.waitForTimeout(800);
}

/**
 * Verifies the relation picker's linked-row section contains a row with the
 * given primary text. Used after `clickCreateAndLinkInRelationPicker` to
 * confirm the freshly created row got linked.
 */
export async function expectRelationPickerHasLinkedRow(page: Page, rowName: string): Promise<void> {
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();

  await expect(popover).toBeVisible({ timeout: 10000 });
  await expect(popover.getByText(rowName, { exact: true }).first()).toBeVisible({ timeout: 15000 });
}

/**
 * Asserts the create-and-link footer button is currently visible inside the
 * open relation picker. Used to verify the button surfaces (or hides) based
 * on the search query state.
 */
export async function expectCreateAndLinkButtonVisible(page: Page, visible: boolean): Promise<void> {
  const button = page.getByTestId('relation-create-and-link');

  if (visible) {
    await expect(button).toBeVisible({ timeout: 10000 });
  } else {
    await expect(button).toHaveCount(0, { timeout: 10000 });
  }
}

/**
 * Fire two clicks on the create-and-link footer button in the same animation
 * frame, before React can commit the disabled state from the first click.
 * Used to assert the synchronous double-tap guard prevents creating two
 * rows when the user accidentally double-clicks the footer.
 */
export async function rapidlyClickCreateAndLinkTwice(page: Page): Promise<void> {
  const button = page.getByTestId('relation-create-and-link');

  await expect(button).toBeVisible({ timeout: 10000 });
  // dispatch both clicks in a single microtask via evaluate so React's
  // re-render between clicks cannot disable the second one.
  await button.evaluate((el) => {
    const target = el as HTMLElement;

    target.click();
    target.click();
  });
  // Allow the bloc to finish creating + linking (one row should result).
  await page.waitForTimeout(1500);
}

/**
 * Returns the count of rows in the active grid whose primary cell text
 * matches `rowName`. Used by the double-tap regression test to verify only
 * one row was created.
 */
export async function countGridRowsByName(page: Page, rowName: string): Promise<number> {
  return page.evaluate((name) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

    if (!ctx?.databaseDoc) return 0;
    const database = ctx.databaseDoc.getMap('data').get('database');

    if (!database) return 0;
    const view = database.get('views')?.get(ctx.activeViewId);

    if (!view) return 0;
    const rowOrders = view.get('row_orders')?.toArray() as Array<{ id: string }> | undefined;

    if (!rowOrders) return 0;
    const fields = database.get('fields');
    const fieldOrders = view.get('field_orders')?.toArray() as Array<{ id: string }> | undefined;

    if (!fieldOrders) return 0;
    const primaryField = fieldOrders.find((order) =>
      Boolean(fields.get(order.id)?.get('is_primary'))
    ) ?? fieldOrders[0];

    if (!primaryField) return 0;
    const rowMap = ctx.rowMap || {};
    let count = 0;

    for (const order of rowOrders) {
      const rowDoc = rowMap[order.id];

      if (!rowDoc) continue;
      const row = rowDoc.getMap('data').get('data');
      const cell = row?.get('cells')?.get(primaryField.id);
      const data = cell?.get('data');

      if (typeof data === 'string' && data === name) {
        count += 1;
      }
    }

    return count;
  }, rowName);
}

/**
 * Asserts that the active grid contains a row whose primary cell text
 * matches `rowName`. Reads directly from the YJS context so the assertion
 * doesn't depend on which rows are scrolled into view.
 */
export async function expectGridContainsRowNamed(page: Page, rowName: string): Promise<void> {
  await expect
    .poll(
      async () => {
        return page.evaluate((name) => {
          // Defensive: __TEST_DATABASE_CONTEXT__ can briefly be undefined
          // between provider unmount and the next provider's effect, which
          // throws and breaks the surrounding poll loop.
          const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

          if (!ctx?.databaseDoc) return false;
          const database = ctx.databaseDoc.getMap('data').get('database');

          if (!database) return false;
          const view = database.get('views')?.get(ctx.activeViewId);

          if (!view) return false;
          const rowOrders = view.get('row_orders')?.toArray() as Array<{ id: string }> | undefined;

          if (!rowOrders) return false;
          const fields = database.get('fields');
          const fieldOrders = view.get('field_orders')?.toArray() as Array<{ id: string }> | undefined;

          if (!fieldOrders) return false;
          const primaryField = fieldOrders.find((order) =>
            Boolean(fields.get(order.id)?.get('is_primary'))
          ) ?? fieldOrders[0];

          if (!primaryField) return false;

          const rowMap = ctx.rowMap || {};

          for (const order of rowOrders) {
            const rowDoc = rowMap[order.id];

            if (!rowDoc) continue;
            const row = rowDoc.getMap('data').get('data');
            const cell = row?.get('cells')?.get(primaryField.id);
            const data = cell?.get('data');

            if (typeof data === 'string' && data === name) {
              return true;
            }
          }

          return false;
        }, rowName);
      },
      { timeout: 20000, message: `Waiting for grid row named "${rowName}"` }
    )
    .toBe(true);
}

export async function expectRelationCellText(
  page: Page,
  fieldId: string,
  rowIndex: number,
  text: string
): Promise<void> {
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);

  await expect(cell).toBeVisible({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  await expect(cell).toContainText(text, { timeout: 30000 });
}

export async function expectRelationCellNotText(
  page: Page,
  fieldId: string,
  rowIndex: number,
  text: string
): Promise<void> {
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);

  await expect(cell).toBeVisible({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  await expect(cell).not.toContainText(text, { timeout: 15000 });
}

export async function openRelationLinkedRow(page: Page, fieldId: string, rowIndex: number, rowName: string): Promise<void> {
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);
  const token = cell.getByText(rowName, { exact: true }).first();

  await expect(token).toBeVisible({ timeout: 30000 });
  await token.click({ force: true });
  await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 20000 });
  await expect(RowDetailSelectors.modal(page)).toContainText(rowName, { timeout: 20000 });
}

export async function renameOpenRowDetailTitle(page: Page, newTitle: string): Promise<void> {
  const titleInput = RowDetailSelectors.titleInput(page);

  await expect(titleInput).toBeVisible({ timeout: 10000 });
  await titleInput.click({ force: true });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await titleInput.pressSequentially(newTitle, { delay: 20 });
  await page.keyboard.press('Enter');
  await expect(RowDetailSelectors.modal(page)).toContainText(newTitle, { timeout: 20000 });
}

export async function closeRowDetailModal(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0, { timeout: 15000 });
}

export async function expectFieldHeaderContains(page: Page, fieldId: string, text: string): Promise<void> {
  const header = GridFieldSelectors.fieldHeader(page, fieldId).last();

  await expect(header).toBeVisible({ timeout: 20000 });
  await expect(header).toContainText(text, { timeout: 30000 });
}

export async function getRelationTypeOption(page: Page, fieldId: string): Promise<{
  database_id: string;
  is_two_way: boolean;
  reciprocal_field_id?: string;
  reciprocal_field_name?: string;
  source_limit: RelationLimit;
  target_limit: RelationLimit;
}> {
  return page.evaluate((fieldId) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const field = database.get('fields').get(fieldId);
    const typeOption = field.get('type_option').get('10');

    return {
      database_id: typeOption.get('database_id') || '',
      is_two_way: Boolean(typeOption.get('is_two_way')),
      reciprocal_field_id: typeOption.get('reciprocal_field_id') || undefined,
      reciprocal_field_name: typeOption.get('reciprocal_field_name') || undefined,
      source_limit: Number(typeOption.get('source_limit') || 0),
      target_limit: Number(typeOption.get('target_limit') || 0),
    };
  }, fieldId);
}

export async function enableTwoWayRelationFromPropertyMenu(page: Page, fieldId: string): Promise<void> {
  await GridFieldSelectors.fieldHeader(page, fieldId).last().click({ force: true });
  await expect(PropertyMenuSelectors.editPropertyMenuItem(page).first()).toBeVisible({ timeout: 10000 });
  await PropertyMenuSelectors.editPropertyMenuItem(page).first().click({ force: true });

  const propertyMenu = page.locator('[role="menu"]').last();
  const twoWayItem = propertyMenu.getByText('Two-way relation').first();

  await expect(twoWayItem).toBeVisible({ timeout: 15000 });
  await twoWayItem.click({ force: true });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

async function addRelationFieldToCurrentDatabase(
  page: Page,
  fieldId: string,
  options: RelationFieldOptions
): Promise<void> {
  await page.evaluate(
    ({ fieldId, options }) => {
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const Y = win.Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const now = String(Math.floor(Date.now() / 1000));
      const field = new Y.Map();
      const typeOptionMap = new Y.Map();
      const typeOption = new Y.Map();

      field.set('name', options.fieldName);
      field.set('id', fieldId);
      field.set('ty', 10);
      field.set('created_at', now);
      field.set('last_modified', now);
      field.set('is_primary', false);
      field.set('icon', '');

      typeOption.set('database_id', options.relatedDatabaseId);
      typeOption.set('is_two_way', options.isTwoWay ?? false);
      typeOption.set('source_limit', options.sourceLimit ?? 0);
      typeOption.set('target_limit', options.targetLimit ?? 0);
      if (options.reciprocalFieldId) {
        typeOption.set('reciprocal_field_id', options.reciprocalFieldId);
      }
      if (options.reciprocalFieldName) {
        typeOption.set('reciprocal_field_name', options.reciprocalFieldName);
      }
      typeOptionMap.set('10', typeOption);
      field.set('type_option', typeOptionMap);

      doc.transact(() => {
        database.get('fields').set(fieldId, field);
        database.get('views').forEach((view: any) => {
          const fieldOrders = view.get('field_orders');

          if (!fieldOrders.toArray().some((order: { id: string }) => order.id === fieldId)) {
            fieldOrders.push([{ id: fieldId }]);
          }

          const fieldSettings = view.get('field_settings');

          if (!fieldSettings.get(fieldId)) {
            const setting = new Y.Map();

            setting.set('visibility', 0);
            fieldSettings.set(fieldId, setting);
          }
        });
      });
    },
    { fieldId, options }
  );
}
