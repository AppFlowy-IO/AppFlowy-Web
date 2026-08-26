import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  createNamedGridDatabase,
  createOneWayRelationField,
  createRollupCountFieldDirect,
  getRelationCellRowIdsDirect,
  setRelationCellDirect,
  type DatabaseFixtureInfo,
} from '../../support/relation-test-helpers';
import { addSortByFieldName } from '../../support/sort-test-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, Then, When } = createBdd();

interface RollupReactivityState {
  target?: DatabaseFixtureInfo;
  source?: DatabaseFixtureInfo;
  relationFieldId: string;
  rollupFieldId: string;
  documentToken: string;
}

const states = new WeakMap<Page, RollupReactivityState>();

function stateFor(page: Page): RollupReactivityState {
  const state = states.get(page);

  if (!state) throw new Error('Rollup reactivity scenario state was never initialised');
  return state;
}

function commaList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function rollupCell(page: Page, state: RollupReactivityState) {
  const rowId = state.source?.rowIds[0];

  if (!rowId || !state.rollupFieldId) throw new Error('Rollup fixture is incomplete');
  return page.getByTestId(`rollup-cell-${rowId}-${state.rollupFieldId}`).last();
}

Given('the rollup reactivity user is signed in', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await signInAndWaitForApp(page, request, generateRandomEmail());
  states.set(page, { relationFieldId: '', rollupFieldId: '', documentToken: '' });
});

Given('a rollup target grid with rows {string}', async ({ page }, rows: string) => {
  stateFor(page).target = await createNamedGridDatabase(page, 'Rollup Live Employees', commaList(rows));
});

Given('a rollup source grid with one row {string}', async ({ page }, rowName: string) => {
  stateFor(page).source = await createNamedGridDatabase(page, 'Rollup Live Projects', [rowName]);
});

Given(
  'a relation property {string} and count-all rollup {string} are configured',
  async ({ page }, relationName: string, rollupName: string) => {
    const state = stateFor(page);

    if (!state.target) throw new Error('Rollup target grid was never created');
    state.relationFieldId = await createOneWayRelationField(page, {
      fieldName: relationName,
      relatedDatabaseId: state.target.databaseId,
    });
    state.rollupFieldId = await createRollupCountFieldDirect(page, {
      fieldName: rollupName,
      relationFieldId: state.relationFieldId,
    });
  }
);

Given('the source row initially links one target', async ({ page }) => {
  const state = stateFor(page);
  const firstTargetRowId = state.target?.rowIds[0];

  if (!firstTargetRowId) throw new Error('Rollup target rows are unavailable');
  await setRelationCellDirect(page, state.relationFieldId, 0, [firstTargetRowId]);
  await expect(rollupCell(page, state)).toHaveText('1', { timeout: 20_000 });
});

Given('the rollup source grid is sorted by {string}', async ({ page }, fieldName: string) => {
  await addSortByFieldName(page, fieldName);
});

When('the source relation is expanded to all six targets without refreshing', async ({ page }) => {
  const state = stateFor(page);
  const targetRowIds = state.target?.rowIds.slice(0, 6) ?? [];

  expect(targetRowIds).toHaveLength(6);
  state.documentToken = `rollup-live-${Date.now()}`;
  await page.evaluate((token) => {
    (window as typeof window & { __ROLLUP_BDD_DOCUMENT_TOKEN__?: string }).__ROLLUP_BDD_DOCUMENT_TOKEN__ = token;
  }, state.documentToken);
  await setRelationCellDirect(page, state.relationFieldId, 0, targetRowIds);
});

Then('the source relation contains six targets', async ({ page }) => {
  const state = stateFor(page);
  const sourceRowId = state.source?.rowIds[0];

  if (!sourceRowId) throw new Error('Rollup source row is unavailable');
  await expect
    .poll(() => getRelationCellRowIdsDirect(page, state.relationFieldId, sourceRowId), {
      timeout: 20_000,
      message: 'Waiting for all relation row IDs to be stored',
    })
    .toHaveLength(6);
});

Then('the mounted rollup shows {string} without refreshing', async ({ page }, expected: string) => {
  const state = stateFor(page);

  await expect(rollupCell(page, state)).toHaveText(expected, { timeout: 20_000 });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __ROLLUP_BDD_DOCUMENT_TOKEN__?: string }).__ROLLUP_BDD_DOCUMENT_TOKEN__
      )
    )
    .toBe(state.documentToken);
});
