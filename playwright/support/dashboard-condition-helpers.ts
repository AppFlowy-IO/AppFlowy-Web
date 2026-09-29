import { expect, type Page } from '@playwright/test';

import {
  databaseForLabel,
  DashboardSelectors,
  escapeRegExp,
  fixtureDatabase,
  gridDataRows,
  knownWidget,
  readDashboardSetting,
  readViewConditions,
  viewIdForLabel,
  waitForDatabaseContext,
} from './dashboard-test-helpers';
import { DatabaseFilterSelectors } from './selectors';

export type WidgetSortDirection = 'ascending' | 'descending';

/** The UI belongs to scope; fixture identities always belong to the scenario's owner page. */
export async function addWidgetSort(
  scope: Page,
  ownerPage: Page,
  label: string,
  field: string,
  direction: WidgetSortDirection
) {
  const widget = DashboardSelectors.widget(scope, knownWidget(ownerPage, label).id);
  const chip = widget.getByTestId('database-sort-condition');

  await expect(widget).toBeVisible({ timeout: 30_000 });
  await widget.hover();
  if ((await chip.count()) > 0) {
    if (!(await chip.isVisible())) await widget.getByTestId('database-actions-sort').click();
    await chip.click();
    await scope.getByRole('button', { name: /add.*sort/i }).click();
  } else {
    await widget.getByTestId('database-actions-sort').click();
  }

  await DatabaseFilterSelectors.propertyItemByName(scope, field).filter({ visible: true }).click();
  const sort = scope.getByTestId('sort-condition').filter({ hasText: new RegExp(escapeRegExp(field)) });
  const directionButton = sort.getByRole('button', { name: /ascending|descending/i });

  await expect(directionButton).toBeVisible();
  if (!new RegExp(direction, 'i').test((await directionButton.textContent()) ?? '')) {
    await directionButton.click();
    await scope.getByRole('menuitem', { name: new RegExp(`^${direction}$`, 'i') }).click();
  }

  await expect(directionButton).toHaveText(new RegExp(direction, 'i'));
  await scope.keyboard.press('Escape');
  await expect(sort).toBeHidden();
  await expect(chip).toBeVisible();
}

/** Assert identity and order, not just the presence of the same titles somewhere in the widget. */
export async function expectWidgetRowsInOrder(scope: Page, ownerPage: Page, label: string, titles: string[]) {
  const widget = DashboardSelectors.widget(scope, knownWidget(ownerPage, label).id);
  const fixture = fixtureDatabase(ownerPage, databaseForLabel(ownerPage, label));
  const rowTestIds = titles.map((title) => {
    const rowId = fixture.rowIds[title];

    if (!rowId) throw new Error(`The ${label} fixture has no row named "${title}"`);
    return `grid-row-${rowId}`;
  });

  await expect(widget).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => gridDataRows(widget).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid'))), {
      timeout: 30_000,
    })
    .toEqual(rowTestIds);
}

export async function resetDashboardConditions(scope: Page) {
  const reset = scope.getByTestId('dashboard-global-filter-reset');

  await expect(reset).toBeVisible();
  await reset.click();
  await expect(DashboardSelectors.globalFilterLocalBadge(scope)).toHaveCount(0);
}

/** Read the canonical shared documents, never the private overlay used to render a widget. */
export async function readSavedDashboardConditions(page: Page, labels: string[]) {
  // A reload only waits for the host; foreign widgets mount their source database later.
  for (const label of labels) await waitForDatabaseContext(page, knownWidget(page, label).databaseId);
  const { global_filters: globalFilters } = await readDashboardSetting(page);
  const views = Object.fromEntries(
    await Promise.all(labels.map(async (label) => [label, await readViewConditions(page, viewIdForLabel(page, label))]))
  );

  return { globalFilters, views };
}
