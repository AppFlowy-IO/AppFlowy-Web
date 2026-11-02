import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  defaultGlobalFilterCondition,
  deleteGlobalFilter,
  deleteOpenGlobalFilter,
  fixturePropertyType,
  toggleGlobalFilterOptionByName,
  type PersistedGlobalFilterWithNames,
} from '../../support/dashboard-global-filter-helpers';
import {
  clickFilterBarControl,
  expectChipDot,
  expectNoUnsavedDots,
  filterBarControl,
  PrivateSelectors,
} from '../../support/dashboard-private-helpers';
import { WIDGET_TIMEOUT } from '../../support/dashboard-shared-helpers';
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
  waitForDashboardSync,
  writeDashboardSetting,
  type PersistedGlobalFilter,
} from '../../support/dashboard-test-helpers';

const { Given, When, Then } = createBdd();

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

async function appendSavedFilter(page: Page, request: APIRequestContext, filter: PersistedGlobalFilter) {
  const { global_filters: current } = await readDashboardSetting(page);

  await writeDashboardSetting(page, { global_filters: [...current, filter] });
  await expect(globalFilterChip(page, filter.name)).toBeVisible(WIDGET_TIMEOUT);
  // A "saved" filter is on the server, so a following reload cannot drop it.
  await waitForDashboardSync(page, request);
}

/**
 * A select filter saved by a current client: the option names go with the
 * ids (WP08 §1.9), so a viewer who picks the same options again has nothing
 * left to save.
 */
function savedSelectFilter(page: Page, name: string, options: string[], mapping: Record<string, string>) {
  const filter: PersistedGlobalFilterWithNames = selectGlobalFilter(page, name, options, mapping);

  return options.length > 0 ? { ...filter, option_names: options } : filter;
}

/** Toggle an option of a saved filter from its chip, as any viewer would in View mode. */
async function alsoSelectOption(scope: Page, filterName: string, option: string) {
  // A menu left open (the toolbar's filter list) closes first, as a click outside it would.
  if (await DashboardSelectors.globalFilterMenu(scope).isVisible()) await closeGlobalFilterMenu(scope);
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

/** Options are listed merged by name across the filter's sources (WP08 §1.9). */
When('I select {string} in the open global filter', async ({ page }, option: string) => {
  await toggleGlobalFilterOptionByName(page, option, true);
});

When('I deselect {string} in the open global filter', async ({ page }, option: string) => {
  await toggleGlobalFilterOptionByName(page, option, false);
});

// The editor shows the condition in Notion's lowercase (`is not ˅`).
When('I choose the {string} condition in the open global filter', async ({ page }, condition: string) => {
  const trigger = DashboardSelectors.globalFilterCondition(page);
  const exactly = new RegExp(`^\\s*${escapeRegExp(condition)}\\s*$`, 'i');

  await expect(trigger).toBeVisible();
  if (exactly.test((await trigger.textContent()) ?? '')) return;
  await chooseGlobalFilterCondition(page, condition);
  await expect(trigger).toHaveText(exactly);
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

/** Delete is in the pill editor's `···` menu (writers). */
When('I delete the open global filter', async ({ page }) => {
  await deleteOpenGlobalFilter(page);
});

When('I delete the {string} global filter', async ({ page }, name: string) => {
  await deleteGlobalFilter(page, name);
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
    { page, request },
    name: string,
    options: string,
    firstProperty: string,
    firstDatabase: string,
    secondProperty: string,
    secondDatabase: string
  ) => {
    const mapping = parseMapping(pairs(firstProperty, firstDatabase, secondProperty, secondDatabase));

    await appendSavedFilter(page, request, savedSelectFilter(page, name, splitList(options), mapping));
  }
);

Given(
  'the dashboard has a saved {string} filter for {string} mapped to {string} in {string}',
  async ({ page, request }, name: string, options: string, property: string, database: string) => {
    await appendSavedFilter(
      page,
      request,
      savedSelectFilter(page, name, splitList(options), parseMapping(pairs(property, database)))
    );
  }
);

Given(
  'the dashboard has a saved checked {string} filter mapped to {string} in {string} and {string} in {string}',
  async (
    { page, request },
    name: string,
    firstProperty: string,
    firstDatabase: string,
    secondProperty: string,
    secondDatabase: string
  ) => {
    const mapping = parseMapping(pairs(firstProperty, firstDatabase, secondProperty, secondDatabase));

    await appendSavedFilter(
      page,
      request,
      buildGlobalFilter(page, name, FieldType.Checkbox, CHECKBOX_IS_CHECKED, '', mapping)
    );
  }
);

/** A filter of the first property's type with its default condition and no value (a grey pill, WP08 §1.5). */
async function appendEmptyFilter(page: Page, request: APIRequestContext, name: string, mapping: Record<string, string>) {
  const [database, property] = Object.entries(mapping)[0];
  const type = fixturePropertyType(database, property);

  await appendSavedFilter(
    page,
    request,
    buildGlobalFilter(page, name, type, defaultGlobalFilterCondition(type), '', mapping)
  );
}

Given(
  'the dashboard has a saved {string} filter with no value mapped to {string} in {string} and {string} in {string}',
  async (
    { page, request },
    name: string,
    firstProperty: string,
    firstDatabase: string,
    secondProperty: string,
    secondDatabase: string
  ) => {
    await appendEmptyFilter(
      page,
      request,
      name,
      parseMapping(pairs(firstProperty, firstDatabase, secondProperty, secondDatabase))
    );
  }
);

Given(
  'the dashboard has a saved {string} filter with no value mapped to {string} in {string}',
  async ({ page, request }, name: string, property: string, database: string) => {
    await appendEmptyFilter(page, request, name, parseMapping(pairs(property, database)));
  }
);

// ---------------------------------------------------------------------------
// Chips and saved state
// ---------------------------------------------------------------------------

/**
 * The pill counts its usable sources from 2 on (a badge on its type icon);
 * with one source it has no badge (WP08 §1.5). Sources are a shared setting,
 * so the saved filter maps the same number.
 */
Then('the {string} global filter chip shows {int} source(s)', async ({ page }, name: string, count: number) => {
  const chip = globalFilterChip(page, name);
  const badge = chip.getByTestId('dashboard-global-filter-chip-count');

  await expect(DashboardSelectors.globalFilterBar(page)).toBeVisible();
  await expect(chip).toBeVisible(WIDGET_TIMEOUT);
  await expect(chip).toHaveAttribute('data-source-count', String(count));
  if (count >= 2) await expect(badge).toHaveText(count > 9 ? '9+' : String(count));
  else await expect(badge).toHaveCount(0);
  await expect.poll(async () => Object.keys((await savedFilter(page, name))?.targets ?? {}).length).toBe(count);
});

Then('the {string} global filter pill has no source count badge', async ({ page }, name: string) => {
  const chip = globalFilterChip(page, name);

  await expect(chip).toBeVisible(WIDGET_TIMEOUT);
  await expect(chip).toHaveAttribute('data-source-count', '1');
  await expect(chip.getByTestId('dashboard-global-filter-chip-count')).toHaveCount(0);
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

When('I deselect {string} in the {string} global filter', async ({ page }, option: string, name: string) => {
  await openGlobalFilterChip(page, name);
  await toggleGlobalFilterOptionByName(page, option, false);
  await closeGlobalFilterMenu(page);
});

When(
  'the member also selects {string} in the {string} global filter',
  async ({ page }, option: string, name: string) => {
    await alsoSelectOption(memberPage(page), name, option);
  }
);

Then('the {string} global filter shows an unsaved dot', async ({ page }, name: string) => {
  await expectChipDot(page, name);
});

Then('no unsaved dot is shown on the dashboard', async ({ page }) => {
  await expectNoUnsavedDots(page);
});

When('I click {string} in the filter bar', async ({ page }, label: string) => {
  await clickFilterBarControl(page, label);
});

When('the member clicks {string} in the filter bar', async ({ page }, label: string) => {
  await clickFilterBarControl(memberPage(page), label);
});

Then('the member sees no unsaved dot on the dashboard', async ({ page }) => {
  await expectNoUnsavedDots(memberPage(page));
});

Then('the member sees {string} but no {string} in the filter bar', async ({ page }, shown: string, hidden: string) => {
  const member = memberPage(page);

  await expect(DashboardSelectors.privateControls(member)).toBeVisible(WIDGET_TIMEOUT);
  await expect(filterBarControl(member, shown)).toHaveText(shown);
  await expect(filterBarControl(member, hidden)).toHaveCount(0);
  // Without "Save for everyone" there is no save menu either.
  if (hidden === 'Save for everyone') await expect(PrivateSelectors.saveMenuTrigger(member)).toHaveCount(0);
});
