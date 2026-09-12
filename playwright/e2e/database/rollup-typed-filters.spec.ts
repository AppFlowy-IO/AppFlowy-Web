import { expect, test, type Page } from '@playwright/test';

import { addFilterByFieldName, loginAndCreateGrid } from '../../support/filter-test-helpers';
import {
  createNamedGridDatabase,
  createOneWayRelationField,
  createRollupCountFieldDirect,
  getCurrentDatabaseInfo,
  ensureGridRows,
  setRelationCellDirect,
  convertCurrentFiltersToAdvancedDirect,
  waitForDatabaseTestContext,
} from '../../support/relation-test-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { DatabaseGridSelectors } from '../../support/selectors';

// Seed only the source data directly; filter creation and editing use production controls.
async function seedNames(page: Page, names: string[]) {
  await ensureGridRows(page, names.length);
  const info = await getCurrentDatabaseInfo(page);

  await page.evaluate(
    async ({ info, names }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const Y = (window as any).Y;
      for (const [index, name] of names.entries()) {
        const rowId = info.rowIds[index];
        const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow(rowId));
        rowDoc.transact(() => {
          const row = rowDoc.getMap('data').get('data');
          const cells = row.get('cells');
          let cell = cells.get(info.primaryFieldId);
          if (!cell) {
            cell = new Y.Map();
            cells.set(info.primaryFieldId, cell);
          }
          cell.set('field_type', 0);
          cell.set('data', name);
          cell.set('last_modified', String(Math.floor(Date.now() / 1000)));
        });
      }
    },
    { info, names }
  );
  for (const name of names) await expect(DatabaseGridSelectors.grid(page)).toContainText(name);
}

async function rules(page: Page) {
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const filters = database.get('views').get(ctx.activeViewId).get('filters').toJSON();
    const flatten = (items: any[]): any[] => items.flatMap((item) => (item.children ? flatten(item.children) : [item]));

    return JSON.parse(
      JSON.stringify(flatten(filters), (_key, value) => (typeof value === 'bigint' ? Number(value) : value))
    );
  });
}

async function mode(page: Page, name: string) {
  await page.getByTestId('rollup-filter-mode').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function visibleIds(page: Page) {
  return DatabaseGridSelectors.dataRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-testid')!.replace('grid-row-', ''))
  );
}

for (const compact of [false, true]) {
  test(`rollup list Any/Every/None persists through advanced editing and refresh (${
    compact ? 'compact' : 'desktop'
  })`, async ({ page, request }) => {
    test.setTimeout(180000);
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
    await seedNames(page, ['Alpha', 'Beta', 'Gamma']);
    const target = await getCurrentDatabaseInfo(page);
    await createNamedGridDatabase(page, `Typed Rollups ${Date.now()}`, [], {
      protectedIds: [target.databaseId, target.pageId],
    });
    await seedNames(page, ['Mixed', 'Only Alpha', 'Empty']);
    const source = await getCurrentDatabaseInfo(page);
    const relationId = await createOneWayRelationField(page, {
      fieldName: 'Related',
      relatedDatabaseId: target.databaseId,
    });
    const rollupId = await createRollupCountFieldDirect(page, { fieldName: 'Names', relationFieldId: relationId });

    await page.evaluate(
      ({ rollupId, targetId }) => {
        const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
        const option = ctx.databaseDoc
          .getMap('data')
          .get('database')
          .get('fields')
          .get(rollupId)
          .get('type_option')
          .get('16');

        ctx.databaseDoc.transact(() => {
          option.set('target_field_id', targetId);
          option.set('show_as', 1);
        });
      },
      { rollupId, targetId: target.primaryFieldId }
    );
    await setRelationCellDirect(page, relationId, 0, target.rowIds.slice(0, 2));
    await setRelationCellDirect(page, relationId, 1, target.rowIds.slice(0, 1));
    await expect(page.getByTestId(`rollup-cell-${source.rowIds[0]}-${rollupId}`).last()).toContainText('Alpha');
    await addFilterByFieldName(page, 'Names');
    if (compact) await page.setViewportSize({ width: 430, height: 900 });
    await page.getByTestId('filter-condition-selector').click();
    await page.getByTestId('filter-condition-0').click();
    await page.getByTestId('advanced-filter-text-input').fill('Alpha');
    await expect
      .poll(() => rules(page))
      .toEqual([
        expect.objectContaining({
          content: 'Alpha',
          condition: 0,
          rollup_target_ty: 0,
          rollup_meta: expect.objectContaining({
            target_field_type: 0,
            rollup_filter_mode: 0,
            rollup_show_as: 1,
            target_field_id: target.primaryFieldId,
          }),
        }),
      ]);
    await expect.poll(() => visibleIds(page)).toEqual(source.rowIds.slice(0, 2));
    await mode(page, 'Every');
    await expect.poll(() => visibleIds(page)).toEqual([source.rowIds[1]]);
    await mode(page, 'None');
    await expect.poll(() => visibleIds(page)).toEqual([source.rowIds[2]]);
    await page.keyboard.press('Escape');
    await convertCurrentFiltersToAdvancedDirect(page);
    await page.getByTestId('advanced-filters-badge').click();
    await expect(page.getByTestId('rollup-filter-mode')).toHaveText('None');
    await mode(page, 'Every');
    await expect.poll(() => rules(page).then((value) => value[0].rollup_meta.rollup_filter_mode)).toBe(2);
    const saved = await rules(page);

    await page.reload();
    await waitForDatabaseTestContext(page);
    await expect.poll(() => rules(page)).toEqual(saved);
    await expect.poll(() => visibleIds(page)).toEqual([source.rowIds[1]]);
    await page.getByTestId('advanced-filters-badge').click();
    await expect(page.getByTestId('rollup-filter-mode')).toHaveText('Every');
    await expect(page.getByTestId('advanced-filter-text-input')).toHaveValue('Alpha');
  });
}
