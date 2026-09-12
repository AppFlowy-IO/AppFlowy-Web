import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { addFilterByFieldName, loginAndCreateGrid } from '../../support/filter-test-helpers';
import {
  convertCurrentFiltersToAdvancedDirect,
  createNamedGridDatabase,
  createOneWayRelationField,
  createRollupCountFieldDirect,
  ensureGridRows,
  getCurrentDatabaseInfo,
  setRelationCellDirect,
  waitForDatabaseTestContext,
} from '../../support/relation-test-helpers';
import { DatabaseGridSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

// Direct writes prepare the cross-database fixture and simulate configuration
// arriving from desktop. Predicate edits use the mounted production controls.
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
          const cells = rowDoc.getMap('data').get('data').get('cells');
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
  return info;
}

async function configureRollup(page: Page, fieldId: string, changes: Record<string, string | number>) {
  await page.evaluate(
    ({ fieldId, changes }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const option = ctx.databaseDoc
        .getMap('data')
        .get('database')
        .get('fields')
        .get(fieldId)
        .get('type_option')
        .get('16');

      ctx.databaseDoc.transact(() => {
        Object.entries(changes).forEach(([key, value]) => option.set(key, value));
      });
    },
    { fieldId, changes }
  );
}

async function fixture(page: Page, request: APIRequestContext) {
  setupPageErrorHandling(page);
  await loginAndCreateGrid(page, request, generateRandomEmail());
  const target = await seedNames(page, ['Ten', 'Five', 'Zero']);
  const amountId = await page.evaluate(async (rowIds) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const Y = (window as any).Y;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const fieldId = crypto.randomUUID();
    const field = new Y.Map();
    const typeOptions = new Y.Map();
    const option = new Y.Map();

    field.set('id', fieldId);
    field.set('name', 'Amount');
    field.set('ty', 1);
    field.set('is_primary', false);
    option.set('format', 1); // USD: display $10, while source data remains "10".
    option.set('scale', 2);
    typeOptions.set('1', option);
    field.set('type_option', typeOptions);
    ctx.databaseDoc.transact(() => database.get('fields').set(fieldId, field));

    for (const [index, amount] of ['10', '5', '0'].entries()) {
      const rowDoc = ctx.rowMap?.[rowIds[index]] ?? (await ctx.ensureRow(rowIds[index]));

      rowDoc.transact(() => {
        const cell = new Y.Map();

        cell.set('field_type', 1);
        cell.set('data', amount);
        rowDoc.getMap('data').get('data').get('cells').set(fieldId, cell);
      });
    }
    return fieldId;
  }, target.rowIds);

  await createNamedGridDatabase(page, `Final Rollup Parity ${Date.now()}`, [], {
    protectedIds: [target.databaseId, target.pageId],
  });
  const source = await seedNames(page, ['Mixed', 'Only Five', 'Empty']);
  const relationId = await createOneWayRelationField(page, {
    fieldName: 'Related',
    relatedDatabaseId: target.databaseId,
  });
  const rollupId = await createRollupCountFieldDirect(page, { fieldName: 'Rollup', relationFieldId: relationId });

  await configureRollup(page, rollupId, { target_field_id: target.primaryFieldId, show_as: 1 });
  await setRelationCellDirect(page, relationId, 0, target.rowIds.slice(0, 2));
  await setRelationCellDirect(page, relationId, 1, [target.rowIds[1]]);
  await expect(page.getByTestId(`rollup-cell-${source.rowIds[0]}-${rollupId}`).last()).toContainText('Ten');
  return { target, source, amountId, relationId, rollupId };
}

async function rules(page: Page) {
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const filters = ctx.databaseDoc
      .getMap('data')
      .get('database')
      .get('views')
      .get(ctx.activeViewId)
      .get('filters')
      .toJSON();
    const flatten = (items: any[]): any[] => items.flatMap((item) => (item.children ? flatten(item.children) : [item]));

    return JSON.parse(
      JSON.stringify(flatten(filters), (_key, value) => (typeof value === 'bigint' ? Number(value) : value))
    );
  });
}

async function visibleIds(page: Page) {
  return DatabaseGridSelectors.dataRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-testid')!.replace('grid-row-', ''))
  );
}

async function condition(page: Page, value: number) {
  await page.getByTestId('filter-condition-selector').click();
  await page.getByTestId(`filter-condition-${value}`).click();
}

test('legacy currency list comparisons use source numbers and keep metadata absent after reload', async ({
  page,
  request,
}) => {
  const { source, amountId, rollupId } = await fixture(page, request);

  await configureRollup(page, rollupId, { target_field_id: amountId, calculation_type: 4 });
  await expect(page.getByTestId(`rollup-cell-${source.rowIds[0]}-${rollupId}`).last().getByRole('button')).toHaveText([
    '$10',
    '$5',
  ]);

  // This is the pre-metadata desktop wire payload: the Number discriminator is
  // present, while rollup_meta (including Any/None/Every) has never been written.
  await page.evaluate((rollupId) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const Y = (window as any).Y;
    const filters = ctx.databaseDoc.getMap('data').get('database').get('views').get(ctx.activeViewId).get('filters');
    const filter = new Y.Map();

    Object.entries({
      id: 'legacy-currency-rule',
      field_id: rollupId,
      filter_type: 2,
      ty: 16,
      rollup_target_ty: 1,
      condition: 2,
      content: '5',
    }).forEach(([key, value]) => filter.set(key, value));
    ctx.databaseDoc.transact(() => filters.push([filter]));
  }, rollupId);
  await expect.poll(() => visibleIds(page)).toEqual([source.rowIds[0]]);
  await expect.poll(() => rules(page).then((items) => items[0].rollup_meta)).toBeUndefined();

  // The simple editor must honor the saved Number discriminator even for a list.
  const chip = page.getByTestId('database-filter-condition');

  if (!(await chip.isVisible())) await page.getByTestId('database-actions-filter').click();
  await chip.click();
  await expect(page.getByTestId('advanced-filter-number-input')).toHaveValue('5');
  await expect(page.getByTestId('rollup-filter-mode')).toHaveCount(0);
  await page.getByTestId('advanced-filter-number-input').fill('6');
  await expect.poll(() => rules(page).then((items) => items[0].content)).toBe('6');
  await expect.poll(() => rules(page).then((items) => items[0].rollup_meta)).toBeUndefined();
  await page.keyboard.press('Escape');
  await convertCurrentFiltersToAdvancedDirect(page);
  await page.getByTestId('advanced-filters-badge').click();
  await expect(page.getByTestId('advanced-filter-number-input')).toHaveValue('6');
  await expect(page.getByTestId('rollup-filter-mode')).toHaveCount(0);
  await page.getByTestId('advanced-filter-number-input').fill('5');
  await expect.poll(() => rules(page).then((items) => items[0].content)).toBe('5');
  await condition(page, 0); // Equal 5 matches either real source number.
  await expect.poll(() => visibleIds(page)).toEqual(source.rowIds.slice(0, 2));
  await condition(page, 2);
  await page.getByTestId('advanced-filter-number-input').fill('100');
  await expect.poll(() => visibleIds(page)).toEqual([]);
  const expected = [{ id: 'legacy-currency-rule', content: '100', condition: 2, rollup_target_ty: 1 }];

  await expect.poll(() => rules(page)).toEqual(expected.map((item) => expect.objectContaining(item)));
  await expect.poll(() => rules(page).then((items) => items[0].rollup_meta)).toBeUndefined();
  await page.reload();
  await waitForDatabaseTestContext(page);
  await expect.poll(() => rules(page)).toEqual(expected.map((item) => expect.objectContaining(item)));
  await expect.poll(() => rules(page).then((items) => items[0].rollup_meta)).toBeUndefined();
  await expect.poll(() => visibleIds(page)).toEqual([]);
  await page.getByTestId('advanced-filters-badge').click();
  await expect(page.getByTestId('advanced-filter-number-input')).toHaveValue('100');
  await expect(page.getByTestId('rollup-filter-mode')).toHaveCount(0);
});

test('mounted rollup editor discards drafts after remote target and calculation changes', async ({ page, request }) => {
  const { source, amountId, relationId, rollupId } = await fixture(page, request);

  await addFilterByFieldName(page, 'Rollup');
  await condition(page, 0);
  await page.getByTestId('advanced-filter-text-input').fill('Ten');
  await expect.poll(() => visibleIds(page)).toEqual([source.rowIds[0]]);
  const filterId = (await rules(page))[0].id;

  // Change source while the real editor is still open and its 500 ms text
  // debounce is pending. Migration must reset this same filter ID to Number.
  await page.getByTestId('advanced-filter-text-input').fill('retired text draft');
  await configureRollup(page, rollupId, { target_field_id: amountId });
  await expect(page.getByTestId('advanced-filter-text-input')).toHaveCount(0);
  await expect(page.getByTestId('advanced-filter-number-input')).toHaveValue('');
  await page.waitForTimeout(600); // Cross the old debounce boundary before checking persisted content.
  await expect
    .poll(() => rules(page))
    .toEqual([
      expect.objectContaining({
        id: filterId,
        content: '',
        condition: 0,
        rollup_target_ty: 1,
        rollup_meta: expect.objectContaining({
          relation_field_id: relationId,
          target_field_id: amountId,
          target_field_type: 1,
          rollup_show_as: 1,
          rollup_filter_mode: 0,
        }),
      }),
    ]);
  await expect.poll(() => visibleIds(page)).toEqual(source.rowIds);

  await condition(page, 2);
  await page.getByTestId('advanced-filter-number-input').fill('7');
  await expect.poll(() => visibleIds(page)).toEqual([source.rowIds[0]]);
  await page.getByTestId('advanced-filter-number-input').fill('99');
  await configureRollup(page, rollupId, { show_as: 0, calculation_type: 3 }); // Minimum.
  await expect(page.getByTestId('rollup-filter-mode')).toHaveCount(0);
  await expect(page.getByTestId('advanced-filter-number-input')).toHaveValue('');
  await page.waitForTimeout(600);
  await expect
    .poll(() => rules(page))
    .toEqual([
      expect.objectContaining({
        id: filterId,
        content: '',
        condition: 0,
        rollup_target_ty: 1,
        rollup_meta: expect.objectContaining({
          target_field_id: amountId,
          target_field_type: 1,
          rollup_show_as: 0,
          rollup_calculation_type: 3,
        }),
      }),
    ]);
  await expect.poll(() => rules(page).then((items) => items[0].rollup_meta.rollup_filter_mode)).toBeUndefined();
  await expect.poll(() => visibleIds(page)).toEqual(source.rowIds);

  // The replacement input remains usable, and its new calculation persists.
  await page.getByTestId('advanced-filter-number-input').fill('5');
  await expect.poll(() => visibleIds(page)).toEqual(source.rowIds.slice(0, 2));
  const saved = await rules(page);

  await page.reload();
  await waitForDatabaseTestContext(page);
  await expect.poll(() => rules(page)).toEqual(saved);
  await expect.poll(() => visibleIds(page)).toEqual(source.rowIds.slice(0, 2));
});
