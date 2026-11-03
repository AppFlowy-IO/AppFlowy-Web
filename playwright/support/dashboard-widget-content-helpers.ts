/**
 * Dashboard widget content (WP09, addendum A6): widget search, the `+ New`
 * tool, board sorts, color columns and column calculations. The wording of
 * the steps that use these helpers is shared with the desktop BDD
 * (`dashboard_widget_content.feature`).
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { WIDGET_TIMEOUT } from './dashboard-shared-helpers';
import {
  DASHBOARD_FIXTURE_DATABASES,
  DashboardSelectors,
  dashboardWorld,
  databaseForLabel,
  fixtureDatabase,
  gridDataRows,
  knownWidget,
  openDashboard,
  splitList,
  viewIdForLabel,
  widgetLocator,
} from './dashboard-test-helpers';
import {
  addUseCaseRows,
  boardColumn,
  boardColumnTitles,
  rememberFieldTypes,
  rowPage,
} from './dashboard-usecase-helpers';
import { readRowCells, selectCellNames } from './dashboard-private-helpers';

/** How a widget's tool slots read in a step (`dashboard-parity/widget-tools.json` names). */
export const WIDGET_TOOL_NAMES: Record<string, string> = {
  filter: 'Filter',
  sort: 'Sort',
  search: 'Search',
  new: 'New',
  settings: 'Settings',
};

/** CalculationType ints by their menu label (`grid.calculationTypeLabel.*`, English). */
export const CALCULATION_TYPE_BY_LABEL: Record<string, number> = {
  Average: 0,
  Max: 1,
  Median: 2,
  Min: 3,
  Sum: 4,
  'Count empty': 6,
  'Count not empty': 7,
  'Earliest date': 8,
  'Latest date': 9,
  'Date range': 10,
  Range: 11,
  Checked: 13,
  Unchecked: 14,
  'Percent empty': 15,
  'Percent not empty': 16,
  'Count unique values': 17,
  'Percent checked': 19,
  'Percent unchecked': 20,
};

/** Option colour N (1-based, `STATUS_OPTIONS` names) → its board tint block colour (`tokens.json`). */
const OPTION_COLOR_ORDER = ['Purple', 'Pink', 'LightPink', 'Orange', 'Yellow', 'Lime', 'Green', 'Aqua', 'Blue', 'Cream'];
const BOARD_COLUMN_TINT_BLOCK_INDEX = [14, 16, 18, 2, 4, 6, 8, 10, 12, 20];

/**
 * A widget by the name a step gives it: a full label ("Projects Grid"), or a
 * view name ("Grid") of the dashboard host, as the composite Given labels them.
 */
export function contentWidgetLabel(page: Page, name: string) {
  if (/\s/.test(name.trim())) return name;
  return `${dashboardWorld(page).dashboardHost ?? 'Projects'} ${name}`;
}

/** A widget on `scope` (the owner's page, or the member's) by its label. */
export function contentWidget(scope: Page, ownerPage: Page, label: string): Locator {
  if (scope === ownerPage) return widgetLocator(ownerPage, label);
  return DashboardSelectors.widget(scope, knownWidget(ownerPage, label).id);
}

/** The names of the tools a widget's header offers, in visual order (hidden ones included). */
export async function widgetToolIds(widget: Locator): Promise<string[]> {
  await widget.hover();
  await expect(widget.locator('[data-widget-tool]').first()).toBeAttached(WIDGET_TIMEOUT);
  return widget
    .locator('[data-widget-tool]')
    .evaluateAll((slots) => slots.map((slot) => slot.getAttribute('data-widget-tool') ?? ''));
}

export async function expectWidgetToolNames(widget: Locator, expected: string) {
  await expect
    .poll(async () => (await widgetToolIds(widget)).map((tool) => WIDGET_TOOL_NAMES[tool] ?? tool), WIDGET_TIMEOUT)
    .toEqual(splitList(expected));
}

export const WidgetContentSelectors = {
  searchButton: (widget: Locator) =>
    widget.locator('[data-widget-tool="search"]').getByTestId('database-actions-search'),
  searchField: (widget: Locator) => widget.getByTestId('database-actions-search-field'),
  searchInput: (widget: Locator) => widget.getByTestId('database-actions-search-input'),
  searchEmptyState: (widget: Locator) => widget.getByTestId('database-search-empty-state'),
  clearSearch: (widget: Locator) => widget.getByTestId('database-search-clear-search'),
  newButton: (widget: Locator) => widget.locator('[data-widget-tool="new"]').getByTestId('database-new-row-button'),
  templatesTrigger: (widget: Locator) =>
    widget.locator('[data-widget-tool="new"]').getByTestId('database-template-menu-trigger'),
  templatesMenu: (scope: Page) => scope.getByTestId('database-template-menu'),
  gridNewRow: (widget: Locator) => widget.getByTestId('dashboard-widget-body').getByTestId('grid-new-row'),
};

/**
 * Search a widget: open its field if collapsed, replace the text, and wait
 * until the typed text is the committed query (the 300 ms debounce elapsed).
 */
export async function searchWidget(widget: Locator, text: string) {
  const field = WidgetContentSelectors.searchField(widget);

  await expect(widget).toBeVisible(WIDGET_TIMEOUT);
  if ((await field.count()) === 0) {
    await widget.hover();
    await WidgetContentSelectors.searchButton(widget).click();
  }

  await expect(field).toHaveAttribute('data-search-active', 'true');
  await WidgetContentSelectors.searchInput(widget).fill(text);
  await expect(field).toHaveAttribute('data-committed', 'true', WIDGET_TIMEOUT);
}

export async function expectWidgetSaysNoResults(widget: Locator, text: string) {
  const state = WidgetContentSelectors.searchEmptyState(widget);

  await expect(state).toBeVisible(WIDGET_TIMEOUT);
  await expect(state).toHaveAttribute('role', 'status');
  await expect(state).toContainText(text);
}

export async function expectWidgetSearchClosed(widget: Locator) {
  await expect(WidgetContentSelectors.searchField(widget)).toHaveCount(0);
  await expect(widget.getByTestId('database-actions-search')).toBeAttached();
}

export async function expectWidgetGridRowCount(widget: Locator, count: number) {
  await expect(gridDataRows(widget)).toHaveCount(count, WIDGET_TIMEOUT);
}

export async function expectNewRowPageOpen(page: Page) {
  await expect(rowPage(page)).toBeVisible(WIDGET_TIMEOUT);
}

/**
 * `"Projects" also has the rows:` rows written through the Cloud API (as a
 * collaborator would), then the dashboard is opened again with them.
 */
export async function seedFixtureRows(
  page: Page,
  request: APIRequestContext,
  database: string,
  rows: Record<string, string>[]
) {
  const spec = DASHBOARD_FIXTURE_DATABASES[database];

  if (!spec) throw new Error(`"${database}" is not a fixture database`);
  // The row writer types each value by its property: the fixture's properties.
  rememberFieldTypes(page, database, spec.fields);
  await addUseCaseRows(page, request, database, rows);
  await openDashboard(page);
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/** The option column names a board widget shows, in order (the "No <field>" column left out). */
export async function boardColumnNames(widget: Locator): Promise<string[]> {
  return widget
    .getByTestId('board-column')
    .getByTestId('board-column-name')
    .evaluateAll((names) => names.map((name) => name.textContent?.trim() ?? ''))
    .then((names) => names.filter((name) => name !== '' && !/^No\s/.test(name)));
}

export async function expectBoardColumnCards(widget: Locator, column: string, titles: string) {
  await expect.poll(() => boardColumnTitles(widget, column), WIDGET_TIMEOUT).toEqual(splitList(titles));
}

/** The number beside a board column's name: its card count or the column calculation. */
export function boardColumnAggregate(widget: Locator, column: string): Locator {
  return boardColumn(widget, column).getByTestId('board-column-aggregate');
}

/**
 * Drag a card of a board widget onto the upper part of another card, or onto
 * a column, with the pointer as a user would (pragmatic drag and drop).
 */
export async function dragBoardCard(
  page: Page,
  label: string,
  title: string,
  target: { aboveTitle: string } | { column: string }
) {
  const widget = widgetLocator(page, label);
  const database = fixtureDatabase(page, databaseForLabel(page, label));
  const rowId = database.rowIds[title];
  const card = widget.locator(`[data-card-id*="${rowId}"]`).first();
  const destination =
    'column' in target
      ? boardColumn(widget, target.column)
      : widget.locator(`[data-card-id*="${database.rowIds[target.aboveTitle]}"]`).first();

  await expect(card).toBeVisible(WIDGET_TIMEOUT);
  await expect(destination).toBeVisible(WIDGET_TIMEOUT);
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const to = await destination.boundingBox();

  if (!from || !to) throw new Error('The card or its destination is not visible');
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end =
    'column' in target
      ? { x: to.x + to.width / 2, y: to.y + Math.min(to.height / 2, 80) }
      : { x: to.x + to.width / 2, y: to.y + Math.min(6, to.height / 4) };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(start.x + ((end.x - start.x) * step) / 20, start.y + ((end.y - start.y) * step) / 20);
  }

  await page.mouse.up();
}

export async function expectRowSelectValue(
  page: Page,
  request: APIRequestContext,
  database: string,
  title: string,
  property: string,
  value: string
) {
  const fieldId = fixtureDatabase(page, database).fieldIds[property];

  await expect
    .poll(async () => {
      const cells = await readRowCells(page, request, database, title);

      return selectCellNames(cells[property] ?? cells[fieldId]);
    }, WIDGET_TIMEOUT)
    .toEqual([value]);
}

/** Open the `···` menu of a board widget's first column and its Calculate pane. */
export async function openColumnCalculateMenu(page: Page, widget: Locator) {
  const trigger = widget.getByTestId('board-column').first().getByTestId('board-column-menu-trigger');

  await widget.hover();
  await trigger.click();
  await page.getByTestId('board-column-calculate').click();
  await expect(page.getByTestId('board-column-calculate-menu')).toBeVisible();
}

/** Board-wide column calculation through the column menu: "Count all", or a calculation of a property. */
export async function setColumnCalculation(
  page: Page,
  label: string,
  calculation: { kind: 'count-all' } | { kind: 'property'; type: string; property: string }
) {
  const widget = widgetLocator(page, label);

  await openColumnCalculateMenu(page, widget);
  if (calculation.kind === 'count-all') {
    await page.getByTestId('board-column-calculate-count-all').click();
  } else {
    const database = fixtureDatabase(page, databaseForLabel(page, label));
    const type = CALCULATION_TYPE_BY_LABEL[calculation.type];

    if (type === undefined) throw new Error(`Unknown calculation "${calculation.type}"`);
    await page.getByTestId(`board-column-calculate-field-${database.fieldIds[calculation.property]}`).click();
    await page.getByTestId(`board-column-calculate-type-${type}`).click();
  }

  await expect(page.getByTestId('board-column-menu')).toHaveCount(0);
}

/** A board view's layout map (`layout_settings["1"]`) as the browser's database doc holds it. */
export async function readBoardLayoutSetting(page: Page, viewId: string): Promise<Record<string, unknown>> {
  const setting = await page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const ctx = bridge?.byView(id);

    if (!ctx) return null;
    const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(id);

    return bridge.plain(view?.get('layout_settings')?.get('1')) ?? {};
  }, viewId);

  if (!setting) throw new Error(`view ${viewId} is not open in the browser`);
  return setting as Record<string, unknown>;
}

export async function expectSavedColumnCalculation(page: Page, label: string, type: string, property: string) {
  const database = fixtureDatabase(page, databaseForLabel(page, label));
  const viewId = viewIdForLabel(page, label);

  await expect
    .poll(async () => {
      const calculation = (await readBoardLayoutSetting(page, viewId)).group_calculation as
        | { type?: number; field_id?: string }
        | undefined;

      return calculation ? { type: Number(calculation.type), field_id: calculation.field_id } : null;
    }, WIDGET_TIMEOUT)
    .toEqual({ type: CALCULATION_TYPE_BY_LABEL[type], field_id: database.fieldIds[property] });
}

/** "Color columns" written into the board view's collab map, as desktop does (WP09 §1.5). */
export async function setBoardColorColumns(page: Page, label: string, on: boolean) {
  const viewId = viewIdForLabel(page, label);

  await page.evaluate(
    ({ id, value }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const ctx = bridge.byView(id);
      const doc = ctx.databaseDoc;
      const Y = (window as any).Y;
      const view = doc.getMap('data').get('database').get('views').get(id);

      doc.transact(() => {
        let layoutSettings = view.get('layout_settings');

        if (!layoutSettings) {
          layoutSettings = new Y.Map();
          view.set('layout_settings', layoutSettings);
        }

        let board = layoutSettings.get('1');

        if (!board) {
          board = new Y.Map();
          layoutSettings.set('1', board);
        }

        board.set('show_color_columns', value);
      });
    },
    { id: viewId, value: on }
  );
  await expect.poll(async () => (await readBoardLayoutSetting(page, viewId)).show_color_columns).toBe(on);
}

export async function expectSavedColorColumns(page: Page, label: string, on: boolean) {
  const viewId = viewIdForLabel(page, label);

  await expect
    .poll(async () => (await readBoardLayoutSetting(page, viewId)).show_color_columns, WIDGET_TIMEOUT)
    .toBe(on);
}

/** The block colour a column of `option` is tinted with (`tokens.json` `boardColumnTintBlockIndex`). */
export function optionTintVariable(option: { color: string }): string {
  const position = OPTION_COLOR_ORDER.indexOf(option.color);

  if (position < 0) throw new Error(`No board tint for option colour ${option.color}`);
  return `--block-bg-color-${BOARD_COLUMN_TINT_BLOCK_INDEX[position]}`;
}

/** The computed background of a board column (`board-column`). */
export async function boardColumnBackground(widget: Locator, column: string): Promise<string> {
  return boardColumn(widget, column).evaluate((element) => getComputedStyle(element).backgroundColor);
}

/** Turn a board widget's "Color columns" switch off (or on) in its Edit-mode settings host. */
export async function toggleColorColumnsInSettings(page: Page, label: string, on: boolean) {
  const widget = widgetLocator(page, label);
  const toggle = page.getByTestId('board-color-columns-toggle');

  await widget.hover();
  await widget.getByTestId('dashboard-widget-settings-button').click();
  await expect(toggle).toBeVisible(WIDGET_TIMEOUT);
  if ((await toggle.getAttribute('data-checked')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('data-checked', String(on));
  await page.keyboard.press('Escape');
}
