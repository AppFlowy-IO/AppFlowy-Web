import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  fieldRowsOf,
  listedFieldOptions,
  listedSourceGroups,
  offeredOptionNames,
  openPill,
  parseRelativeDateInput,
  pickGlobalFilterProperty,
  pillLabel,
  relativeDateSummary,
  savedGlobalFilter,
  setRelativeDate,
} from '../../support/dashboard-global-filter-helpers';
import { pressEscapeUntilHidden, WIDGET_TIMEOUT, WIDGET_TIMEOUT_MS } from '../../support/dashboard-shared-helpers';
import {
  closeGlobalFilterMenu,
  DASHBOARD_FIXTURE_DATABASES,
  DashboardSelectors,
  dashboardWorld,
  FieldType,
  fixtureDatabase,
  globalFilterChip,
  knownWidget,
  memberPage,
  openDashboardAsMember,
  openGlobalFilterChip,
  openGlobalFilterMenu,
  splitList,
} from '../../support/dashboard-test-helpers';
import { DatabaseFilterSelectors } from '../../support/selectors';

const { When, Then } = createBdd();

/** `FieldType` by the name the property type menus show. */
const TYPE_BY_LABEL: Record<string, FieldType> = {
  Text: FieldType.RichText,
  Number: FieldType.Number,
  'Single select': FieldType.SingleSelect,
  'Multi select': FieldType.MultiSelect,
  Checkbox: FieldType.Checkbox,
  Date: FieldType.DateTime,
};

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

When('I open the dashboard filter menu', async ({ page }) => {
  await openGlobalFilterMenu(page);
});

Then('the filter menu search box is focused', async ({ page }) => {
  await expect(DashboardSelectors.globalFilterSearch(page)).toBeFocused();
  await expect(DashboardSelectors.globalFilterSearch(page)).toHaveAttribute('placeholder', 'Filter by…');
});

Then(
  'the filter menu groups properties under {string} with {string}, {string} with {string} and {string} with {string}',
  async ({ page }, first: string, firstCount: string, second: string, secondCount: string, third: string, thirdCount: string) => {
    const expected = [
      [first, firstCount],
      [second, secondCount],
      [third, thirdCount],
    ].map(([database, count]) => ({ databaseId: fixtureDatabase(page, database).databaseId, text: `${database} ${count}` }));

    // Groups follow the widgets' order; each header names the source and its widget count.
    await expect.poll(() => listedSourceGroups(page), WIDGET_TIMEOUT).toEqual(expected);
  }
);

When(
  'I pick the {string} property of {string} in the filter menu',
  async ({ page }, property: string, database: string) => {
    await pickGlobalFilterProperty(page, page, database, property);
  }
);

When('I search the filter menu for {string}', async ({ page }, query: string) => {
  const search = DashboardSelectors.globalFilterSearch(page);

  await search.fill(query);
  await expect(search).toHaveValue(query);
});

Then('the filter menu lists only {string} in {string}', async ({ page }, property: string, database: string) => {
  const fixture = fixtureDatabase(page, database);

  await expect
    .poll(async () => (await listedFieldOptions(page)).map((row) => ({ databaseId: row.databaseId, name: row.name })))
    .toEqual([{ databaseId: fixture.databaseId, name: property }]);
});

Then('the filter menu says {string}', async ({ page }, text: string) => {
  await expect(DashboardSelectors.globalFilterNoResults(page)).toHaveText(text);
  await expect(DashboardSelectors.globalFilterFieldOptions(page)).toHaveCount(0);
});

Then(
  'the {string} group of the filter menu shows {int} properties and {string}',
  async ({ page }, database: string, count: number, more: string) => {
    const { databaseId } = fixtureDatabase(page, database);
    const moreRow = DashboardSelectors.globalFilterMore(page, databaseId);

    await expect(fieldRowsOf(page, databaseId)).toHaveCount(count, WIDGET_TIMEOUT);
    await expect(moreRow).toHaveText(more);
    await expect(moreRow).toHaveAttribute('data-count', more.replace(/\D+/g, ''));
  }
);

When('I expand the {string} group of the filter menu', async ({ page }, database: string) => {
  const moreRow = DashboardSelectors.globalFilterMore(page, fixtureDatabase(page, database).databaseId);

  await moreRow.click();
  await expect(moreRow).toHaveCount(0);
});

Then(
  'the {string} group of the filter menu shows {int} properties',
  async ({ page }, database: string, count: number) => {
    const { databaseId } = fixtureDatabase(page, database);

    await expect(fieldRowsOf(page, databaseId)).toHaveCount(count, WIDGET_TIMEOUT);
    await expect(DashboardSelectors.globalFilterMore(page, databaseId)).toHaveCount(0);
  }
);

Then(
  'the filter menu lists the properties of {string} without group headers',
  async ({ page }, database: string) => {
    const { databaseId } = fixtureDatabase(page, database);

    await expect(DashboardSelectors.globalFilterSourceGroups(page)).toHaveCount(0);
    // Name, Status, Estimate, Due, Urgent and Region: fewer than the flat list's 8.
    await expect(fieldRowsOf(page, databaseId)).toHaveCount(6, WIDGET_TIMEOUT);
    await expect.poll(async () => (await listedFieldOptions(page)).every((row) => row.databaseId === databaseId)).toBe(true);
  }
);

Then('the filter menu does not offer {string}', async ({ page }, label: string) => {
  expect(label).toBe('Filter multiple sources');
  await expect(DashboardSelectors.globalFilterMenu(page)).toBeVisible();
  await expect(DashboardSelectors.globalFilterMultipleSources(page)).toHaveCount(0);
});

When('I choose {string} in the filter menu', async ({ page }, label: string) => {
  const footer = DashboardSelectors.globalFilterMultipleSources(page);

  expect(label).toBe('Filter multiple sources');
  await expect(footer).toHaveText(label);
  await footer.click();
});

Then('the filter menu explains {string}', async ({ page }, text: string) => {
  const intro = DashboardSelectors.globalFilterMultiIntro(page);

  await expect(DashboardSelectors.globalFilterMenu(page)).toHaveAttribute('data-screen', 'multi-intro');
  await expect(intro).toContainText(text);
});

When('I click {string} in the filter menu', async ({ page }, label: string) => {
  const button = DashboardSelectors.globalFilterAddToFilter(page);

  expect(label).toBe('Add to filter');
  await expect(button).toHaveText(label);
  await button.click();
  await expect(DashboardSelectors.globalFilterMenu(page)).toHaveAttribute('data-screen', 'multi-picker');
});

Then(
  'the multiple sources builder lists {string} from {string}',
  async ({ page }, property: string, database: string) => {
    const target = DashboardSelectors.globalFilterTarget(page, fixtureDatabase(page, database).databaseId);

    await expect(DashboardSelectors.globalFilterBuilder(page)).toBeVisible();
    await expect(target).toContainText(property);
    await expect(target).toContainText(database);
    await expect(target).toHaveAttribute('data-field-id', fixtureDatabase(page, database).fieldIds[property]);
  }
);

When('I choose {string} in the multiple sources builder', async ({ page }, label: string) => {
  const button = DashboardSelectors.globalFilterAddAnother(page);

  expect(label).toBe('Add another');
  await expect(button).toHaveText(label);
  await button.click();
  await expect(DashboardSelectors.globalFilterMenu(page)).toHaveAttribute('data-screen', 'add-another');
});

/** No unmapped source has a property of the filter's type: the builder hides "Add another" (WP08 §1.4). */
Then('the multiple sources builder does not offer {string}', async ({ page }, label: string) => {
  expect(label).toBe('Add another');
  await expect(DashboardSelectors.globalFilterBuilder(page)).toBeVisible();
  await expect(DashboardSelectors.globalFilterAddAnother(page)).toHaveCount(0);
});

/** "Add another": only the type's properties, from the sources the filter does not map yet. */
Then(
  'the filter menu only offers {string} properties from {string}',
  async ({ page }, typeLabel: string, database: string) => {
    const type = TYPE_BY_LABEL[typeLabel];

    if (type === undefined) throw new Error(`Unknown property type "${typeLabel}"`);
    const fixture = fixtureDatabase(page, database);
    const expected = DASHBOARD_FIXTURE_DATABASES[database].fields
      .filter((field) => field.type === type)
      .map((field) => ({ databaseId: fixture.databaseId, fieldId: fixture.fieldIds[field.name] }));

    expect(expected.length).toBeGreaterThan(0);
    await expect(DashboardSelectors.globalFilterMenu(page)).toHaveAttribute('data-screen', 'add-another');
    await expect
      .poll(async () => (await listedFieldOptions(page)).map(({ databaseId, fieldId }) => ({ databaseId, fieldId })))
      .toEqual(expected);
  }
);

When('I click Done in the multiple sources builder', async ({ page }) => {
  await DashboardSelectors.globalFilterDone(page).click();
  await expect(DashboardSelectors.globalFilterPillEditor(page)).toBeVisible(WIDGET_TIMEOUT);
});

// ---------------------------------------------------------------------------
// Pills
// ---------------------------------------------------------------------------

Then('the {string} global filter pill is open with its value focused', async ({ page }, name: string) => {
  const editor = DashboardSelectors.globalFilterPillEditor(page);
  const chip = globalFilterChip(page, name);

  await expect(editor).toBeVisible(WIDGET_TIMEOUT);
  await expect(editor).toHaveAttribute('data-filter-id', (await chip.getAttribute('data-filter-id')) ?? '');
  // The value control (a select's option search here) has the focus.
  await expect
    .poll(() =>
      DashboardSelectors.globalFilterContent(page).evaluate((content) => content.contains(document.activeElement))
    )
    .toBe(true);
});

Then('the {string} global filter pill reads {string}', async ({ page }, name: string, text: string) => {
  const chip = globalFilterChip(page, name);

  await expect(pillLabel(chip)).toHaveText(text, WIDGET_TIMEOUT);
  await expect(chip).toHaveAttribute('data-active', 'true');
});

Then('the {string} global filter pill reads {string} and looks empty', async ({ page }, name: string, text: string) => {
  const chip = globalFilterChip(page, name);

  await expect(pillLabel(chip)).toHaveText(text, WIDGET_TIMEOUT);
  // Grey: the empty pill's surface and text, not the active light blue.
  await expect(chip).toHaveAttribute('data-active', 'false');
  await expect(chip).toHaveClass(/bg-dash-pill-bg(?!-active)/);
});

Then(
  'the {string} global filter pill shows a source count badge of {int}',
  async ({ page }, name: string, count: number) => {
    const chip = globalFilterChip(page, name);

    await expect(chip.getByTestId('dashboard-global-filter-chip-count')).toHaveText(String(count), WIDGET_TIMEOUT);
    await expect(chip).toHaveAttribute('data-source-count', String(count));
  }
);

Then('the open global filter offers the options {string}', async ({ page }, names: string) => {
  await expect.poll(() => offeredOptionNames(page), WIDGET_TIMEOUT).toEqual(splitList(names));
});

When(
  'I set the relative date to {string} {int} {string} in the open global filter',
  async ({ page }, direction: string, amount: number, unit: string) => {
    const spec = parseRelativeDateInput(direction, amount, unit);
    const chip = await openPill(page);

    await setRelativeDate(page, 'dashboard-global-filter', spec);
    // Written once the amount input pauses: the pill under the editor follows.
    await expect(pillLabel(chip)).toContainText(relativeDateSummary(spec), WIDGET_TIMEOUT);
  }
);

Then('the open global filter says {string}', async ({ page }, text: string) => {
  await expect(DashboardSelectors.globalFilterRelativeHint(page)).toHaveText(text);
});

// ---------------------------------------------------------------------------
// Saved filters
// ---------------------------------------------------------------------------

Then(
  'the saved {string} filter targets only {string} in {string}',
  async ({ page }, name: string, property: string, database: string) => {
    const fixture = fixtureDatabase(page, database);

    await expect
      .poll(async () => (await savedGlobalFilter(page, name))?.targets)
      .toEqual({ [fixture.databaseId]: fixture.fieldIds[property] });
    expect((await savedGlobalFilter(page, name))?.content).toBe('');
  }
);

Then('the saved {string} filter remembers the option names {string}', async ({ page }, name: string, names: string) => {
  await expect.poll(async () => (await savedGlobalFilter(page, name))?.option_names).toEqual(splitList(names));
});

Then(
  'the saved {string} filter is relative to today with {string}, {int} and {string}',
  async ({ page }, name: string, direction: string, amount: number, unit: string) => {
    await expect
      .poll(async () => {
        const filter = await savedGlobalFilter(page, name);

        if (!filter) return null;
        let content: unknown = null;

        try {
          content = JSON.parse(filter.content);
        } catch {
          content = filter.content;
        }

        return { condition: filter.condition, content };
      })
      .toEqual({
        // `DateFilterCondition.DateStartsRelative`.
        condition: 28,
        content: { relative_direction: direction, relative_amount: amount, relative_unit: unit },
      });
  }
);

// ---------------------------------------------------------------------------
// The bar and the toolbar button
// ---------------------------------------------------------------------------

Then('the dashboard does not show the global filter bar', async ({ page }) => {
  await expect(DashboardSelectors.view(page)).toBeVisible();
  await expect(DashboardSelectors.globalFilterBar(page)).toHaveCount(0, WIDGET_TIMEOUT);
});

Then('the dashboard shows the global filter bar with a {string} button', async ({ page }, label: string) => {
  const add = DashboardSelectors.globalFilterBarAdd(page);

  expect(label).toBe('+ Filter');
  await expect(DashboardSelectors.globalFilterBar(page)).toBeVisible(WIDGET_TIMEOUT);
  await expect(add).toBeVisible();
  await expect(add).toHaveText('Filter');
});

Then('the dashboard filter button is highlighted without a count badge', async ({ page }) => {
  const button = DashboardSelectors.globalFilterButton(page);

  await expect(button).toHaveAttribute('data-active', 'true', WIDGET_TIMEOUT);
  await expect(button).toHaveClass(/text-dash-accent/);
  await expect(button.getByTestId('dashboard-global-filter-button-badge')).toHaveCount(0);
  await expect(button).toHaveText('');
});

// ---------------------------------------------------------------------------
// A widget filter relative to today
// ---------------------------------------------------------------------------

When(
  'I add a {string} is relative to today {string} {int} {string} filter inside the {string} widget',
  async ({ page }, property: string, direction: string, amount: number, unit: string, label: string) => {
    const widget = DashboardSelectors.widget(page, knownWidget(page, label).id);
    const popover = page.getByTestId('dashboard-widget-filters-popover');

    await expect(widget).toBeVisible(WIDGET_TIMEOUT);
    await widget.hover();
    await widget.getByTestId('database-actions-filter').click();
    await DatabaseFilterSelectors.propertyItemByName(page, property).filter({ visible: true }).first().click();
    const menu = page.getByTestId('date-filter').filter({ visible: true }).last();

    await expect(menu).toBeVisible();
    await menu.getByTestId('filter-condition-trigger').click();
    // `DateFilterCondition.DateStartsRelative`: "Is relative to today".
    await page.locator('[data-testid="filter-condition-28"]:visible').last().click();
    await setRelativeDate(page, 'date-filter', parseRelativeDateInput(direction, amount, unit));
    await pressEscapeUntilHidden(page, popover);
  }
);

// ---------------------------------------------------------------------------
// A read-only member
// ---------------------------------------------------------------------------

When('the member opens the dashboard filter menu', async ({ page }) => {
  const member = dashboardWorld(page).member?.page ?? (await openDashboardAsMember(page));

  await openGlobalFilterMenu(member);
});

Then(
  "the member's filter menu lists the filters {string} without a search box or {string}",
  async ({ page }, names: string, footer: string) => {
    const member = memberPage(page);

    expect(footer).toBe('Filter multiple sources');
    await expect(DashboardSelectors.globalFilterMenu(member)).toHaveAttribute('data-screen', 'reader-list');
    await expect
      .poll(() =>
        DashboardSelectors.globalFilterReaderItems(member).evaluateAll((items) =>
          items.map((item) => (item.textContent ?? '').trim())
        )
      )
      .toEqual(splitList(names).map((name) => expect.stringContaining(name)));
    await expect(DashboardSelectors.globalFilterSearch(member)).toHaveCount(0);
    await expect(DashboardSelectors.globalFilterMultipleSources(member)).toHaveCount(0);
  }
);

Then('the member does not see the {string} button', async ({ page }, label: string) => {
  const member = memberPage(page);

  expect(label).toBe('+ Filter');
  await expect(DashboardSelectors.globalFilterBar(member)).toBeVisible(WIDGET_TIMEOUT);
  await expect(DashboardSelectors.globalFilterBarAdd(member)).toHaveCount(0);
});

/** A reader's pill editor has no `···`, so no "Delete filter"; the filter stays saved. */
Then('the member cannot delete the {string} global filter', async ({ page }, name: string) => {
  const member = memberPage(page);

  if (await DashboardSelectors.globalFilterMenu(member).isVisible()) await closeGlobalFilterMenu(member);
  await openGlobalFilterChip(member, name);
  await expect(DashboardSelectors.globalFilterPillEditor(member)).toBeVisible();
  await expect(DashboardSelectors.globalFilterMoreActions(member)).toHaveCount(0);
  await expect(DashboardSelectors.globalFilterDelete(member)).toHaveCount(0);
  await member.keyboard.press('Escape');
  await expect(globalFilterChip(member, name)).toBeVisible();
  await expect.poll(async () => Boolean(await savedGlobalFilter(page, name)), { timeout: WIDGET_TIMEOUT_MS }).toBe(true);
});
