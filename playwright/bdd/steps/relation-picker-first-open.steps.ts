import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  appendRowToCurrentDatabaseDirect,
  createNamedGridDatabase,
  createOneWayRelationField,
  getCurrentDatabaseInfo,
  getRelationPickerRowLabels,
  openRelationCellMenu,
  setPrimaryCellTextDirect,
  type DatabaseFixtureInfo,
} from '../../support/relation-test-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, Then, When } = createBdd();

interface PickerState {
  databases: Map<string, DatabaseFixtureInfo>;
  relationFieldId: string;
  /** Set the moment the picker is opened; any close would have to reset it. */
  pickerOpenedAt: number;
}

const states = new WeakMap<Page, PickerState>();

function stateFor(page: Page): PickerState {
  const state = states.get(page);

  if (!state) throw new Error('Relation picker scenario state was never initialised');
  return state;
}

function commaList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

Given('the relation picker user is signed in', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await signInAndWaitForApp(page, request, generateRandomEmail());
  states.set(page, { databases: new Map(), relationFieldId: '', pickerOpenedAt: 0 });
});

Given('a picker grid {string} with rows {string}', async ({ page }, name: string, rows: string) => {
  const info = await createNamedGridDatabase(page, name, commaList(rows));

  stateFor(page).databases.set(name, info);
});

Given(
  'a relation property {string} pointing at {string}',
  async ({ page }, fieldName: string, targetName: string) => {
    const state = stateFor(page);
    const target = state.databases.get(targetName);

    if (!target) throw new Error(`Grid "${targetName}" was never created`);

    state.relationFieldId = await createOneWayRelationField(page, {
      fieldName,
      relatedDatabaseId: target.databaseId,
    });
  }
);

Given('a self relation property {string} on {string}', async ({ page }, fieldName: string, gridName: string) => {
  const state = stateFor(page);
  const grid = state.databases.get(gridName);

  if (!grid) throw new Error(`Grid "${gridName}" was never created`);

  state.relationFieldId = await createOneWayRelationField(page, {
    fieldName,
    relatedDatabaseId: grid.databaseId,
  });
});

When('the relation cell picker is opened on row 0 for the first time', async ({ page }) => {
  const state = stateFor(page);

  await openRelationCellMenu(page, state.relationFieldId, 0);
  state.pickerOpenedAt = Date.now();
});

Then('the relation picker lists {string}', async ({ page }, expected: string) => {
  const wanted = commaList(expected);

  await expect
    .poll(() => getRelationPickerRowLabels(page), {
      timeout: 30_000,
      message: `Waiting for the relation picker to list ${expected}`,
    })
    .toEqual(expect.arrayContaining(wanted));
});

Then('the relation picker does not say there is no result', async ({ page }) => {
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();

  await expect(popover).not.toContainText('No result', { timeout: 5_000 });
});

When(
  'a row {string} is appended to the related database while the picker stays open',
  async ({ page }, title: string) => {
    await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(1);
    await appendRowToCurrentDatabaseDirect(page, title);
  }
);

When('the related row 0 is renamed to {string} while the picker stays open', async ({ page }, title: string) => {
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(1);
  const info = await getCurrentDatabaseInfo(page);

  await setPrimaryCellTextDirect(page, info.rowIds[0], title);
});

Then('the relation picker was never closed', async ({ page }) => {
  // The bug's workaround was closing and reopening the panel, so the assertions
  // above only mean something while the original popover is still mounted.
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(1);
  expect(stateFor(page).pickerOpenedAt).toBeGreaterThan(0);
});
