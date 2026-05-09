import { expect, test } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  addRelationFilterDirect,
  clickCreateAndLinkInRelationPicker,
  closeRelationMenu,
  closeRowDetailModal,
  countGridRowsByName,
  convertCurrentFiltersToAdvancedDirect,
  createNamedGridDatabase,
  createOneWayRelationField,
  createRelationViaCreationDialog,
  createTwoWayRelationFields,
  deleteCurrentDatabaseRowDirect,
  deleteFieldFromGridHeader,
  duplicateFieldViaPropertyMenu,
  enableTwoWayRelationFromPropertyMenu,
  expectCreateAndLinkButtonVisible,
  expectFieldHeaderContains,
  expectFieldHeaderHidden,
  expectGridContainsRowNamed,
  expectGridRowsHidden,
  expectGridRowsVisible,
  expectRelationPickerFirstRow,
  expectRelationPickerHasLinkedRow,
  expectRelationCellNotText,
  expectRelationCellText,
  expectVisibleRowCount,
  fieldExistsDirect,
  getCurrentDatabaseInfo,
  getFieldTypeDirect,
  getRelationCellRowIdsDirect,
  getRelationTypeOption,
  openGridDatabaseByPageId,
  openRelationCellMenu,
  openRelationFilterMenu,
  openRelationLinkedRow,
  rapidlyClickCreateAndLinkTwice,
  RelationFilterCondition,
  RelationLimit,
  renameDatabasePageByPageIdDirect,
  renameOpenRowDetailTitle,
  selectRelationRowByName,
  setRelationCellDirect,
  switchFieldTypeViaPropertyMenu,
  typeInRelationPickerSearch,
  updateRelationFilterDirect,
} from '../../support/relation-test-helpers';
import { FieldType } from '../../support/selectors';
import { DatabaseGridSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

test.describe('Relation Desktop Parity BDD', () => {
  // Each test signs in with a fresh random email and creates its own
  // databases, so workspace state is isolated per test. No need for serial
  // mode — and disabling it lets CI parallelize this suite.
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1600, height: 900 });
  });

  test('Given two grids, a row can link to a row from another database', async ({ page, request }) => {
    const suffix = Date.now().toString(36);
    const targetName = `rel-target-${suffix}`;
    const sourceName = `rel-source-${suffix}`;
    let relationFieldId = '';

    await test.step('Given a signed-in user with a source grid and a related grid', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, targetName, ['Target Row', 'Other Target']);

      await createNamedGridDatabase(page, sourceName, ['Source Row', 'Second Source']);
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Related',
        relatedDatabaseId: target.databaseId,
      });
      await expectFieldHeaderContains(page, relationFieldId, `· ${targetName}`);
    });

    await test.step('When the first source row links to a row from the related grid', async () => {
      await openRelationCellMenu(page, relationFieldId, 0);
      await selectRelationRowByName(page, 'Target Row');
      await closeRelationMenu(page);
    });

    await test.step('Then the source relation cell displays the linked row', async () => {
      await expectRelationCellText(page, relationFieldId, 0, 'Target Row');
    });
  });

  test('Given a linked relation cell, clicking the relation link opens row detail', async ({ page, request }) => {
    const suffix = Date.now().toString(36);
    let relationFieldId = '';

    await test.step('Given a source row is linked to a related row', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `open-target-${suffix}`, ['Target Row', 'Other Target']);

      await createNamedGridDatabase(page, `open-source-${suffix}`, ['Source Row']);
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Related',
        relatedDatabaseId: target.databaseId,
      });
      await openRelationCellMenu(page, relationFieldId, 0);
      await selectRelationRowByName(page, 'Target Row');
      await closeRelationMenu(page);
    });

    await test.step('When the relation token is clicked, then the linked row detail opens', async () => {
      await openRelationLinkedRow(page, relationFieldId, 0, 'Target Row');
      await closeRowDetailModal(page);
    });
  });

  test('Given a linked relation row is renamed, the relation cell display updates', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36);
    let relationFieldId = '';

    await test.step('Given a source row is linked to a related row', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `rename-row-target-${suffix}`, ['Target Row', 'Other Target']);

      await createNamedGridDatabase(page, `rename-row-source-${suffix}`, ['Source Row']);
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Related',
        relatedDatabaseId: target.databaseId,
      });
      await openRelationCellMenu(page, relationFieldId, 0);
      await selectRelationRowByName(page, 'Target Row');
      await closeRelationMenu(page);
    });

    await test.step('When the relation token is clicked and the related row is renamed', async () => {
      await openRelationLinkedRow(page, relationFieldId, 0, 'Target Row');
      await renameOpenRowDetailTitle(page, 'Target Row Renamed');
      await closeRowDetailModal(page);
    });

    await test.step('Then the source relation cell reflects the renamed related row', async () => {
      await expectRelationCellText(page, relationFieldId, 0, 'Target Row Renamed');
    });
  });

  test('Given a related database is renamed, the relation field header updates', async ({ page, request }) => {
    const suffix = Date.now().toString(36);
    const targetName = `rename-db-target-${suffix}`;
    const sourceName = `rename-db-source-${suffix}`;
    const renamedTargetName = `rename-db-target-updated-${suffix}`;
    let relationFieldId = '';
    let targetPageId = '';
    let sourcePageId = '';

    await test.step('Given a relation field points to another database', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, targetName, ['Target Row']);

      targetPageId = target.pageId;
      const source = await createNamedGridDatabase(page, sourceName, ['Source Row']);

      sourcePageId = source.pageId;
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Related',
        relatedDatabaseId: target.databaseId,
      });
      await expectFieldHeaderContains(page, relationFieldId, `· ${targetName}`);
    });

    await test.step('When the related database page is renamed', async () => {
      await renameDatabasePageByPageIdDirect(page, targetPageId, renamedTargetName);
      await page.waitForTimeout(2500);
      await openGridDatabaseByPageId(page, sourcePageId);
    });

    await test.step('Then the relation field header reflects the renamed related database', async () => {
      await expectFieldHeaderContains(page, relationFieldId, `· ${renamedTargetName}`);
    });
  });

  test('Given a two-way relation, edits from either database are mirrored', async ({ page, request }) => {
    const suffix = Date.now().toString(36);
    const ordersName = `orders-${suffix}`;
    const recipesName = `recipes-${suffix}`;
    let sourceFieldId = '';
    let reciprocalFieldId = '';
    let ordersPageId = '';
    let recipesPageId = '';

    await test.step('Given orders and recipes grids with a two-way relation', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const orders = await createNamedGridDatabase(page, ordersName, ['Ord-1', 'Ord-2', 'Ord-3']);
      const recipes = await createNamedGridDatabase(page, recipesName, ['Pasta', 'Salad']);

      ordersPageId = orders.pageId;
      recipesPageId = recipes.pageId;
      const relation = await createTwoWayRelationFields(page, {
        sourceFieldName: 'Orders',
        relatedViewId: orders.viewId,
        relatedDatabaseId: orders.databaseId,
        reciprocalFieldName: 'Recipe',
      });

      sourceFieldId = relation.sourceFieldId;
      reciprocalFieldId = relation.reciprocalFieldId;
    });

    await test.step('When recipe rows link to order rows from the recipes side', async () => {
      await openRelationCellMenu(page, sourceFieldId, 0);
      await selectRelationRowByName(page, 'Ord-1');
      await selectRelationRowByName(page, 'Ord-2');
      await closeRelationMenu(page);

      await openRelationCellMenu(page, sourceFieldId, 1);
      await selectRelationRowByName(page, 'Ord-1');
      await closeRelationMenu(page);
    });

    await test.step('Then the recipes grid displays the selected orders', async () => {
      await expectRelationCellText(page, sourceFieldId, 0, 'Ord-1');
      await expectRelationCellText(page, sourceFieldId, 0, 'Ord-2');
      await expectRelationCellText(page, sourceFieldId, 1, 'Ord-1');
    });

    await test.step('And the orders grid displays reciprocal recipe links', async () => {
      await openGridDatabaseByPageId(page, ordersPageId);
      await expectRelationCellText(page, reciprocalFieldId, 0, 'Pasta');
      await expectRelationCellText(page, reciprocalFieldId, 0, 'Salad');
      await expectRelationCellText(page, reciprocalFieldId, 1, 'Pasta');
    });

    await test.step('When an order links to a recipe from the reciprocal side', async () => {
      await openRelationCellMenu(page, reciprocalFieldId, 2);
      await selectRelationRowByName(page, 'Salad');
      await closeRelationMenu(page);
    });

    await test.step('Then the recipes side receives the mirrored order link', async () => {
      await openGridDatabaseByPageId(page, recipesPageId);
      await expectRelationCellText(page, sourceFieldId, 1, 'Ord-3');
    });
  });

  test('Given a one-way relation with data, enabling two-way backfills the reciprocal field', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36);
    const ordersName = `backfill-orders-${suffix}`;
    const recipesName = `backfill-recipes-${suffix}`;
    let relationFieldId = '';
    let reciprocalFieldId = '';
    let ordersPageId = '';

    await test.step('Given a one-way recipes-to-orders relation with an existing link', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const orders = await createNamedGridDatabase(page, ordersName, ['Ord-1', 'Ord-2']);

      ordersPageId = orders.pageId;
      await createNamedGridDatabase(page, recipesName, ['Pasta', 'Salad']);
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Orders',
        relatedDatabaseId: orders.databaseId,
      });

      await openRelationCellMenu(page, relationFieldId, 0);
      await selectRelationRowByName(page, 'Ord-1');
      await closeRelationMenu(page);
      await expectRelationCellText(page, relationFieldId, 0, 'Ord-1');
    });

    await test.step('When the relation is changed to two-way from the field menu', async () => {
      await enableTwoWayRelationFromPropertyMenu(page, relationFieldId);
      const option = await getRelationTypeOption(page, relationFieldId);

      expect(option.is_two_way).toBe(true);
      expect(option.reciprocal_field_id).toBeTruthy();
      reciprocalFieldId = option.reciprocal_field_id as string;
    });

    await test.step('Then the related database has the reciprocal field and backfilled link', async () => {
      await openGridDatabaseByPageId(page, ordersPageId);
      await expectFieldHeaderContains(page, reciprocalFieldId, ordersName);
      await expectRelationCellText(page, reciprocalFieldId, 0, 'Pasta');
    });
  });

  test('Given a two-way self relation, OneOnly parent links move children between parents', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36);
    const tasksName = `tasks-${suffix}`;
    let parentFieldId = '';
    let subTasksFieldId = '';

    await test.step('Given a tasks grid with parent and sub-task self relation fields', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const tasks = await createNamedGridDatabase(page, tasksName, ['Root', 'Build App', 'Dashboard', 'API']);
      const relation = await createTwoWayRelationFields(page, {
        sourceFieldName: 'Parent Task',
        relatedViewId: tasks.viewId,
        relatedDatabaseId: tasks.databaseId,
        reciprocalFieldName: 'Sub Tasks',
        sourceLimit: RelationLimit.OneOnly,
        reciprocalLimit: RelationLimit.NoLimit,
      });

      parentFieldId = relation.sourceFieldId;
      subTasksFieldId = relation.reciprocalFieldId;
    });

    await test.step('When Dashboard is assigned to Build App through the parent field', async () => {
      await openRelationCellMenu(page, parentFieldId, 2);
      await selectRelationRowByName(page, 'Build App');
      await closeRelationMenu(page);
    });

    await test.step('Then Build App lists Dashboard as a sub-task', async () => {
      await expectRelationCellText(page, subTasksFieldId, 1, 'Dashboard');
      await expectRelationCellText(page, parentFieldId, 2, 'Build App');
    });

    await test.step('When Dashboard is moved to API through the reciprocal sub-task field', async () => {
      await openRelationCellMenu(page, subTasksFieldId, 3);
      await selectRelationRowByName(page, 'Dashboard');
      await closeRelationMenu(page);
    });

    await test.step('Then Dashboard has API as its only parent and is removed from Build App sub-tasks', async () => {
      await expectRelationCellText(page, parentFieldId, 2, 'API');
      await expectRelationCellNotText(page, subTasksFieldId, 1, 'Dashboard');
      await expectRelationCellText(page, subTasksFieldId, 3, 'Dashboard');
    });
  });

  test('Given a two-way relation, reciprocal edits do not loop and keep both sides consistent', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36);
    const ordersName = `loop-orders-${suffix}`;
    const recipesName = `loop-recipes-${suffix}`;
    let sourceFieldId = '';
    let reciprocalFieldId = '';
    let ordersPageId = '';
    let recipesPageId = '';

    await test.step('Given recipes and orders are connected by a two-way relation', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const orders = await createNamedGridDatabase(page, ordersName, ['Ord-1', 'Ord-2']);

      const recipes = await createNamedGridDatabase(page, recipesName, ['Pasta', 'Salad']);
      ordersPageId = orders.pageId;
      recipesPageId = recipes.pageId;
      const relation = await createTwoWayRelationFields(page, {
        sourceFieldName: 'Orders',
        relatedViewId: orders.viewId,
        relatedDatabaseId: orders.databaseId,
        reciprocalFieldName: 'Recipe',
      });

      sourceFieldId = relation.sourceFieldId;
      reciprocalFieldId = relation.reciprocalFieldId;
    });

    await test.step('When a recipe links to an order and the reciprocal side is edited twice', async () => {
      await openRelationCellMenu(page, sourceFieldId, 0);
      await selectRelationRowByName(page, 'Ord-1');
      await closeRelationMenu(page);

      await openGridDatabaseByPageId(page, ordersPageId);
      await expectRelationCellText(page, reciprocalFieldId, 0, 'Pasta');

      await openRelationCellMenu(page, reciprocalFieldId, 0);
      await selectRelationRowByName(page, 'Salad');
      await closeRelationMenu(page);

      await openRelationCellMenu(page, reciprocalFieldId, 1);
      await selectRelationRowByName(page, 'Pasta');
      await closeRelationMenu(page);
    });

    await test.step('Then both grids settle with the expected mirrored links', async () => {
      await openGridDatabaseByPageId(page, recipesPageId);
      await expectRelationCellText(page, sourceFieldId, 0, 'Ord-1');
      await expectRelationCellText(page, sourceFieldId, 0, 'Ord-2');
      await expectRelationCellText(page, sourceFieldId, 1, 'Ord-1');
    });
  });

  test('Given a reciprocal two-way field is deleted, the source relation field is also removed', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36);
    const ordersName = `delete-orders-${suffix}`;
    const recipesName = `delete-recipes-${suffix}`;
    let sourceFieldId = '';
    let reciprocalFieldId = '';
    let ordersPageId = '';
    let recipesPageId = '';

    await test.step('Given a two-way relation exists between recipes and orders', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const orders = await createNamedGridDatabase(page, ordersName, ['Ord-1']);

      const recipes = await createNamedGridDatabase(page, recipesName, ['Pasta']);
      ordersPageId = orders.pageId;
      recipesPageId = recipes.pageId;
      const relation = await createTwoWayRelationFields(page, {
        sourceFieldName: 'Orders',
        relatedViewId: orders.viewId,
        relatedDatabaseId: orders.databaseId,
        reciprocalFieldName: 'Recipe',
      });

      sourceFieldId = relation.sourceFieldId;
      reciprocalFieldId = relation.reciprocalFieldId;
      await openGridDatabaseByPageId(page, ordersPageId);
      await expectFieldHeaderContains(page, reciprocalFieldId, 'Recipe');
    });

    await test.step('When the reciprocal field is deleted from the related database', async () => {
      await deleteFieldFromGridHeader(page, reciprocalFieldId);
    });

    await test.step('Then the original source field is removed from the source database', async () => {
      await openGridDatabaseByPageId(page, recipesPageId);
      await expectFieldHeaderHidden(page, sourceFieldId);
    });
  });

  test('Given relation filters, every relation condition filters rows like desktop', async ({ page, request }) => {
    const suffix = Date.now().toString(36);
    let sourceRowIds: string[] = [];
    let targetRowIds: string[] = [];
    let relationFieldId = '';
    let filterId = '';

    await test.step('Given source rows have empty and non-empty relation values', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `filter-target-${suffix}`, [
        'First Linked Row',
        'Second Linked Row',
        'Third Linked Row',
      ]);

      targetRowIds = target.rowIds;
      const source = await createNamedGridDatabase(page, `filter-source-${suffix}`, [
        'RelationFilterCond - 0',
        'RelationFilterCond - 1',
        'RelationFilterCond - 2',
      ]);

      sourceRowIds = source.rowIds;
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Registration Complete',
        relatedDatabaseId: target.databaseId,
      });

      await setRelationCellDirect(page, relationFieldId, 0, [targetRowIds[1]]);
      await setRelationCellDirect(page, relationFieldId, 2, [targetRowIds[0]]);
    });

    await test.step('Then Is Not Empty and Is Empty match the same rows as desktop', async () => {
      filterId = await addRelationFilterDirect(page, relationFieldId, RelationFilterCondition.RelationIsNotEmpty);
      await expectVisibleRowCount(page, 2);
      await expectGridRowsVisible(page, [sourceRowIds[0], sourceRowIds[2]]);
      await expectGridRowsHidden(page, [sourceRowIds[1]]);

      await updateRelationFilterDirect(page, filterId, { condition: RelationFilterCondition.RelationIsEmpty });
      await expectVisibleRowCount(page, 1);
      await expectGridRowsVisible(page, [sourceRowIds[1]]);
      await expectGridRowsHidden(page, [sourceRowIds[0], sourceRowIds[2]]);
    });

    await test.step('And Contains and Does Not Contain match selected related rows', async () => {
      await updateRelationFilterDirect(page, filterId, {
        condition: RelationFilterCondition.RelationContains,
        targetRowIds: [targetRowIds[1]],
      });
      await expectVisibleRowCount(page, 1);
      await expectGridRowsVisible(page, [sourceRowIds[0]]);

      await updateRelationFilterDirect(page, filterId, {
        condition: RelationFilterCondition.RelationDoesNotContain,
        targetRowIds: [targetRowIds[1]],
      });
      await expectVisibleRowCount(page, 2);
      await expectGridRowsVisible(page, [sourceRowIds[1], sourceRowIds[2]]);
      await expectGridRowsHidden(page, [sourceRowIds[0]]);
    });
  });

  test('Given a relation filter, multi-select values and deleted related rows stay usable', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36);
    const targetName = `multi-target-${suffix}`;
    const sourceName = `multi-source-${suffix}`;
    let sourceRowIds: string[] = [];
    let targetRowIds: string[] = [];
    let relationFieldId = '';
    let filterId = '';
    let targetPageId = '';
    let sourcePageId = '';

    await test.step('Given two source rows are linked to two different related rows', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, targetName, ['First Linked Row', 'Second Linked Row']);
      targetPageId = target.pageId;

      for (const rowId of target.rowIds.slice(2)) {
        await deleteCurrentDatabaseRowDirect(page, rowId);
      }

      targetRowIds = (await getCurrentDatabaseInfo(page)).rowIds;
      const source = await createNamedGridDatabase(page, sourceName, ['RelationMulti - 0', 'RelationMulti - 1']);
      sourcePageId = source.pageId;

      for (const rowId of source.rowIds.slice(2)) {
        await deleteCurrentDatabaseRowDirect(page, rowId);
      }

      sourceRowIds = (await getCurrentDatabaseInfo(page)).rowIds;
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Registration Complete',
        relatedDatabaseId: target.databaseId,
      });
      await setRelationCellDirect(page, relationFieldId, 0, [targetRowIds[0]]);
      await setRelationCellDirect(page, relationFieldId, 1, [targetRowIds[1]]);
    });

    await test.step('When the relation filter is empty, both scoped rows are visible', async () => {
      filterId = await addRelationFilterDirect(page, relationFieldId, RelationFilterCondition.RelationContains);
      await expectVisibleRowCount(page, 2);
      await expectGridRowsVisible(page, sourceRowIds);
    });

    await test.step('Then selecting one or both related rows applies OR semantics', async () => {
      await updateRelationFilterDirect(page, filterId, { targetRowIds: [targetRowIds[0]] });
      await expectVisibleRowCount(page, 1);
      await expectGridRowsVisible(page, [sourceRowIds[0]]);
      await expectGridRowsHidden(page, [sourceRowIds[1]]);

      await updateRelationFilterDirect(page, filterId, { targetRowIds: [targetRowIds[0], targetRowIds[1]] });
      await expectVisibleRowCount(page, 2);
      await expectGridRowsVisible(page, sourceRowIds);

      await updateRelationFilterDirect(page, filterId, {
        condition: RelationFilterCondition.RelationDoesNotContain,
        targetRowIds: [targetRowIds[0], targetRowIds[1]],
      });
      await expectVisibleRowCount(page, 0);
    });

    await test.step('And a deleted related row remains visible as Deleted page in the filter picker', async () => {
      await openGridDatabaseByPageId(page, targetPageId);
      await deleteCurrentDatabaseRowDirect(page, targetRowIds[1]);

      await openGridDatabaseByPageId(page, sourcePageId);
      filterId = await addRelationFilterDirect(page, relationFieldId, RelationFilterCondition.RelationContains, [
        targetRowIds[0],
        targetRowIds[1],
      ]);
      await openRelationFilterMenu(page);
      await expect(page.getByTestId('relation-filter')).toContainText('Deleted page', { timeout: 20000 });
      await page.keyboard.press('Escape');
    });
  });

  test('Given a linked relation row is filtered out and back in, its relation value is preserved', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36);
    let sourceRowId = '';
    let targetRowId = '';
    let relationFieldId = '';
    let filterId = '';

    await test.step('Given the first source row links to the second related row', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `second-target-${suffix}`, [
        'First Linked Row',
        'Second Linked Row',
      ]);

      targetRowId = target.rowIds[1];
      const source = await createNamedGridDatabase(page, `second-source-${suffix}`, ['Olaf Source']);

      for (const rowId of source.rowIds.slice(1)) {
        await deleteCurrentDatabaseRowDirect(page, rowId);
      }

      sourceRowId = (await getCurrentDatabaseInfo(page)).rowIds[0];
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Registration Complete',
        relatedDatabaseId: target.databaseId,
      });

      await openRelationCellMenu(page, relationFieldId, 0);
      await selectRelationRowByName(page, 'Second Linked Row');
      await closeRelationMenu(page);
      await expectRelationCellText(page, relationFieldId, 0, 'Second Linked Row');
    });

    await test.step('When a relation filter excludes that linked row', async () => {
      filterId = await addRelationFilterDirect(page, relationFieldId, RelationFilterCondition.RelationDoesNotContain, [
        targetRowId,
      ]);
      await expectVisibleRowCount(page, 0);
      await expectGridRowsHidden(page, [sourceRowId]);
    });

    await test.step('Then switching the filter back in shows the row with the relation intact', async () => {
      await updateRelationFilterDirect(page, filterId, {
        condition: RelationFilterCondition.RelationContains,
        targetRowIds: [targetRowId],
      });
      await expectVisibleRowCount(page, 1);
      await expectGridRowsVisible(page, [sourceRowId]);
      await expectRelationCellText(page, relationFieldId, 0, 'Second Linked Row');
    });
  });

  test('Given a relation filter converts to advanced mode, the filter data is preserved', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36);
    let sourceRowIds: string[] = [];
    let targetRowId = '';
    let relationFieldId = '';
    let filterId = '';

    await test.step('Given one source row has a relation filter match', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `advanced-target-${suffix}`, ['Advanced Target']);

      targetRowId = target.rowIds[0];
      const source = await createNamedGridDatabase(page, `advanced-source-${suffix}`, [
        'Advanced Row 0',
        'Advanced Row 1',
        'Advanced Row 2',
      ]);

      sourceRowIds = source.rowIds;
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Registration Complete',
        relatedDatabaseId: target.databaseId,
      });
      await setRelationCellDirect(page, relationFieldId, 0, [targetRowId]);
      filterId = await addRelationFilterDirect(page, relationFieldId, RelationFilterCondition.RelationIsNotEmpty);
      await expectVisibleRowCount(page, 1);
      await expectGridRowsVisible(page, [sourceRowIds[0]]);
    });

    await test.step('When the relation filter is converted to advanced mode', async () => {
      await expect(page.getByTestId('database-filter-condition')).toHaveCount(1);
      await convertCurrentFiltersToAdvancedDirect(page);
      await expect(page.getByTestId('advanced-filters-badge')).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId('database-filter-condition')).toHaveCount(0);
      await expectVisibleRowCount(page, 1);
    });

    await test.step('Then the advanced relation condition can round-trip without losing row data', async () => {
      await page.getByTestId('advanced-filters-badge').click({ force: true });
      await expect(page.getByTestId('advanced-filter-row')).toHaveCount(1, { timeout: 10000 });
      await page.keyboard.press('Escape');

      await updateRelationFilterDirect(page, filterId, { condition: RelationFilterCondition.RelationIsEmpty });
      await expectVisibleRowCount(page, 2);
      await expectGridRowsVisible(page, [sourceRowIds[1], sourceRowIds[2]]);

      await updateRelationFilterDirect(page, filterId, { condition: RelationFilterCondition.RelationIsNotEmpty });
      await expectVisibleRowCount(page, 1);
      await expectGridRowsVisible(page, [sourceRowIds[0]]);
    });
  });

  test('Given a self relation picker, the recently linked row appears first on the next row', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36);
    let relationFieldId = '';

    await test.step('Given a grid has a self relation field and rows Apple, Banana, and Cherry', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const tasks = await createNamedGridDatabase(page, `recency-${suffix}`, ['Apple', 'Banana', 'Cherry']);

      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Type',
        relatedDatabaseId: tasks.databaseId,
      });
    });

    await test.step('When Cherry is linked from the first row', async () => {
      await openRelationCellMenu(page, relationFieldId, 0);
      await selectRelationRowByName(page, 'Cherry');
      await closeRelationMenu(page);
    });

    await test.step('Then reopening the picker on another row shows Cherry first', async () => {
      await openRelationCellMenu(page, relationFieldId, 1);
      await expectRelationPickerFirstRow(page, 'Cherry');
      await closeRelationMenu(page);
    });
  });

  test('Given a relation-filtered view, new rows opened from the toolbar prefill the relation value', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36);
    let relationFieldId = '';
    let targetRowId = '';
    let beforeRowIds: string[] = [];

    await test.step('Given a source grid has a relation filter to Linked Row Target', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `prefill-target-${suffix}`, ['Linked Row Target']);

      targetRowId = target.rowIds[0];
      const source = await createNamedGridDatabase(page, `prefill-source-${suffix}`, ['Existing Source']);

      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Audience',
        relatedDatabaseId: target.databaseId,
      });
      await addRelationFilterDirect(page, relationFieldId, RelationFilterCondition.RelationContains, [targetRowId]);
      beforeRowIds = source.rowIds;
    });

    await test.step('When the toolbar new-row action opens row detail under the filter', async () => {
      await DatabaseGridSelectors.newRowButton(page).click({ force: true });
      await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 10000 });
    });

    await test.step('Then the new row has the relation filter value prefilled', async () => {
      const after = await getCurrentDatabaseInfo(page);
      const newRowId = after.rowIds.find((rowId) => !beforeRowIds.includes(rowId));

      expect(newRowId).toBeTruthy();
      await expect(RowDetailSelectors.modal(page)).toContainText('Linked Row Target', { timeout: 20000 });
      await expect.poll(() => getRelationCellRowIdsDirect(page, relationFieldId, newRowId as string)).toEqual([targetRowId]);
    });
  });

  test('Given a two-way relation filter, prefilled new rows update the reciprocal side', async ({
    page,
    request,
  }) => {
    // Regression guard for the round-3 fix that wired filter prefills through
    // applyRelationReciprocalInserts in useNewRowDispatch. With a one-way
    // relation the source cell prefill is enough; with two-way, the related
    // row's reciprocal cell must also gain the new row's id.
    const suffix = Date.now().toString(36);
    let sourceFieldId = '';
    let reciprocalFieldId = '';
    let targetRowId = '';
    let beforeRowIds: string[] = [];

    await test.step('Given a two-way relation between source and target with a Contains filter', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `prefill-twoway-target-${suffix}`, ['Linked Row Target']);

      targetRowId = target.rowIds[0];
      const source = await createNamedGridDatabase(page, `prefill-twoway-source-${suffix}`, ['Existing Source']);

      const relation = await createTwoWayRelationFields(page, {
        sourceFieldName: 'Audience',
        relatedViewId: target.viewId,
        relatedDatabaseId: target.databaseId,
        reciprocalFieldName: 'Source rows',
      });

      sourceFieldId = relation.sourceFieldId;
      reciprocalFieldId = relation.reciprocalFieldId;
      await addRelationFilterDirect(page, sourceFieldId, RelationFilterCondition.RelationContains, [targetRowId]);
      beforeRowIds = source.rowIds;
    });

    await test.step('When the toolbar new-row action opens row detail under the filter', async () => {
      await DatabaseGridSelectors.newRowButton(page).click({ force: true });
      await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 10000 });
    });

    await test.step('Then the source row is prefilled and the target row gains the reciprocal back-link', async () => {
      const after = await getCurrentDatabaseInfo(page);
      const newRowId = after.rowIds.find((rowId) => !beforeRowIds.includes(rowId));

      expect(newRowId).toBeTruthy();
      await expect
        .poll(() => getRelationCellRowIdsDirect(page, sourceFieldId, newRowId as string))
        .toEqual([targetRowId]);
      // The related row's reciprocal cell must now reference the new source row.
      // A regression in the post-transact applyRelationReciprocalInserts path
      // would leave this empty even though the source side looks correct.
      await expect
        .poll(() => getRelationCellRowIdsDirect(page, reciprocalFieldId, targetRowId))
        .toContain(newRowId as string);
    });
  });

  test('Given the new-property menu, the relation creation dialog wires the chosen database into the field', async ({
    page,
    request,
  }) => {
    // End-to-end coverage of RelationCreationDialog: open from the property
    // menu, pick a candidate, submit. Every other test in this file
    // bypasses the dialog with direct YJS injection, so a regression in the
    // dialog wiring (PropertyMenu -> handleCreateRelation -> updateRelationTypeOption)
    // would slip through. This test exercises that path end-to-end.
    const suffix = Date.now().toString(36);
    const targetName = `dialog-target-${suffix}`;
    const sourceName = `dialog-source-${suffix}`;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let target!: Awaited<ReturnType<typeof createNamedGridDatabase>>;
    let newFieldId = '';

    await test.step('Given a target grid and a source grid that need a new relation property', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      target = await createNamedGridDatabase(page, targetName, ['Target Row']);
      await createNamedGridDatabase(page, sourceName, ['Source Row']);
    });

    await test.step('When the user adds a Relation property via the creation dialog', async () => {
      newFieldId = await createRelationViaCreationDialog(page, {
        relatedDatabaseId: target.databaseId,
        relatedDatabaseName: targetName,
      });
    });

    await test.step('Then the new field exists with Relation type pointing at the chosen database', async () => {
      await expect.poll(() => getFieldTypeDirect(page, newFieldId)).toBe(FieldType.Relation);
      const typeOption = await getRelationTypeOption(page, newFieldId);

      expect(typeOption.database_id).toBe(target.databaseId);
      expect(typeOption.is_two_way).toBe(false);
    });
  });

  test('Given a two-way relation, switching the source field to text removes the reciprocal field', async ({
    page,
    request,
  }) => {
    // Round-3 fix: useSwitchPropertyType fires deleteReciprocalRelationField
    // when leaving Relation. Without this, the related db keeps a reciprocal
    // field pointing at a column that is no longer a relation — later edits
    // or deletion of that orphan would corrupt the related db.
    const suffix = Date.now().toString(36);
    let sourceFieldId = '';
    let reciprocalFieldId = '';
    let targetPageId = '';
    let sourcePageId = '';

    await test.step('Given a two-way relation between source and target', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `switch-target-${suffix}`, ['Target Row']);

      targetPageId = target.pageId;
      const source = await createNamedGridDatabase(page, `switch-source-${suffix}`, ['Source Row']);

      sourcePageId = source.pageId;
      const relation = await createTwoWayRelationFields(page, {
        sourceFieldName: 'Audience',
        relatedViewId: target.viewId,
        relatedDatabaseId: target.databaseId,
        reciprocalFieldName: 'Source rows',
      });

      sourceFieldId = relation.sourceFieldId;
      reciprocalFieldId = relation.reciprocalFieldId;

      await openGridDatabaseByPageId(page, targetPageId);
      await expectFieldHeaderContains(page, reciprocalFieldId, 'Source rows');
    });

    await test.step('When the source field is switched to a non-Relation type', async () => {
      await openGridDatabaseByPageId(page, sourcePageId);
      await switchFieldTypeViaPropertyMenu(page, sourceFieldId, FieldType.RichText);
    });

    await test.step('Then the reciprocal field is removed from the target database', async () => {
      await openGridDatabaseByPageId(page, targetPageId);
      // Cleanup is fire-and-forget on the source side, so we poll the target
      // until the reciprocal field is no longer in its fields map.
      await expect
        .poll(() => fieldExistsDirect(page, reciprocalFieldId), {
          timeout: 20000,
          message: 'Waiting for reciprocal field cleanup in related database',
        })
        .toBe(false);
    });
  });

  test('Given a two-way relation, duplicating the source field does not orphan the original reciprocal', async ({
    page,
    request,
  }) => {
    // Round-3 fix: useDuplicatePropertyDispatch strips reciprocal metadata
    // (is_two_way / reciprocal_field_id / reciprocal_field_name) from a
    // duplicated relation field. Without that, the duplicate carries the
    // original's reciprocal_field_id and a later delete of the duplicate
    // would tear down the original's reciprocal field in the related db.
    const suffix = Date.now().toString(36);
    let sourceFieldId = '';
    let reciprocalFieldId = '';
    let duplicateFieldId = '';
    let targetPageId = '';

    await test.step('Given a two-way relation between source and target', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `dup-target-${suffix}`, ['Target Row']);

      targetPageId = target.pageId;
      await createNamedGridDatabase(page, `dup-source-${suffix}`, ['Source Row']);

      const relation = await createTwoWayRelationFields(page, {
        sourceFieldName: 'Audience',
        relatedViewId: target.viewId,
        relatedDatabaseId: target.databaseId,
        reciprocalFieldName: 'Source rows',
      });

      sourceFieldId = relation.sourceFieldId;
      reciprocalFieldId = relation.reciprocalFieldId;
    });

    await test.step('When the user duplicates the source relation field', async () => {
      duplicateFieldId = await duplicateFieldViaPropertyMenu(page, sourceFieldId);
    });

    await test.step('Then the duplicate is a one-way relation with no reciprocal metadata', async () => {
      const dupOption = await getRelationTypeOption(page, duplicateFieldId);

      expect(dupOption.is_two_way).toBe(false);
      expect(dupOption.reciprocal_field_id).toBeUndefined();
      // The duplicate must still know which database it relates to.
      expect(dupOption.database_id).toBeTruthy();
    });

    await test.step('And deleting the duplicate leaves the original reciprocal intact', async () => {
      await deleteFieldFromGridHeader(page, duplicateFieldId);

      await openGridDatabaseByPageId(page, targetPageId);
      // Wait until the active context is actually the target db before
      // reading its fields. Without the explicit poll, the previous source
      // db's __TEST_DATABASE_CONTEXT__ can linger for a frame and the
      // assertion reads the wrong db's fields map.
      await expect
        .poll(
          async () => (await getCurrentDatabaseInfo(page)).pageId,
          { timeout: 20000, message: 'Waiting for active page to be the target database' }
        )
        .toBe(targetPageId);

      // Original reciprocal must still exist in the target database; without
      // the metadata-stripping fix this would have been deleted alongside the
      // duplicate.
      expect(await fieldExistsDirect(page, reciprocalFieldId)).toBe(true);
    });
  });

  test('Given the relation picker, typing a missing row name offers a Create action that links the new row', async ({
    page,
    request,
  }) => {
    // Self-relation parity test for desktop's `relation_picker_create_row`
    // BDD scenario (commit c811059939, AppFlowy#8644). Typing a name not in
    // the target DB exposes a Create action that creates the row and links
    // it in one step — without context-switching to the target database.
    const suffix = Date.now().toString(36);
    let relationFieldId = '';

    await test.step('Given a single grid with a self-referencing relation', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const targets = await createNamedGridDatabase(page, `picker-create-${suffix}`, [
        'Apple',
        'Banana',
        'Cherry',
      ]);

      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Type',
        relatedDatabaseId: targets.databaseId,
      });
    });

    await test.step('When the user types Mango (not in the grid) and clicks Create', async () => {
      await openRelationCellMenu(page, relationFieldId, 0);
      await typeInRelationPickerSearch(page, 'Mango');
      await clickCreateAndLinkInRelationPicker(page);
    });

    await test.step('Then the picker shows Mango as linked and the new row is persisted in the database', async () => {
      await expectRelationPickerHasLinkedRow(page, 'Mango');
      await closeRelationMenu(page);
      // Self-referencing relation, so the new row lands in the same grid.
      // Without the dispatch helper persisting the row to row_orders,
      // closing the picker and reading the grid would not find it.
      await expectGridContainsRowNamed(page, 'Mango');
    });
  });

  test('Given a cross-database relation picker, the Create action persists the row in the target database', async ({
    page,
    request,
  }) => {
    // Cross-database parity test for desktop's
    // `relation_picker_create_row_cross_db` BDD scenario. Stronger than the
    // self-relation variant: explicitly verifies the new row lands in the
    // *target* DB, not the source DB the user is editing.
    const suffix = Date.now().toString(36);
    const issuesName = `cross-issues-${suffix}`;
    const tasksName = `cross-tasks-${suffix}`;
    let issuesPageId = '';
    let tasksPageId = '';
    let relationFieldId = '';

    await test.step('Given Issues and Tasks grids with a Tasks→Issues relation', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const issues = await createNamedGridDatabase(page, issuesName, ['Existing Issue']);

      issuesPageId = issues.pageId;
      const tasks = await createNamedGridDatabase(page, tasksName, ['Task A']);

      tasksPageId = tasks.pageId;
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Type',
        relatedDatabaseId: issues.databaseId,
      });
    });

    await test.step('When the user creates Memory Leak from the Tasks relation picker', async () => {
      await openRelationCellMenu(page, relationFieldId, 0);
      await typeInRelationPickerSearch(page, 'Memory Leak');
      await clickCreateAndLinkInRelationPicker(page);
      await expectRelationPickerHasLinkedRow(page, 'Memory Leak');
      await closeRelationMenu(page);
    });

    await test.step('Then Memory Leak is persisted in Issues, not Tasks', async () => {
      await openGridDatabaseByPageId(page, issuesPageId);
      await expectGridContainsRowNamed(page, 'Memory Leak');

      // Round-trip back to Tasks. After two consecutive navigations the
      // active __TEST_DATABASE_CONTEXT__ doesn't always settle into the
      // newest db before the next assertion, so we explicitly wait until
      // the database id matches Tasks before reading rows.
      await openGridDatabaseByPageId(page, tasksPageId);
      await expect
        .poll(
          async () => (await getCurrentDatabaseInfo(page)).pageId,
          { timeout: 20000, message: 'Waiting for active page to be Tasks' }
        )
        .toBe(tasksPageId);

      expect(await countGridRowsByName(page, 'Memory Leak')).toBe(0);
    });
  });

  test('Given the relation picker, the Create action only appears once the user types something', async ({
    page,
    request,
  }) => {
    // Guards the desktop UX rule: the create-and-link footer is gated on
    // `searchInput.trim().length > 0`. Showing it for an empty search would
    // create rows with no primary text — confusing in the target db.
    const suffix = Date.now().toString(36);
    let relationFieldId = '';

    await test.step('Given an open relation picker with an empty search', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `gate-target-${suffix}`, ['Existing']);

      await createNamedGridDatabase(page, `gate-source-${suffix}`, ['Source']);
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Type',
        relatedDatabaseId: target.databaseId,
      });
      await openRelationCellMenu(page, relationFieldId, 0);
    });

    await test.step('Then the Create action is hidden', async () => {
      await expectCreateAndLinkButtonVisible(page, false);
    });

    await test.step('When the user types a query, the Create action appears', async () => {
      await typeInRelationPickerSearch(page, 'Mango');
      await expectCreateAndLinkButtonVisible(page, true);
    });

    await test.step('And clearing the query hides it again', async () => {
      await typeInRelationPickerSearch(page, '');
      await expectCreateAndLinkButtonVisible(page, false);
    });
  });

  test('Given the relation picker, double-clicking Create only persists one row', async ({
    page,
    request,
  }) => {
    // Regression for desktop's `isCreatingAndLinking` guard (codex review on
    // commit c811059939). Without the synchronous ref guard, two clicks
    // dispatched in the same animation frame each see `false` and persist
    // duplicate target rows.
    const suffix = Date.now().toString(36);
    let relationFieldId = '';
    let targetPageId = '';

    await test.step('Given a relation picker on an empty cell', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `dbl-target-${suffix}`, ['Existing']);

      targetPageId = target.pageId;
      await createNamedGridDatabase(page, `dbl-source-${suffix}`, ['Source']);
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Type',
        relatedDatabaseId: target.databaseId,
      });
      await openRelationCellMenu(page, relationFieldId, 0);
      await typeInRelationPickerSearch(page, 'Pineapple');
    });

    await test.step('When the user clicks Create twice in the same frame', async () => {
      await rapidlyClickCreateAndLinkTwice(page);
    });

    await test.step('Then exactly one Pineapple row exists in the target database', async () => {
      await closeRelationMenu(page);
      await openGridDatabaseByPageId(page, targetPageId);
      await expectGridContainsRowNamed(page, 'Pineapple');
      expect(await countGridRowsByName(page, 'Pineapple')).toBe(1);
    });
  });

  test('Given a partial query that matches an existing row, the Create action still creates a new distinct row', async ({
    page,
    request,
  }) => {
    // Desktop UX rule: the Create footer is rendered whenever the search
    // query is non-empty, even if the live results match. Users shouldn't
    // have to clear partial matches to create a new row that happens to
    // share a substring (commit c811059939, AppFlowy#8644).
    const suffix = Date.now().toString(36);
    let relationFieldId = '';
    let targetPageId = '';

    await test.step('Given a target grid containing Apple', async () => {
      await signInAndWaitForApp(page, request, generateRandomEmail());
      const target = await createNamedGridDatabase(page, `partial-target-${suffix}`, [
        'Apple',
        'Banana',
      ]);

      targetPageId = target.pageId;
      await createNamedGridDatabase(page, `partial-source-${suffix}`, ['Source']);
      relationFieldId = await createOneWayRelationField(page, {
        fieldName: 'Type',
        relatedDatabaseId: target.databaseId,
      });
    });

    await test.step('When the user types App (substring of Apple) in the picker', async () => {
      await openRelationCellMenu(page, relationFieldId, 0);
      await typeInRelationPickerSearch(page, 'App');
    });

    await test.step('Then both Apple and the Create action are visible', async () => {
      const popover = page.locator('[data-radix-popper-content-wrapper]').last();

      await expect(popover.getByText('Apple', { exact: true }).first()).toBeVisible({ timeout: 10000 });
      await expectCreateAndLinkButtonVisible(page, true);
    });

    await test.step('And clicking Create persists App as a separate row, not Apple', async () => {
      await clickCreateAndLinkInRelationPicker(page);
      await closeRelationMenu(page);
      await openGridDatabaseByPageId(page, targetPageId);

      // Both rows should now exist in the target db — Apple was never
      // touched, App is the freshly created entry.
      await expectGridContainsRowNamed(page, 'Apple');
      await expectGridContainsRowNamed(page, 'App');
      expect(await countGridRowsByName(page, 'App')).toBe(1);
      expect(await countGridRowsByName(page, 'Apple')).toBe(1);
    });
  });
});
