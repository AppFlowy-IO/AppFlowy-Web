import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  addWidgetSort,
  expectWidgetRowsInOrder,
  readSavedDashboardConditions,
  resetDashboardConditions,
  type WidgetSortDirection,
} from '../../support/dashboard-condition-helpers';
import {
  databaseForLabel,
  DashboardSelectors,
  fixtureDatabase,
  knownWidget,
  memberPage,
  readViewConditions,
  splitList,
  viewIdForLabel,
} from '../../support/dashboard-test-helpers';

const { Given, When, Then } = createBdd();
const sharedSnapshots = new WeakMap<Page, Awaited<ReturnType<typeof readSavedDashboardConditions>>>();
const fixtureLabels = ['Projects Grid', 'Tasks Grid'];

function sortDirection(value: string): WidgetSortDirection {
  if (value !== 'ascending' && value !== 'descending') throw new Error(`Unknown sort direction "${value}"`);
  return value;
}

When(
  'I sort the {string} widget by {string} {string}',
  async ({ page }, label: string, field: string, direction: string) => {
    await addWidgetSort(page, page, label, field, sortDirection(direction));
  }
);

When(
  'the member sorts the {string} widget by {string} {string}',
  async ({ page }, label: string, field: string, direction: string) => {
    await addWidgetSort(memberPage(page), page, label, field, sortDirection(direction));
  }
);

Then('the {string} widget shows rows in order {string}', async ({ page }, label: string, titles: string) => {
  await expectWidgetRowsInOrder(page, page, label, splitList(titles));
});

Then('the member sees the {string} widget rows in order {string}', async ({ page }, label: string, titles: string) => {
  await expectWidgetRowsInOrder(memberPage(page), page, label, splitList(titles));
});

Then('the {string} view has {int} saved sorts', async ({ page }, label: string, count: number) => {
  await expect.poll(async () => (await readViewConditions(page, viewIdForLabel(page, label))).sorts.length).toBe(count);
});

Then(
  'the {string} view has a saved {string} sort by {string}',
  async ({ page }, label: string, direction: string, field: string) => {
    const fieldId = fixtureDatabase(page, databaseForLabel(page, label)).fieldIds[field];

    expect(fieldId, `The ${label} fixture has no property named "${field}"`).toBeTruthy();
    await expect
      .poll(async () => (await readViewConditions(page, viewIdForLabel(page, label))).sorts)
      .toEqual([
        expect.objectContaining({ field_id: fieldId, condition: sortDirection(direction) === 'ascending' ? 0 : 1 }),
      ]);
  }
);

Given('I remember the shared dashboard and widget conditions', async ({ page }) => {
  sharedSnapshots.set(page, await readSavedDashboardConditions(page, fixtureLabels));
});

Then('the shared dashboard and widget conditions are unchanged', async ({ page }) => {
  const saved = sharedSnapshots.get(page);

  expect(saved, 'Remember the shared conditions before making local changes').toBeDefined();
  expect(await readSavedDashboardConditions(page, fixtureLabels)).toEqual(saved);
});

When('I reset the dashboard local conditions', async ({ page }) => {
  await resetDashboardConditions(page);
});

When('the member resets the dashboard local conditions', async ({ page }) => {
  await resetDashboardConditions(memberPage(page));
});

Then('the {string} widget has no sort chip', async ({ page }, label: string) => {
  await expect(
    DashboardSelectors.widget(page, knownWidget(page, label).id).getByTestId('database-sort-condition')
  ).toHaveCount(0);
});
