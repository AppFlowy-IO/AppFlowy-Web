/**
 * Dashboard widget content (WP09, addendum A6): widget search, the `+ New`
 * tool, board sorts, color columns and column calculations. The wording is
 * shared with the desktop BDD (`dashboard_widget_content.feature`).
 *
 * Steps reused as they are: the fixture Background, `I reload the dashboard`,
 * `I click the dashboard Edit button`, `the "…" widget shows the rows "…"`,
 * `the "…" widget shows {int} card(s)`, `the "…" column of the "…" widget shows
 * {int} card(s)`, `the "…" view has {int} saved filters` / `sorts`, `I sort the
 * "…" widget by "…" "…"`, `I close the row page` and the member steps.
 */
import { expect } from '@playwright/test';
import { createBdd, type DataTable } from 'playwright-bdd';

import { resolveBackgroundColor, WIDGET_TIMEOUT } from '../../support/dashboard-shared-helpers';
import {
  expectGridWidgetRows,
  memberPage,
  splitList,
  STATUS_OPTIONS,
  widgetLocator,
} from '../../support/dashboard-test-helpers';
import {
  boardColumnAggregate,
  boardColumnBackground,
  boardColumnNames,
  contentWidget,
  contentWidgetLabel,
  dragBoardCard,
  expectBoardColumnCards,
  expectNewRowPageOpen,
  expectRowSelectValue,
  expectSavedColorColumns,
  expectSavedColumnCalculation,
  expectWidgetGridRowCount,
  expectWidgetSaysNoResults,
  expectWidgetSearchClosed,
  expectWidgetToolNames,
  optionTintVariable,
  searchWidget,
  seedFixtureRows,
  setBoardColorColumns,
  setColumnCalculation,
  toggleColorColumnsInSettings,
  WidgetContentSelectors,
} from '../../support/dashboard-widget-content-helpers';
import { boardColumn } from '../../support/dashboard-usecase-helpers';

const { Given, When, Then } = createBdd();

// ---------------------------------------------------------------------------
// Header tools
// ---------------------------------------------------------------------------

Then('the {string} widget header offers {string}', async ({ page }, label: string, tools: string) => {
  await expectWidgetToolNames(widgetLocator(page, label), tools);
});

Then('the member sees the {string} widget header offer {string}', async ({ page }, label: string, tools: string) => {
  await expectWidgetToolNames(contentWidget(memberPage(page), page, label), tools);
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

When('I search the {string} widget for {string}', async ({ page }, label: string, text: string) => {
  await searchWidget(widgetLocator(page, label), text);
});

When('the member searches the {string} widget for {string}', async ({ page }, label: string, text: string) => {
  await searchWidget(contentWidget(memberPage(page), page, label), text);
});

Then('the member sees the {string} widget show the rows {string}', async ({ page }, label: string, titles: string) => {
  await expectGridWidgetRows(contentWidget(memberPage(page), page, label), splitList(titles));
});

Then('the {string} widget says {string}', async ({ page }, label: string, text: string) => {
  await expectWidgetSaysNoResults(widgetLocator(page, label), text);
});

When('I click {string} in the {string} widget', async ({ page }, button: string, label: string) => {
  const widget = widgetLocator(page, label);

  await widget.getByRole('button', { name: button, exact: true }).click();
});

Then('the {string} widget search box is closed', async ({ page }, label: string) => {
  await expectWidgetSearchClosed(widgetLocator(page, label));
});

// ---------------------------------------------------------------------------
// + New
// ---------------------------------------------------------------------------

When('I click {string} in the {string} widget header', async ({ page }, button: string, label: string) => {
  const widget = widgetLocator(page, label);
  const target =
    button === 'New'
      ? WidgetContentSelectors.newButton(widget)
      : widget.getByTestId('database-actions').getByRole('button', { name: button, exact: true });

  await widget.hover();
  await target.click();
});

Then('a new row page is open', async ({ page }) => {
  await expectNewRowPageOpen(page);
});

Then('the {string} widget shows {int} rows', async ({ page }, label: string, count: number) => {
  await expectWidgetGridRowCount(widgetLocator(page, label), count);
});

When('I open the templates menu of the {string} widget', async ({ page }, label: string) => {
  const widget = widgetLocator(page, label);

  await widget.hover();
  await WidgetContentSelectors.templatesTrigger(widget).click();
});

Then('the templates menu is open', async ({ page }) => {
  await expect(WidgetContentSelectors.templatesMenu(page)).toBeVisible(WIDGET_TIMEOUT);
});

Then('the new-row button of the {string} widget reads {string}', async ({ page }, name: string, label: string) => {
  const button = WidgetContentSelectors.gridNewRow(widgetLocator(page, contentWidgetLabel(page, name)));

  await expect(button).toBeVisible(WIDGET_TIMEOUT);
  await expect(button).toHaveText(label);
});

// ---------------------------------------------------------------------------
// Board sorts
// ---------------------------------------------------------------------------

Given('{string} also has the rows:', async ({ page, request }, database: string, table: DataTable) => {
  await seedFixtureRows(page, request, database, table.hashes());
});

Then(
  'the {string} column of the {string} widget lists {string}',
  async ({ page }, column: string, label: string, titles: string) => {
    await expectBoardColumnCards(widgetLocator(page, label), column, titles);
  }
);

Then(
  'the {string} widget lists the columns {string} in that order',
  async ({ page }, label: string, columns: string) => {
    await expect.poll(() => boardColumnNames(widgetLocator(page, label)), WIDGET_TIMEOUT).toEqual(splitList(columns));
  }
);

When(
  'I drag the {string} card above {string} in the {string} widget',
  async ({ page }, title: string, above: string, label: string) => {
    await dragBoardCard(page, label, title, { aboveTitle: above });
  }
);

When(
  'I drag the {string} card to the {string} column of the {string} widget',
  async ({ page }, title: string, column: string, label: string) => {
    await dragBoardCard(page, label, title, { column });
  }
);

Then(
  'the {string} row of {string} has {string} as its {string}',
  async ({ page, request }, title: string, database: string, value: string, property: string) => {
    await expectRowSelectValue(page, request, database, title, property, value);
  }
);

// ---------------------------------------------------------------------------
// Column calculations
// ---------------------------------------------------------------------------

Then(
  'the {string} column header of the {string} widget shows {string}',
  async ({ page }, column: string, label: string, value: string) => {
    await expect(boardColumnAggregate(widgetLocator(page, label), column)).toHaveText(value, WIDGET_TIMEOUT);
  }
);

Then(
  'the {string} column header of the {string} widget shows no calculation',
  async ({ page }, column: string, label: string) => {
    const widget = widgetLocator(page, label);

    // A column left empty by the search may also be hidden (Hide empty groups): either way no value shows.
    await expect
      .poll(async () => {
        if ((await boardColumn(widget, column).count()) === 0) return '';
        const aggregate = boardColumnAggregate(widget, column);

        return `${await aggregate.getAttribute('data-kind')}:${(await aggregate.textContent())?.trim() ?? ''}`;
      }, WIDGET_TIMEOUT)
      .toMatch(/^(calculation:)?$/);
  }
);

When(
  'I set the column calculation of the {string} widget to {string} of {string}',
  async ({ page }, label: string, type: string, property: string) => {
    await setColumnCalculation(page, label, { kind: 'property', type, property });
  }
);

When(
  'I set the column calculation of the {string} widget to {string}',
  async ({ page }, label: string, type: string) => {
    if (type !== 'Count all') throw new Error(`"${type}" needs a property; only "Count all" stands alone`);
    await setColumnCalculation(page, label, { kind: 'count-all' });
  }
);

Then(
  'the {string} view saves the column calculation {string} of {string}',
  async ({ page }, label: string, type: string, property: string) => {
    await expectSavedColumnCalculation(page, label, type, property);
  }
);

// ---------------------------------------------------------------------------
// Color columns
// ---------------------------------------------------------------------------

Given('the {string} view has color columns turned on', async ({ page }, label: string) => {
  await setBoardColorColumns(page, label, true);
});

Then(
  'the {string} column of the {string} widget is tinted with the {string} option color',
  async ({ page }, column: string, label: string, option: string) => {
    const spec = STATUS_OPTIONS.find((candidate) => candidate.name === option);

    if (!spec) throw new Error(`Unknown option "${option}"`);
    const expected = await resolveBackgroundColor(page, optionTintVariable(spec));

    await expect.poll(() => boardColumnBackground(widgetLocator(page, label), column), WIDGET_TIMEOUT).toBe(expected);
  }
);

Then('the {string} column of the {string} widget is not tinted', async ({ page }, column: string, label: string) => {
  const widget = widgetLocator(page, label);

  await expect(boardColumn(widget, column)).not.toHaveAttribute('data-tint', /.+/, WIDGET_TIMEOUT);
  await expect.poll(() => boardColumnBackground(widget, column), WIDGET_TIMEOUT).toBe('rgba(0, 0, 0, 0)');
});

When('I turn off {string} in the settings of the {string} widget', async ({ page }, setting: string, label: string) => {
  if (setting !== 'Color columns') throw new Error(`Unknown board setting "${setting}"`);
  await toggleColorColumnsInSettings(page, label, false);
});

Then('the {string} view saves color columns as turned off', async ({ page }, label: string) => {
  await expectSavedColorColumns(page, label, false);
});
