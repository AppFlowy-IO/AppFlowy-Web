import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  addGlobalFilter,
  buildGlobalFilter,
  chooseGlobalFilterCondition,
  closeGlobalFilterMenu,
  DashboardSelectors,
  escapeRegExp,
  FieldType,
  fillGlobalFilterText,
  fixtureDatabase,
  globalFilterChip,
  memberPage,
  openGlobalFilterChip,
  parseMapping,
  readDashboardSetting,
  removeGlobalFilterTarget,
  selectGlobalFilter,
  splitList,
  startOfTodayUnix,
  statusOptionId,
  toggleGlobalFilterOption,
  writeDashboardSetting,
  type PersistedGlobalFilter,
} from '../../support/dashboard-test-helpers';

const { Given, When, Then } = createBdd();

const WIDGET_TIMEOUT = { timeout: 30_000 };
/** `DateFilterCondition.DateStartsOnOrAfter`. */
const DATE_STARTS_ON_OR_AFTER = 4;
/** `CheckboxFilterCondition.IsChecked`. */
const CHECKBOX_IS_CHECKED = 0;

function pairs(...values: string[]): string {
  const parts: string[] = [];

  for (let index = 0; index < values.length; index += 2) parts.push(`"${values[index]}" in "${values[index + 1]}"`);
  return parts.join(' and ');
}

async function savedFilter(page: Page, name: string): Promise<PersistedGlobalFilter | undefined> {
  return (await readDashboardSetting(page)).global_filters.find((filter) => filter.name === name);
}

async function appendSavedFilter(page: Page, filter: PersistedGlobalFilter) {
  const { global_filters: current } = await readDashboardSetting(page);

  await writeDashboardSetting(page, { global_filters: [...current, filter] });
  await expect(globalFilterChip(page, filter.name)).toBeVisible(WIDGET_TIMEOUT);
}

/** Toggle an option of a saved filter from its chip, as any viewer would in View mode. */
async function alsoSelectOption(scope: Page, filterName: string, option: string) {
  await openGlobalFilterChip(scope, filterName);
  await toggleGlobalFilterOption(scope, option);
  await closeGlobalFilterMenu(scope);
}

// ---------------------------------------------------------------------------
// Editing through the filter editor
// ---------------------------------------------------------------------------

When(
  'I add a {string} global filter mapped to {string} in {string} and {string} in {string}',
  async (
    { page },
    type: string,
    firstProperty: string,
    firstDatabase: string,
    secondProperty: string,
    secondDatabase: string
  ) => {
    await addGlobalFilter(page, type, parseMapping(pairs(firstProperty, firstDatabase, secondProperty, secondDatabase)));
  }
);

When('I select {string} in the open global filter', async ({ page }, option: string) => {
  await toggleGlobalFilterOption(page, option);
});

When('I choose the {string} condition in the open global filter', async ({ page }, condition: string) => {
  const trigger = DashboardSelectors.globalFilterCondition(page);

  await expect(trigger).toBeVisible();
  if (new RegExp(`^\\s*${escapeRegExp(condition)}\\s*$`, 'i').test((await trigger.textContent()) ?? '')) return;
  await chooseGlobalFilterCondition(page, condition);
  await expect(trigger).toContainText(condition);
});

When('I type {string} into the open global filter', async ({ page }, text: string) => {
  await fillGlobalFilterText(page, text);
});

When('I close the global filter editor', async ({ page }) => {
  await closeGlobalFilterMenu(page);
});

When('I open the {string} global filter', async ({ page }, name: string) => {
  await openGlobalFilterChip(page, name);
});

When('I remove the {string} source from the open global filter', async ({ page }, database: string) => {
  await removeGlobalFilterTarget(page, fixtureDatabase(page, database).databaseId);
});

When('I delete the open global filter', async ({ page }) => {
  await DashboardSelectors.globalFilterDelete(page).click();
  await expect(DashboardSelectors.globalFilterMenu(page)).toBeHidden();
});

/**
 * The date filter editor reuses the view filter's date picker, which the
 * view-filter suites already drive; this step writes the condition straight
 * into the saved filter so the scenario can focus on cross-source matching.
 */
When('the saved {string} filter keeps dates on or after today', async ({ page }, name: string) => {
  await expect.poll(async () => Boolean(await savedFilter(page, name)), WIDGET_TIMEOUT).toBe(true);
  const { global_filters: filters } = await readDashboardSetting(page);

  await writeDashboardSetting(page, {
    global_filters: filters.map((filter) =>
      filter.name === name
        ? {
            ...filter,
            condition: DATE_STARTS_ON_OR_AFTER,
            content: JSON.stringify({ timestamp: startOfTodayUnix() }),
          }
        : filter
    ),
  });
});

// ---------------------------------------------------------------------------
// Seeded (saved) filters
// ---------------------------------------------------------------------------

Given(
  'the dashboard has a saved {string} filter for {string} mapped to {string} in {string} and {string} in {string}',
  async (
    { page },
    name: string,
    options: string,
    firstProperty: string,
    firstDatabase: string,
    secondProperty: string,
    secondDatabase: string
  ) => {
    const mapping = parseMapping(pairs(firstProperty, firstDatabase, secondProperty, secondDatabase));

    await appendSavedFilter(page, selectGlobalFilter(page, name, splitList(options), mapping));
  }
);

Given(
  'the dashboard has a saved {string} filter for {string} mapped to {string} in {string}',
  async ({ page }, name: string, options: string, property: string, database: string) => {
    await appendSavedFilter(
      page,
      selectGlobalFilter(page, name, splitList(options), parseMapping(pairs(property, database)))
    );
  }
);

Given(
  'the dashboard has a saved checked {string} filter mapped to {string} in {string} and {string} in {string}',
  async (
    { page },
    name: string,
    firstProperty: string,
    firstDatabase: string,
    secondProperty: string,
    secondDatabase: string
  ) => {
    const mapping = parseMapping(pairs(firstProperty, firstDatabase, secondProperty, secondDatabase));

    await appendSavedFilter(page, buildGlobalFilter(page, name, FieldType.Checkbox, CHECKBOX_IS_CHECKED, '', mapping));
  }
);

// ---------------------------------------------------------------------------
// Chips and saved state
// ---------------------------------------------------------------------------

Then('the {string} global filter chip shows {int} source(s)', async ({ page }, name: string, count: number) => {
  const chip = globalFilterChip(page, name);

  await expect(DashboardSelectors.globalFilterBar(page)).toBeVisible();
  await expect(chip).toBeVisible(WIDGET_TIMEOUT);
  await expect(chip.getByTestId('dashboard-global-filter-chip-count')).toHaveText(String(count));
  // A View-mode change stays local to this viewer, so only the chip shows it.
  if (await DashboardSelectors.globalFilterLocalBadge(page).first().isVisible()) return;
  await expect.poll(async () => Object.keys((await savedFilter(page, name))?.targets ?? {}).length).toBe(count);
});

Then('the dashboard shows {int} global filter chip(s)', async ({ page }, count: number) => {
  await expect(DashboardSelectors.globalFilterChips(page)).toHaveCount(count, WIDGET_TIMEOUT);
});

Then(
  'the saved {string} filter targets {string} in {string} and {string} in {string}',
  async (
    { page },
    name: string,
    firstProperty: string,
    firstDatabase: string,
    secondProperty: string,
    secondDatabase: string
  ) => {
    const mapping = parseMapping(pairs(firstProperty, firstDatabase, secondProperty, secondDatabase));
    const expected: Record<string, string> = {};

    Object.entries(mapping).forEach(([database, property]) => {
      const fixture = fixtureDatabase(page, database);

      expected[fixture.databaseId] = fixture.fieldIds[property];
    });
    await expect.poll(async () => (await savedFilter(page, name))?.targets).toEqual(expected);
    expect((await savedFilter(page, name))?.ty).toBe(FieldType.SingleSelect);
  }
);

Then('the saved dashboard has no global filters', async ({ page }) => {
  await expect.poll(async () => (await readDashboardSetting(page)).global_filters.length).toBe(0);
});

Then('the saved {string} filter still matches only {string}', async ({ page }, name: string, option: string) => {
  const filter = await savedFilter(page, name);

  expect(filter, `no saved "${name}" filter`).toBeTruthy();
  expect(splitList(filter?.content ?? '')).toEqual([statusOptionId(option)]);
});

Then('the saved {string} filter matches {string}', async ({ page }, name: string, options: string) => {
  const expected = splitList(options).map(statusOptionId).sort();

  await expect.poll(async () => splitList((await savedFilter(page, name))?.content ?? '').sort()).toEqual(expected);
});

// ---------------------------------------------------------------------------
// View-mode (local) changes
// ---------------------------------------------------------------------------

When('I also select {string} in the {string} global filter', async ({ page }, option: string, name: string) => {
  await alsoSelectOption(page, name, option);
});

When(
  'the member also selects {string} in the {string} global filter',
  async ({ page }, option: string, name: string) => {
    await alsoSelectOption(memberPage(page), name, option);
  }
);

Then('the {string} global filter shows the local changes badge', async ({ page }, name: string) => {
  await expect(globalFilterChip(page, name)).toBeVisible();
  await expect(DashboardSelectors.globalFilterLocalBadge(page).first()).toBeVisible();
  await expect(DashboardSelectors.globalFilterLocalBadge(page).first()).toContainText(/Only you see/);
});

Then('no global filter shows the local changes badge', async ({ page }) => {
  await expect(DashboardSelectors.globalFilterLocalBadge(page)).toHaveCount(0, WIDGET_TIMEOUT);
});

When('I save the global filters for everybody', async ({ page }) => {
  const save = DashboardSelectors.globalFilterSaveForEverybody(page);

  if (!(await save.isVisible())) await DashboardSelectors.globalFilterLocalBadge(page).first().click();
  await expect(save).toBeVisible();
  await save.click();
});

Then('the member sees the local changes badge without a Save for everybody button', async ({ page }) => {
  const member = memberPage(page);

  await expect(DashboardSelectors.globalFilterLocalBadge(member).first()).toBeVisible();
  await DashboardSelectors.globalFilterLocalBadge(member).first().click();
  await expect(DashboardSelectors.globalFilterSaveForEverybody(member)).toHaveCount(0);
  await member.keyboard.press('Escape');
});
