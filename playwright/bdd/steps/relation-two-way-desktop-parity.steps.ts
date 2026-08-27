import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  closeRelationMenu,
  createNamedGridDatabase,
  createOneWayRelationField,
  getRelatedDatabaseFieldOrder,
  getRelatedDatabaseRowIds,
  getRelationCellRowIdsInRelatedDatabase,
  getRelationTypeOption,
  getRelationTypeOptionFromRelatedDatabase,
  openRelationCellMenu,
  RelationLimit,
  selectRelationRowByName,
  setTwoWayRelationFromPropertyMenu,
  type DatabaseFixtureInfo,
} from '../../support/relation-test-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, Then, When } = createBdd();

interface TwoWayState {
  databases: Map<string, DatabaseFixtureInfo>;
  sourceGridName: string;
  relatedGridName: string;
  relationFieldId: string;
  reciprocalFieldId: string;
}

const states = new WeakMap<Page, TwoWayState>();

function stateFor(page: Page): TwoWayState {
  const state = states.get(page);

  if (!state) throw new Error('Two-way relation scenario state was never initialised');
  return state;
}

function gridOf(page: Page, name: string): DatabaseFixtureInfo {
  const grid = stateFor(page).databases.get(name);

  if (!grid) throw new Error(`Grid "${name}" was never created`);
  return grid;
}

function commaList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

Given('the two-way relation user is signed in', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await signInAndWaitForApp(page, request, generateRandomEmail());
  states.set(page, {
    databases: new Map(),
    sourceGridName: '',
    relatedGridName: '',
    relationFieldId: '',
    reciprocalFieldId: '',
  });
});

Given('a two-way grid {string} with rows {string}', async ({ page }, name: string, rows: string) => {
  const info = await createNamedGridDatabase(page, name, commaList(rows));

  stateFor(page).databases.set(name, info);
});

Given(
  'a one-way relation property {string} on {string} pointing at {string}',
  async ({ page }, fieldName: string, sourceName: string, relatedName: string) => {
    const state = stateFor(page);
    const related = gridOf(page, relatedName);

    // `createNamedGridDatabase` leaves the last-created grid open, which is the
    // source here — the relation field has to be added to that one.
    state.sourceGridName = sourceName;
    state.relatedGridName = relatedName;
    state.relationFieldId = await createOneWayRelationField(page, {
      fieldName,
      relatedDatabaseId: related.databaseId,
    });

    const option = await getRelationTypeOption(page, state.relationFieldId);

    expect(option.is_two_way).toBe(false);
  }
);

Given('row {int} of {string} links {string}', async ({ page }, rowIndex: number, _sourceName: string, links: string) => {
  const state = stateFor(page);

  await openRelationCellMenu(page, state.relationFieldId, rowIndex);
  for (const rowName of commaList(links)) {
    await selectRelationRowByName(page, rowName);
  }

  await closeRelationMenu(page);
});

async function toggleTwoWay(page: Page, fieldName: string, enable: boolean) {
  const state = stateFor(page);

  await setTwoWayRelationFromPropertyMenu(page, state.relationFieldId, enable);

  const option = await getRelationTypeOption(page, state.relationFieldId);

  expect(option.is_two_way, `two-way should be ${enable} for "${fieldName}"`).toBe(enable);
  state.reciprocalFieldId = option.reciprocal_field_id ?? '';
}

Given('the two-way relation toggle has already been turned on for {string}', async ({ page }, fieldName: string) => {
  await toggleTwoWay(page, fieldName, true);
});

When('the two-way relation toggle is turned on for {string}', async ({ page }, fieldName: string) => {
  await toggleTwoWay(page, fieldName, true);
});

When('the two-way relation toggle is turned off for {string}', async ({ page }, fieldName: string) => {
  await toggleTwoWay(page, fieldName, false);
});

Then('the source relation records a reciprocal field id', async ({ page }) => {
  const state = stateFor(page);
  const option = await getRelationTypeOption(page, state.relationFieldId);

  expect(option.reciprocal_field_id).toBeTruthy();
  state.reciprocalFieldId = option.reciprocal_field_id as string;
});

Then('the source relation no longer records a reciprocal field id', async ({ page }) => {
  const option = await getRelationTypeOption(page, stateFor(page).relationFieldId);

  expect(option.is_two_way).toBe(false);
  expect(option.reciprocal_field_id).toBeUndefined();
});

async function relatedFieldOrder(page: Page, relatedName: string): Promise<string[]> {
  return getRelatedDatabaseFieldOrder(page, gridOf(page, relatedName).viewId);
}

Given(
  'the reciprocal property has reached the related database {string}',
  async ({ page }, relatedName: string) => {
    const state = stateFor(page);

    // Desktop appends the reciprocal field to the related view (position
    // `OrderObjectPosition::default()`), which is what makes the column show up.
    await expect
      .poll(() => relatedFieldOrder(page, relatedName), {
        timeout: 30_000,
        message: 'Waiting for the reciprocal property to reach the related view',
      })
      .toContain(state.reciprocalFieldId);
  }
);

Then(
  'the related database {string} lists the reciprocal property in its view',
  async ({ page }, relatedName: string) => {
    const state = stateFor(page);

    await expect
      .poll(() => relatedFieldOrder(page, relatedName), {
        timeout: 30_000,
        message: 'Waiting for the reciprocal property to reach the related view',
      })
      .toContain(state.reciprocalFieldId);
  }
);

Then(
  'the related database {string} no longer has the reciprocal property',
  async ({ page }, relatedName: string) => {
    const state = stateFor(page);
    const relatedViewId = gridOf(page, relatedName).viewId;

    await expect
      .poll(() => getRelatedDatabaseFieldOrder(page, relatedViewId), {
        timeout: 30_000,
        message: 'Waiting for the reciprocal property to be removed from the related view',
      })
      .not.toContain(state.reciprocalFieldId);

    expect(await getRelationTypeOptionFromRelatedDatabase(page, relatedViewId, state.reciprocalFieldId)).toBeNull();
  }
);

Then('the reciprocal property is named {string}', async ({ page }, expectedName: string) => {
  const state = stateFor(page);
  const reciprocal = await getRelationTypeOptionFromRelatedDatabase(
    page,
    gridOf(page, state.relatedGridName).viewId,
    state.reciprocalFieldId
  );

  // Desktop seeds `reciprocal_field_name` from the source field's own name in
  // `_TwoWayRelationPopoverContentState.onTwoWayToggle`, and the backend uses it
  // verbatim as the created field's name.
  expect(reciprocal?.name).toBe(expectedName);
});

Then('the reciprocal property points back at the {string} database', async ({ page }, sourceName: string) => {
  const state = stateFor(page);
  const reciprocal = await getRelationTypeOptionFromRelatedDatabase(
    page,
    gridOf(page, state.relatedGridName).viewId,
    state.reciprocalFieldId
  );

  expect(reciprocal?.database_id).toBe(gridOf(page, sourceName).databaseId);
});

Then('the reciprocal property points back at the source relation field', async ({ page }) => {
  const state = stateFor(page);
  const reciprocal = await getRelationTypeOptionFromRelatedDatabase(
    page,
    gridOf(page, state.relatedGridName).viewId,
    state.reciprocalFieldId
  );

  expect(reciprocal?.reciprocal_field_id).toBe(state.relationFieldId);
});

Then('the reciprocal property is two-way with no source or target limit', async ({ page }) => {
  const state = stateFor(page);
  const reciprocal = await getRelationTypeOptionFromRelatedDatabase(
    page,
    gridOf(page, state.relatedGridName).viewId,
    state.reciprocalFieldId
  );

  // Desktop builds the reciprocal `RelationTypeOptionPB` with NoLimit on both
  // sides regardless of the source field's own limits.
  expect(reciprocal?.is_two_way).toBe(true);
  expect(reciprocal?.source_limit).toBe(RelationLimit.NoLimit);
  expect(reciprocal?.target_limit).toBe(RelationLimit.NoLimit);
});

async function reciprocalLinks(page: Page, relatedName: string, relatedRowIndex: number): Promise<string[]> {
  const state = stateFor(page);
  const relatedViewId = gridOf(page, relatedName).viewId;
  const rowIds = await getRelatedDatabaseRowIds(page, relatedViewId);

  return getRelationCellRowIdsInRelatedDatabase(
    page,
    relatedViewId,
    rowIds[relatedRowIndex],
    state.reciprocalFieldId
  );
}

Then(
  'related row {int} of {string} links back to source rows {int} and {int}',
  async ({ page }, relatedRowIndex: number, relatedName: string, firstIndex: number, secondIndex: number) => {
    const source = gridOf(page, stateFor(page).sourceGridName);

    await expect
      .poll(() => reciprocalLinks(page, relatedName, relatedRowIndex), {
        timeout: 30_000,
        message: 'Waiting for the reciprocal backfill',
      })
      .toEqual(expect.arrayContaining([source.rowIds[firstIndex], source.rowIds[secondIndex]]));
  }
);

Then(
  'related row {int} of {string} links back to source row {int}',
  async ({ page }, relatedRowIndex: number, relatedName: string, sourceIndex: number) => {
    const source = gridOf(page, stateFor(page).sourceGridName);

    await expect
      .poll(() => reciprocalLinks(page, relatedName, relatedRowIndex), {
        timeout: 30_000,
        message: 'Waiting for the reciprocal backfill',
      })
      .toEqual([source.rowIds[sourceIndex]]);
  }
);
