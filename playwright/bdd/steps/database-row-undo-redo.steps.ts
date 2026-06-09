import { randomUUID } from 'crypto';

import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { loginAndCreateGrid, getPrimaryFieldId, typeTextIntoCell } from '../../support/filter-test-helpers';
import { openRowDetail } from '../../support/row-detail-helpers';
import {
  closeRelationMenu,
  createNamedGridDatabase,
  createOneWayRelationField,
  ensureGridRows,
  getCurrentDatabaseInfo,
  getRelationCellRowIdsDirect,
  openRelationCellMenu,
  selectRelationRowByName,
} from '../../support/relation-test-helpers';
import { DatabaseGridSelectors, FieldType, GridFieldSelectors, RowDetailSelectors } from '../../support/selectors';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then } = createBdd();

interface RowUndoRedoState {
  primaryFieldId?: string;
  relationFieldId?: string;
  sourceRowId?: string;
  nextRowId?: string;
  initialRowIds?: string[];
  addedRowId?: string;
  targetRowId?: string;
  undoRedoFieldId?: string;
  undoRedoFieldName?: string;
  undoRedoFilterId?: string;
  undoRedoSortId?: string;
  undoRedoGroupId?: string;
  undoRedoCalculationFieldId?: string;
  skippedRelationFieldId?: string;
}

const stateByPage = new WeakMap<Page, RowUndoRedoState>();

Given('a grid database row named {string} is open for undo redo', async ({ page, request }, rowName: string) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await loginAndCreateGrid(page, request, generateRandomEmail());

  const primaryFieldId = await getPrimaryFieldId(page);

  await typeTextIntoCell(page, primaryFieldId, 0, rowName);
  const { rowIds } = await getCurrentDatabaseInfo(page);

  stateByPage.set(page, {
    primaryFieldId,
    sourceRowId: rowIds[0],
  });

  await openRowDetail(page, 0);
  await expect(RowDetailSelectors.titleInput(page)).toHaveValue(rowName, { timeout: 15000 });
});

Given('a grid database is ready for cell undo redo', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await loginAndCreateGrid(page, request, generateRandomEmail());

  const primaryFieldId = await getPrimaryFieldId(page);
  const { rowIds } = await getCurrentDatabaseInfo(page);

  stateByPage.set(page, {
    initialRowIds: rowIds,
    primaryFieldId,
    sourceRowId: rowIds[0],
    nextRowId: rowIds[1],
  });
});

Given('a grid database relation cell is ready for undo redo', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await signInAndWaitForApp(page, request, generateRandomEmail());

  const suffix = Date.now().toString(36);
  const target = await createNamedGridDatabase(page, `undo-redo-target-${suffix}`, ['Target Row']);
  const source = await createNamedGridDatabase(page, `undo-redo-source-${suffix}`, ['Source Row']);
  const relationFieldId = await createOneWayRelationField(page, {
    fieldName: 'Related',
    relatedDatabaseId: target.databaseId,
  });

  stateByPage.set(page, {
    relationFieldId,
    sourceRowId: source.rowIds[0],
    targetRowId: target.rowIds[0],
  });
});

Given('a seeded grid database is ready for complex undo redo', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await loginAndCreateGrid(page, request, generateRandomEmail());
  await ensureGridRows(page, 3);

  const primaryFieldId = await getPrimaryFieldId(page);
  const { rowIds } = await getCurrentDatabaseInfo(page);

  await seedPrimaryCellsDirect(page, rowIds.slice(0, 3), primaryFieldId, ['Alpha', 'Beta', 'Gamma']);
  await clearDatabaseHistory(page);

  stateByPage.set(page, {
    initialRowIds: rowIds,
    primaryFieldId,
    sourceRowId: rowIds[0],
    nextRowId: rowIds[1],
  });

  await expect.poll(() => getRowCellText(page, rowIds[0], primaryFieldId), { timeout: 15000 }).toBe('Alpha');
  await expect.poll(() => getRowCellText(page, rowIds[1], primaryFieldId), { timeout: 15000 }).toBe('Beta');
});

Given('a text field named {string} exists for undo redo', async ({ page }, fieldName: string) => {
  const state = getState(page);
  const fieldId = await createDatabaseField(page, fieldName, FieldType.RichText, false);

  state.undoRedoFieldId = fieldId;
  state.undoRedoFieldName = fieldName;
  await clearDatabaseHistory(page);
});

Given('a text filter containing {string} exists for undo redo', async ({ page }, content: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');

  state.undoRedoFilterId = await createDatabaseFilter(page, primaryFieldId, content, false);
  await clearDatabaseHistory(page);
});

Given('a skipped relation field named {string} exists for undo redo', async ({ page }, fieldName: string) => {
  const state = getState(page);

  state.skippedRelationFieldId = await createSkippedRelationField(page, fieldName);
});

When('I rename the open database row to {string}', async ({ page }, title: string) => {
  const titleInput = RowDetailSelectors.titleInput(page);

  await expect(titleInput).toBeVisible({ timeout: 15000 });
  await titleInput.fill(title);
  await expect(titleInput).toHaveValue(title, { timeout: 15000 });
  await page.waitForTimeout(500);
});

When('I type {string} into the first grid cell', async ({ page }, text: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');

  await typeTextIntoCell(page, primaryFieldId, 0, text);
  await expect.poll(() => getRowCellText(page, sourceRowId, primaryFieldId), { timeout: 15000 }).toBe(text);
});

When('I type {string} into the second grid cell', async ({ page }, text: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const nextRowId = requireStateValue(state.nextRowId, 'next row id');

  await typeTextIntoCell(page, primaryFieldId, 1, text);
  await expect.poll(() => getRowCellText(page, nextRowId, primaryFieldId), { timeout: 15000 }).toBe(text);
});

When('I activate the first grid cell', async ({ page }) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');

  await page.getByTestId(`grid-cell-${sourceRowId}-${primaryFieldId}`).click({ force: true });
});

When('I activate the next grid cell', async ({ page }) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const nextRowId = requireStateValue(state.nextRowId, 'next row id');

  await page.getByTestId(`grid-cell-${nextRowId}-${primaryFieldId}`).click({ force: true });
  await expect(page.locator('textarea:visible').first()).toBeVisible({ timeout: 8000 });
});

When('I trigger database row undo', async ({ page }) => {
  await triggerDatabaseRowHotkey(page, 'undo');
});

When('I trigger database row redo', async ({ page }) => {
  await triggerDatabaseRowHotkey(page, 'redo');
});

When('I add a new database row for undo redo', async ({ page }) => {
  const state = getState(page);
  const before = await getCurrentDatabaseInfo(page);

  state.initialRowIds = before.rowIds;
  await DatabaseGridSelectors.newRowButton(page).click();

  await expect
    .poll(async () => (await getCurrentDatabaseInfo(page)).rowIds.length, { timeout: 15000 })
    .toBe(before.rowIds.length + 1);

  const after = await getCurrentDatabaseInfo(page);
  const addedRowId = after.rowIds.find((rowId) => !before.rowIds.includes(rowId));

  if (!addedRowId) {
    throw new Error('No added row id was found after clicking New row');
  }

  state.addedRowId = addedRowId;
});

When('I link the relation cell to {string}', async ({ page }, rowName: string) => {
  const state = getState(page);
  const relationFieldId = requireStateValue(state.relationFieldId, 'relation field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');
  const targetRowId = requireStateValue(state.targetRowId, 'target row id');

  await openRelationCellMenu(page, relationFieldId, 0);
  await selectRelationRowByName(page, rowName);
  await closeRelationMenu(page);
  await expect.poll(() => getRelationCellRowIdsDirect(page, relationFieldId, sourceRowId)).toEqual([targetRowId]);
});

When('I open the source database row page', async ({ page }) => {
  await openRowDetail(page, 0);
  await expect(RowDetailSelectors.titleInput(page)).toBeVisible({ timeout: 15000 });
});

When('I create a text field named {string} for undo redo', async ({ page }, fieldName: string) => {
  const state = getState(page);
  const fieldId = await createDatabaseField(page, fieldName, FieldType.RichText, true);

  state.undoRedoFieldId = fieldId;
  state.undoRedoFieldName = fieldName;
});

When('I rename the undo redo field to {string}', async ({ page }, fieldName: string) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');

  await renameDatabaseField(page, fieldId, fieldName);
  state.undoRedoFieldName = fieldName;
});

When('I delete the undo redo field', async ({ page }) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');

  await deleteDatabaseField(page, fieldId);
});

When('I change the undo redo field type to checkbox', async ({ page }) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');

  await changeDatabaseFieldType(page, fieldId, FieldType.Checkbox);
});

When('I set the first row value in the undo redo field to {string}', async ({ page }, text: string) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');

  await setRowCellWithHistory(page, sourceRowId, fieldId, text);
});

When('I set the added row value in the undo redo field to {string}', async ({ page }, text: string) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');
  const addedRowId = requireStateValue(state.addedRowId, 'added row id');

  await setRowCellWithHistory(page, addedRowId, fieldId, text);
});

When('I create a text filter containing {string} for undo redo', async ({ page }, content: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');

  state.undoRedoFilterId = await createDatabaseFilter(page, primaryFieldId, content, true);
});

When('I update the undo redo filter content to {string}', async ({ page }, content: string) => {
  const state = getState(page);
  const filterId = requireStateValue(state.undoRedoFilterId, 'undo redo filter id');

  await updateDatabaseFilter(page, filterId, content);
});

When('I delete the undo redo filter', async ({ page }) => {
  const state = getState(page);
  const filterId = requireStateValue(state.undoRedoFilterId, 'undo redo filter id');

  await deleteDatabaseFilter(page, filterId);
});

When('I create an ascending sort for undo redo', async ({ page }) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');

  state.undoRedoSortId = await createDatabaseSort(page, primaryFieldId);
});

When('I create a group for undo redo', async ({ page }) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');

  state.undoRedoGroupId = await createDatabaseGroup(page, primaryFieldId);
});

When('I create a calculation for undo redo', async ({ page }) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');

  state.undoRedoCalculationFieldId = primaryFieldId;
  await createDatabaseCalculation(page, primaryFieldId);
});

When('I set the first grid cell directly to {string}', async ({ page }, text: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');

  await setRowCellWithHistory(page, sourceRowId, primaryFieldId, text);
});

When('I set the second grid cell directly to {string}', async ({ page }, text: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const nextRowId = requireStateValue(state.nextRowId, 'next row id');

  await setRowCellWithHistory(page, nextRowId, primaryFieldId, text);
});

When('I add a direct database row for complex undo redo', async ({ page }) => {
  const state = getState(page);

  state.addedRowId = await addDatabaseRowWithHistory(page);
});

When('I set the added row primary cell to {string}', async ({ page }, text: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const addedRowId = requireStateValue(state.addedRowId, 'added row id');

  await setRowCellWithHistory(page, addedRowId, primaryFieldId, text);
});

When('I create a skipped relation field named {string}', async ({ page }, fieldName: string) => {
  const state = getState(page);

  state.skippedRelationFieldId = await createSkippedRelationField(page, fieldName);
});

When('I set the skipped relation cell to the second row', async ({ page }) => {
  const state = getState(page);
  const relationFieldId = requireStateValue(state.skippedRelationFieldId, 'skipped relation field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');
  const nextRowId = requireStateValue(state.nextRowId, 'next row id');

  await setRelationCellWithSkippedHistory(page, sourceRowId, relationFieldId, nextRowId);
});

Then('the open database row title is {string}', async ({ page }, title: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');

  await expect(RowDetailSelectors.titleInput(page)).toHaveValue(title, { timeout: 15000 });
  await expect.poll(() => getRowCellText(page, sourceRowId, primaryFieldId), { timeout: 15000 }).toBe(title);
});

Then('the first grid cell is {string}', async ({ page }, text: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');

  await expect.poll(() => getRowCellText(page, sourceRowId, primaryFieldId), { timeout: 15000 }).toBe(text);
});

Then('the second grid cell is {string}', async ({ page }, text: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const nextRowId = requireStateValue(state.nextRowId, 'next row id');

  await expect.poll(() => getRowCellText(page, nextRowId, primaryFieldId), { timeout: 15000 }).toBe(text);
});

Then('the added database row is present', async ({ page }) => {
  const state = getState(page);
  const addedRowId = requireStateValue(state.addedRowId, 'added row id');

  await expect
    .poll(async () => (await getCurrentDatabaseInfo(page)).rowIds.includes(addedRowId), { timeout: 15000 })
    .toBe(true);
});

Then('the added database row is removed', async ({ page }) => {
  const state = getState(page);
  const addedRowId = requireStateValue(state.addedRowId, 'added row id');

  await expect
    .poll(async () => (await getCurrentDatabaseInfo(page)).rowIds.includes(addedRowId), { timeout: 15000 })
    .toBe(false);
});

Then('the relation cell still links to {string}', async ({ page }, _rowName: string) => {
  const state = getState(page);
  const relationFieldId = requireStateValue(state.relationFieldId, 'relation field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');
  const targetRowId = requireStateValue(state.targetRowId, 'target row id');

  await expect
    .poll(() => getRelationCellRowIdsDirect(page, relationFieldId, sourceRowId), { timeout: 15000 })
    .toEqual([targetRowId]);
});

Then('the undo redo field {string} exists', async ({ page }, fieldName: string) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');

  await expect
    .poll(() => getFieldSnapshot(page, fieldId), { timeout: 15000 })
    .toMatchObject({
      exists: true,
      name: fieldName,
    });
  await expect(GridFieldSelectors.fieldHeader(page, fieldId).last()).toBeVisible({ timeout: 15000 });
});

Then('the undo redo field {string} is removed', async ({ page }, _fieldName: string) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');

  await expect
    .poll(() => getFieldSnapshot(page, fieldId), { timeout: 15000 })
    .toMatchObject({
      exists: false,
    });
});

Then('the undo redo field is named {string}', async ({ page }, fieldName: string) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');

  await expect
    .poll(() => getFieldSnapshot(page, fieldId), { timeout: 15000 })
    .toMatchObject({
      exists: true,
      name: fieldName,
    });
});

Then('the undo redo field type is text', async ({ page }) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');

  await expect
    .poll(async () => (await getFieldSnapshot(page, fieldId)).type, { timeout: 15000 })
    .toBe(FieldType.RichText);
});

Then('the undo redo field type is checkbox', async ({ page }) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');

  await expect
    .poll(async () => (await getFieldSnapshot(page, fieldId)).type, { timeout: 15000 })
    .toBe(FieldType.Checkbox);
});

Then('the first row value in the undo redo field is {string}', async ({ page }, text: string) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');

  await expect.poll(() => getRowCellText(page, sourceRowId, fieldId), { timeout: 15000 }).toBe(text);
});

Then('the added row value in the undo redo field is {string}', async ({ page }, text: string) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.undoRedoFieldId, 'undo redo field id');
  const addedRowId = requireStateValue(state.addedRowId, 'added row id');

  await expect.poll(() => getRowCellText(page, addedRowId, fieldId), { timeout: 15000 }).toBe(text);
});

Then('the database has {int} filter with content {string}', async ({ page }, count: number, content: string) => {
  await expect
    .poll(() => getDatabaseViewState(page), { timeout: 15000 })
    .toMatchObject({
      filters: {
        count,
        firstContent: content,
      },
    });
});

Then('the database has {int} filters', async ({ page }, count: number) => {
  await expect.poll(async () => (await getDatabaseViewState(page)).filters.count, { timeout: 15000 }).toBe(count);
});

Then('the database has {int} ascending sort', async ({ page }, count: number) => {
  await expect
    .poll(() => getDatabaseViewState(page), { timeout: 15000 })
    .toMatchObject({
      sorts: {
        count,
        firstCondition: 0,
      },
    });
});

Then('the database has {int} sorts', async ({ page }, count: number) => {
  await expect.poll(async () => (await getDatabaseViewState(page)).sorts.count, { timeout: 15000 }).toBe(count);
});

Then('the database has {int} group', async ({ page }, count: number) => {
  await expect.poll(async () => (await getDatabaseViewState(page)).groups.count, { timeout: 15000 }).toBe(count);
});

Then('the database has {int} groups', async ({ page }, count: number) => {
  await expect.poll(async () => (await getDatabaseViewState(page)).groups.count, { timeout: 15000 }).toBe(count);
});

Then('the database has {int} calculation', async ({ page }, count: number) => {
  await expect.poll(async () => (await getDatabaseViewState(page)).calculations.count, { timeout: 15000 }).toBe(count);
});

Then('the database has {int} calculations', async ({ page }, count: number) => {
  await expect.poll(async () => (await getDatabaseViewState(page)).calculations.count, { timeout: 15000 }).toBe(count);
});

Then('the added row primary cell is {string}', async ({ page }, text: string) => {
  const state = getState(page);
  const primaryFieldId = requireStateValue(state.primaryFieldId, 'primary field id');
  const addedRowId = requireStateValue(state.addedRowId, 'added row id');

  await expect.poll(() => getRowCellText(page, addedRowId, primaryFieldId), { timeout: 15000 }).toBe(text);
});

Then('the skipped relation field {string} exists', async ({ page }, fieldName: string) => {
  const state = getState(page);
  const fieldId = requireStateValue(state.skippedRelationFieldId, 'skipped relation field id');

  await expect
    .poll(() => getFieldSnapshot(page, fieldId), { timeout: 15000 })
    .toMatchObject({
      exists: true,
      name: fieldName,
      type: FieldType.Relation,
    });
});

Then('the skipped relation cell still links to the second row', async ({ page }) => {
  const state = getState(page);
  const relationFieldId = requireStateValue(state.skippedRelationFieldId, 'skipped relation field id');
  const sourceRowId = requireStateValue(state.sourceRowId, 'source row id');
  const nextRowId = requireStateValue(state.nextRowId, 'next row id');

  await expect
    .poll(() => getRelationCellRowIdsDirect(page, relationFieldId, sourceRowId), { timeout: 15000 })
    .toEqual([nextRowId]);
});

async function triggerDatabaseRowHotkey(page: Page, action: 'undo' | 'redo') {
  const hasRowDetailModal = (await RowDetailSelectors.modal(page).count()) > 0;

  if (hasRowDetailModal) {
    await page.evaluate(() => {
      const activeElement = document.activeElement;

      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
    });
  } else {
    await DatabaseGridSelectors.grid(page).dispatchEvent('pointerdown', { bubbles: true });
    await page.waitForTimeout(100);
  }

  const shortcut =
    action === 'undo'
      ? process.platform === 'darwin'
        ? 'Meta+Z'
        : 'Control+Z'
      : process.platform === 'darwin'
      ? 'Meta+Shift+Z'
      : 'Control+Y';

  await page.keyboard.press(shortcut);
  await page.waitForTimeout(500);
}

async function getRowCellText(page: Page, rowId: string, fieldId: string): Promise<string> {
  return page.evaluate(
    async ({ rowId, fieldId }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      let rowDoc = ctx?.rowMap?.[rowId];

      if (!rowDoc && ctx?.ensureRow) {
        rowDoc = await ctx.ensureRow(rowId);
      }

      const row = rowDoc?.getMap('data')?.get('data');
      const data = row?.get('cells')?.get(fieldId)?.get('data');

      return data === undefined || data === null ? '' : String(data);
    },
    { rowId, fieldId }
  );
}

async function clearDatabaseHistory(page: Page) {
  await page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const history = (window as any).__TEST_DATABASE_HISTORY__;

    if (!ctx?.databaseDoc || !history?.getOrCreateDatabaseHistoryManager) {
      throw new Error('Database history test bridge is unavailable');
    }

    history.getOrCreateDatabaseHistoryManager(ctx.databaseDoc).clear();
  });
}

async function seedPrimaryCellsDirect(page: Page, rowIds: string[], fieldId: string, values: string[]) {
  await page.evaluate(
    async ({ rowIds, fieldId, values, fieldType }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const database = ctx.databaseDoc.getMap('data').get('database');
      const databaseId = database.get('id') || ctx.databaseDoc.guid;

      for (let index = 0; index < rowIds.length; index += 1) {
        const rowId = rowIds[index];
        let rowDoc = ctx.rowMap?.[rowId];

        if (!rowDoc && ctx.ensureRow) {
          rowDoc = await ctx.ensureRow(rowId);
        }

        if (!rowDoc && ctx.createRow) {
          rowDoc = await ctx.createRow(`${databaseId}_rows_${rowId}`);
        }

        if (!rowDoc) {
          throw new Error(`Unable to load row doc ${rowId}`);
        }

        rowDoc.transact(() => {
          const row = ensureBrowserRow(rowDoc, rowId, databaseId);
          const cells = row.get('cells');
          let cell = cells.get(fieldId);

          if (!cell) {
            cell = new (window as any).Y.Map();
            cells.set(fieldId, cell);
          }

          cell.set('field_type', fieldType);
          cell.set('data', values[index] ?? '');
          row.set('last_modified', String(Math.floor(Date.now() / 1000)));
        });
      }

      function ensureBrowserRow(rowDoc: any, rowId: string, databaseId: string) {
        const Y = (window as any).Y;
        const root = rowDoc.getMap('data');
        let row = root.get('data');

        if (!row) {
          row = new Y.Map();
          root.set('data', row);
        }

        if (!row.get('id')) row.set('id', rowId);
        if (!row.get('database_id')) row.set('database_id', databaseId);
        if (!row.get('created_at')) row.set('created_at', String(Math.floor(Date.now() / 1000)));
        if (!row.get('cells')) row.set('cells', new Y.Map());

        return row;
      }
    },
    { rowIds, fieldId, values, fieldType: FieldType.RichText }
  );
}

async function createDatabaseField(
  page: Page,
  fieldName: string,
  fieldType: FieldType,
  tracked: boolean
): Promise<string> {
  const fieldId = `undo_field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await page.evaluate(
    ({ fieldId, fieldName, fieldType, tracked }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const Y = (window as any).Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');

      const mutate = () => {
        const now = String(Math.floor(Date.now() / 1000));
        const field = new Y.Map();

        field.set('id', fieldId);
        field.set('name', fieldName);
        field.set('ty', fieldType);
        field.set('created_at', now);
        field.set('last_modified', now);
        field.set('is_primary', false);
        field.set('icon', '');
        field.set('type_option', new Y.Map());
        database.get('fields').set(fieldId, field);

        database.get('views').forEach((view: any) => {
          let fieldOrders = view.get('field_orders');

          if (!fieldOrders) {
            fieldOrders = new Y.Array();
            view.set('field_orders', fieldOrders);
          }

          if (!fieldOrders.toArray().some((order: { id: string }) => order.id === fieldId)) {
            fieldOrders.push([{ id: fieldId }]);
          }

          let fieldSettings = view.get('field_settings');

          if (!fieldSettings) {
            fieldSettings = new Y.Map();
            view.set('field_settings', fieldSettings);
          }

          if (!fieldSettings.get(fieldId)) {
            const setting = new Y.Map();

            setting.set('visibility', 0);
            setting.set('wrap', false);
            fieldSettings.set(fieldId, setting);
          }
        });
      };

      if (tracked) {
        history.runDatabaseAction(doc, { type: 'database.create-field', fieldId, fieldType }, mutate);
      } else {
        doc.transact(mutate);
      }
    },
    { fieldId, fieldName, fieldType, tracked }
  );

  return fieldId;
}

async function renameDatabaseField(page: Page, fieldId: string, fieldName: string) {
  await page.evaluate(
    ({ fieldId, fieldName }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');

      history.runDatabaseAction(doc, { type: 'database.rename-field', fieldId }, () => {
        const field = database.get('fields').get(fieldId);

        if (!field) throw new Error(`Field ${fieldId} not found`);
        field.set('name', fieldName);
        field.set('last_modified', String(Math.floor(Date.now() / 1000)));
      });
    },
    { fieldId, fieldName }
  );
}

async function deleteDatabaseField(page: Page, fieldId: string) {
  await page.evaluate((fieldId) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const history = (window as any).__TEST_DATABASE_HISTORY__;
    const doc = ctx.databaseDoc;
    const database = doc.getMap('data').get('database');

    history.runDatabaseAction(doc, { type: 'database.delete-field', fieldId }, () => {
      database.get('views').forEach((view: any) => {
        const fieldOrders = view.get('field_orders');
        const filters = view.get('filters');
        const sorts = view.get('sorts');
        const fieldIndex = fieldOrders?.toArray().findIndex((order: { id: string }) => order.id === fieldId) ?? -1;
        const filterIndex = filters?.toArray().findIndex((filter: any) => filter.get('field_id') === fieldId) ?? -1;
        const sortIndex = sorts?.toArray().findIndex((sort: any) => sort.get('field_id') === fieldId) ?? -1;

        if (filterIndex >= 0) filters.delete(filterIndex);
        if (sortIndex >= 0) sorts.delete(sortIndex);
        if (fieldIndex >= 0) fieldOrders.delete(fieldIndex);
      });

      database.get('fields').delete(fieldId);
    });
  }, fieldId);
}

async function changeDatabaseFieldType(page: Page, fieldId: string, fieldType: FieldType) {
  await page.evaluate(
    ({ fieldId, fieldType }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');

      history.runDatabaseAction(doc, { type: 'database.change-field-type', fieldId, fieldType }, () => {
        const field = database.get('fields').get(fieldId);

        if (!field) throw new Error(`Field ${fieldId} not found`);
        field.set('ty', fieldType);
        field.set('last_modified', String(Math.floor(Date.now() / 1000)));
      });
    },
    { fieldId, fieldType }
  );
}

async function createDatabaseFilter(page: Page, fieldId: string, content: string, tracked: boolean): Promise<string> {
  const filterId = `undo_filter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await page.evaluate(
    ({ filterId, fieldId, content, tracked, fieldType }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const Y = (window as any).Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const view = database.get('views').get(ctx.activeViewId);

      const mutate = () => {
        let filters = view.get('filters');

        if (!filters) {
          filters = new Y.Array();
          view.set('filters', filters);
        }

        const filter = new Y.Map();

        filter.set('id', filterId);
        filter.set('field_id', fieldId);
        filter.set('condition', 2);
        filter.set('content', content);
        filter.set('ty', fieldType);
        filter.set('filter_type', 2);
        filters.push([filter]);
      };

      if (tracked) {
        history.runDatabaseAction(doc, { type: 'database.create-filter', fieldId, fieldType }, mutate);
      } else {
        doc.transact(mutate);
      }
    },
    { filterId, fieldId, content, tracked, fieldType: FieldType.RichText }
  );

  return filterId;
}

async function updateDatabaseFilter(page: Page, filterId: string, content: string) {
  await page.evaluate(
    ({ filterId, content }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const view = database.get('views').get(ctx.activeViewId);

      history.runDatabaseAction(doc, { type: 'database.update-filter' }, () => {
        const filter = view
          .get('filters')
          ?.toArray()
          .find((candidate: any) => candidate.get('id') === filterId);

        if (!filter) throw new Error(`Filter ${filterId} not found`);
        filter.set('content', content);
      });
    },
    { filterId, content }
  );
}

async function deleteDatabaseFilter(page: Page, filterId: string) {
  await page.evaluate((filterId) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const history = (window as any).__TEST_DATABASE_HISTORY__;
    const doc = ctx.databaseDoc;
    const database = doc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);

    history.runDatabaseAction(doc, { type: 'database.delete-filter' }, () => {
      const filters = view.get('filters');
      const index = filters?.toArray().findIndex((candidate: any) => candidate.get('id') === filterId) ?? -1;

      if (index >= 0) filters.delete(index);
    });
  }, filterId);
}

async function createDatabaseSort(page: Page, fieldId: string): Promise<string> {
  const sortId = `undo_sort_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await page.evaluate(
    ({ sortId, fieldId }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const Y = (window as any).Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const view = database.get('views').get(ctx.activeViewId);

      history.runDatabaseAction(doc, { type: 'database.create-sort', fieldId }, () => {
        let sorts = view.get('sorts');

        if (!sorts) {
          sorts = new Y.Array();
          view.set('sorts', sorts);
        }

        const sort = new Y.Map();

        sort.set('id', sortId);
        sort.set('field_id', fieldId);
        sort.set('condition', 0);
        sorts.push([sort]);
      });
    },
    { sortId, fieldId }
  );

  return sortId;
}

async function createDatabaseGroup(page: Page, fieldId: string): Promise<string> {
  const groupId = `undo_group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await page.evaluate(
    ({ groupId, fieldId, fieldType }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const Y = (window as any).Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const view = database.get('views').get(ctx.activeViewId);

      history.runDatabaseAction(doc, { type: 'database.create-group', fieldId, fieldType }, () => {
        let groups = view.get('groups');

        if (!groups) {
          groups = new Y.Array();
          view.set('groups', groups);
        }

        const group = new Y.Map();
        const columns = new Y.Array();

        group.set('id', groupId);
        group.set('field_id', fieldId);
        group.set('ty', fieldType);
        group.set('content', JSON.stringify({ hide_empty: false, condition: 2 }));
        group.set('groups', columns);
        groups.delete(0, groups.length);
        groups.push([group]);
      });
    },
    { groupId, fieldId, fieldType: FieldType.RichText }
  );

  return groupId;
}

async function createDatabaseCalculation(page: Page, fieldId: string) {
  await page.evaluate(
    ({ fieldId, fieldType }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const Y = (window as any).Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const view = database.get('views').get(ctx.activeViewId);

      history.runDatabaseAction(doc, { type: 'database.create-calculation', fieldId, fieldType }, () => {
        let calculations = view.get('calculations');

        if (!calculations) {
          calculations = new Y.Array();
          view.set('calculations', calculations);
        }

        const calculation = new Y.Map();

        calculation.set('id', fieldId);
        calculation.set('field_id', fieldId);
        calculation.set('ty', 5);
        calculation.set('cv', '');
        calculations.push([calculation]);
      });
    },
    { fieldId, fieldType: FieldType.RichText }
  );
}

async function addDatabaseRowWithHistory(page: Page): Promise<string> {
  const rowId = randomUUID();

  await page.evaluate(async (rowId) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const history = (window as any).__TEST_DATABASE_HISTORY__;
    const Y = (window as any).Y;
    const doc = ctx.databaseDoc;
    const database = doc.getMap('data').get('database');
    const databaseId = database.get('id') || doc.guid;
    const view = database.get('views').get(ctx.activeViewId);
    let rowDoc = ctx.rowMap?.[rowId];

    if (!rowDoc && ctx.createRow) {
      rowDoc = await ctx.createRow(`${databaseId}_rows_${rowId}`);
    }

    if (!rowDoc) {
      rowDoc = new Y.Doc({ guid: `${databaseId}_rows_${rowId}` });
    }

    rowDoc.transact(() => {
      const row = ensureBrowserRow(rowDoc, rowId, databaseId);

      row.set('last_modified', String(Math.floor(Date.now() / 1000)));
    });

    history.getOrCreateDatabaseHistoryManager(doc).registerRowDoc(rowId, rowDoc);
    history.runDatabaseAction(doc, { type: 'database.add-row-order', rowId }, () => {
      view.get('row_orders').push([{ id: rowId, height: 36 }]);
    });

    function ensureBrowserRow(rowDoc: any, rowId: string, databaseId: string) {
      const root = rowDoc.getMap('data');
      let row = root.get('data');

      if (!row) {
        row = new Y.Map();
        root.set('data', row);
      }

      if (!row.get('id')) row.set('id', rowId);
      if (!row.get('database_id')) row.set('database_id', databaseId);
      if (!row.get('created_at')) row.set('created_at', String(Math.floor(Date.now() / 1000)));
      if (!row.get('cells')) row.set('cells', new Y.Map());

      return row;
    }
  }, rowId);

  await expect
    .poll(async () => (await getCurrentDatabaseInfo(page)).rowIds.includes(rowId), { timeout: 15000 })
    .toBe(true);

  return rowId;
}

async function setRowCellWithHistory(page: Page, rowId: string, fieldId: string, text: string) {
  await page.evaluate(
    async ({ rowId, fieldId, text }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const Y = (window as any).Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const databaseId = database.get('id') || doc.guid;
      const field = database.get('fields').get(fieldId);
      const fieldType = Number(field?.get('ty') ?? 0);
      let rowDoc = ctx.rowMap?.[rowId];

      if (!rowDoc && ctx.ensureRow) {
        rowDoc = await ctx.ensureRow(rowId);
      }

      if (!rowDoc && ctx.createRow) {
        rowDoc = await ctx.createRow(`${databaseId}_rows_${rowId}`);
      }

      if (!rowDoc) {
        throw new Error(`Unable to load row doc ${rowId}`);
      }

      history.getOrCreateDatabaseHistoryManager(doc).registerRowDoc(rowId, rowDoc);
      history.runDatabaseRowAction(rowDoc, { type: 'cell.update', rowId, fieldId, fieldType }, () => {
        const row = ensureBrowserRow(rowDoc, rowId, databaseId);
        const cells = row.get('cells');
        let cell = cells.get(fieldId);

        if (!cell) {
          cell = new Y.Map();
          cells.set(fieldId, cell);
        }

        cell.set('field_type', fieldType);
        cell.set('data', text);
        cell.set('last_modified', String(Math.floor(Date.now() / 1000)));
        row.set('last_modified', String(Math.floor(Date.now() / 1000)));
      });

      function ensureBrowserRow(rowDoc: any, rowId: string, databaseId: string) {
        const root = rowDoc.getMap('data');
        let row = root.get('data');

        if (!row) {
          row = new Y.Map();
          root.set('data', row);
        }

        if (!row.get('id')) row.set('id', rowId);
        if (!row.get('database_id')) row.set('database_id', databaseId);
        if (!row.get('created_at')) row.set('created_at', String(Math.floor(Date.now() / 1000)));
        if (!row.get('cells')) row.set('cells', new Y.Map());

        return row;
      }
    },
    { rowId, fieldId, text }
  );

  await expect.poll(() => getRowCellText(page, rowId, fieldId), { timeout: 15000 }).toBe(text);
}

async function createSkippedRelationField(page: Page, fieldName: string): Promise<string> {
  const fieldId = `undo_relation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await page.evaluate(
    ({ fieldId, fieldName, fieldType }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const Y = (window as any).Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');

      history.runDatabaseAction(doc, { type: 'relation.create-field', fieldId, fieldType }, () => {
        const now = String(Math.floor(Date.now() / 1000));
        const field = new Y.Map();

        field.set('id', fieldId);
        field.set('name', fieldName);
        field.set('ty', fieldType);
        field.set('created_at', now);
        field.set('last_modified', now);
        field.set('is_primary', false);
        field.set('icon', '');
        field.set('type_option', new Y.Map());
        database.get('fields').set(fieldId, field);

        database.get('views').forEach((view: any) => {
          view.get('field_orders').push([{ id: fieldId }]);
        });
      });
    },
    { fieldId, fieldName, fieldType: FieldType.Relation }
  );

  return fieldId;
}

async function setRelationCellWithSkippedHistory(page: Page, rowId: string, fieldId: string, targetRowId: string) {
  await page.evaluate(
    async ({ rowId, fieldId, targetRowId, fieldType }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const history = (window as any).__TEST_DATABASE_HISTORY__;
      const Y = (window as any).Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const databaseId = database.get('id') || doc.guid;
      let rowDoc = ctx.rowMap?.[rowId];

      if (!rowDoc && ctx.ensureRow) {
        rowDoc = await ctx.ensureRow(rowId);
      }

      if (!rowDoc && ctx.createRow) {
        rowDoc = await ctx.createRow(`${databaseId}_rows_${rowId}`);
      }

      if (!rowDoc) {
        throw new Error(`Unable to load row doc ${rowId}`);
      }

      history.getOrCreateDatabaseHistoryManager(doc).registerRowDoc(rowId, rowDoc);
      history.runDatabaseRowAction(rowDoc, { type: 'relation.update-cell', rowId, fieldId, fieldType }, () => {
        const row = ensureBrowserRow(rowDoc, rowId, databaseId);
        const cells = row.get('cells');
        let cell = cells.get(fieldId);

        if (!cell) {
          cell = new Y.Map();
          cells.set(fieldId, cell);
        }

        const data = new Y.Array();

        data.push([targetRowId]);
        cell.set('field_type', fieldType);
        cell.set('data', data);
        cell.set('last_modified', String(Math.floor(Date.now() / 1000)));
      });

      function ensureBrowserRow(rowDoc: any, rowId: string, databaseId: string) {
        const root = rowDoc.getMap('data');
        let row = root.get('data');

        if (!row) {
          row = new Y.Map();
          root.set('data', row);
        }

        if (!row.get('id')) row.set('id', rowId);
        if (!row.get('database_id')) row.set('database_id', databaseId);
        if (!row.get('created_at')) row.set('created_at', String(Math.floor(Date.now() / 1000)));
        if (!row.get('cells')) row.set('cells', new Y.Map());

        return row;
      }
    },
    { rowId, fieldId, targetRowId, fieldType: FieldType.Relation }
  );
}

async function getFieldSnapshot(
  page: Page,
  fieldId: string
): Promise<{ exists: boolean; name: string; type: number | null }> {
  return page.evaluate((fieldId) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const field = database.get('fields').get(fieldId);

    return {
      exists: Boolean(field),
      name: field?.get('name') ?? '',
      type: field ? Number(field.get('ty')) : null,
    };
  }, fieldId);
}

async function getDatabaseViewState(page: Page): Promise<{
  calculations: { count: number };
  filters: { count: number; firstContent: string };
  groups: { count: number };
  sorts: { count: number; firstCondition: number | null };
}> {
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    const filters = view.get('filters');
    const sorts = view.get('sorts');
    const groups = view.get('groups');
    const calculations = view.get('calculations');
    const firstFilter = filters && filters.length > 0 ? filters.get(0) : null;
    const firstSort = sorts && sorts.length > 0 ? sorts.get(0) : null;

    return {
      calculations: {
        count: calculations?.length ?? 0,
      },
      filters: {
        count: filters?.length ?? 0,
        firstContent: firstFilter?.get?.('content') ?? '',
      },
      groups: {
        count: groups?.length ?? 0,
      },
      sorts: {
        count: sorts?.length ?? 0,
        firstCondition: firstSort ? Number(firstSort.get('condition')) : null,
      },
    };
  });
}

function getState(page: Page): RowUndoRedoState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('No row undo/redo scenario state is available');
  }

  return state;
}

function requireStateValue(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`No ${label} is available for this scenario`);
  }

  return value;
}
