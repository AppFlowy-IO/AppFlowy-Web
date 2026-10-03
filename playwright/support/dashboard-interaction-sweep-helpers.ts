/**
 * The dashboard interaction sweep (`dashboard-interaction-sweep.feature`):
 * a dashboard with a widget of every type, and the routines that open and
 * close every control of a widget, of the dashboard toolbar and of the widget
 * picker while `dashboard-error-collector.ts` records framework errors.
 *
 * Desktop runs the same matrix (`dashboard_interaction_sweep_test_op.dart`).
 * Every routine fails at once, naming the widget, the mode and the control,
 * and none of them changes persisted state: a control that would write is
 * opened and cancelled.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

import { DatabaseViewLayout } from '../../src/application/types';
import { WIDGET_TOOL_CAPS } from '../../src/components/database/dashboard/widget-tools';

import { chartTable, chartTooltip, hoverChartCategory } from './chart-render-helpers';
import { frameworkErrorCollector } from './dashboard-error-collector';
import { expectDashboardViewMode } from './dashboard-platform-helpers';
import { canonicalJson, WIDGET_TIMEOUT, WIDGET_TIMEOUT_MS } from './dashboard-shared-helpers';
import {
  DashboardSelectors,
  dashboardWorld,
  FieldSpec,
  FieldType,
  fixtureDatabase,
  gridDataRows,
  openWidgetMenu,
  readDashboardSetting,
  rowLines,
  setDashboardTrackWidth,
  widgetLocator,
} from './dashboard-test-helpers';
import {
  addUseCaseDatabase,
  addUseCaseRows,
  addUseCaseViews,
  namedView,
  prepareUseCaseWorkspace,
  rememberFieldTypes,
  rememberSelectOptions,
  scenarioState,
  seedUseCaseDashboard,
} from './dashboard-usecase-helpers';

// ---------------------------------------------------------------------------
// The widgets
// ---------------------------------------------------------------------------

type FixtureLayout = 'grid' | 'board' | 'calendar' | 'chart' | 'list';
type RowControls = 'grid' | 'list' | 'board';

interface SweepWidget {
  /** The view name, which is also the widget's name in the feature ("Bar chart"). */
  name: string;
  /** The `widget-tools.json` layout. */
  layout: FixtureLayout;
  /** The view's settings in the use-case mini-language (`dashboard-usecase-helpers.ts`). */
  settings: string;
  rowControls?: RowControls;
  /** A chart whose categories show a tooltip on hover (a Number chart has none). */
  categories?: boolean;
}

/**
 * Wide enough for a row of four widgets not to wrap (4 x 240 px plus the
 * gaps; `dashboard-grid.feature`), so every row keeps its width handles.
 */
const SWEEP_TRACK_WIDTH = 1104;

/** Two rows of four at the default row height, in this order. */
const SWEEP_WIDGETS: SweepWidget[] = [
  { name: 'Grid', layout: 'grid', settings: '', rowControls: 'grid' },
  { name: 'Board', layout: 'board', settings: 'grouped by Status', rowControls: 'board' },
  { name: 'List', layout: 'list', settings: '', rowControls: 'list' },
  { name: 'Calendar', layout: 'calendar', settings: 'by Due' },
  { name: 'Bar chart', layout: 'chart', settings: 'count by Status', categories: true },
  { name: 'Line chart', layout: 'chart', settings: 'count by Status', categories: true },
  { name: 'Donut chart', layout: 'chart', settings: 'count by Status', categories: true },
  { name: 'Number chart', layout: 'chart', settings: 'count' },
];

/** The database behind the sweep: the Projects fixture, with named select options. */
const SWEEP_DATABASES: Record<string, { fields: FieldSpec[]; rows: Record<string, string>[] }> = {
  Projects: {
    fields: [
      { name: 'Status', type: FieldType.SingleSelect, options: ['Todo', 'Doing', 'Done'] },
      { name: 'Estimate', type: FieldType.Number },
      { name: 'Due', type: FieldType.DateTime },
      { name: 'Urgent', type: FieldType.Checkbox },
    ],
    rows: [
      { Name: 'Website launch', Status: 'Doing', Estimate: '3', Due: 'today', Urgent: 'yes' },
      { Name: 'Mobile app', Status: 'Todo', Estimate: '5', Due: 'today + 10', Urgent: 'no' },
      { Name: 'API cleanup', Status: 'Done', Estimate: '8', Due: 'today - 3', Urgent: 'yes' },
    ],
  },
};

function sweepWidget(name: string): SweepWidget {
  const widget = SWEEP_WIDGETS.find((candidate) => candidate.name === name);

  if (!widget) throw new Error(`The sweep has no "${name}" widget`);
  return widget;
}

/**
 * The widget labels the shared widget-chrome steps resolve: a one-word view
 * name ("Grid") is the host's "<host> Grid" view; a longer one is its own label.
 */
function chromeLabel(host: string, name: string) {
  return /\s/.test(name) ? name : `${host} ${name}`;
}

/** The sweep widget called `name` on the open dashboard. */
export function sweepWidgetLocator(page: Page, name: string): Locator {
  return widgetLocator(page, chromeLabel(dashboardWorld(page).dashboardHost ?? 'Projects', sweepWidget(name).name));
}

/**
 * A new dashboard of `database` showing its Grid, Board, List and Calendar
 * views and four chart views (bar, line, donut, number) in two rows of four,
 * open in View mode with every widget rendered.
 */
export async function openDashboardWithEveryWidgetType(page: Page, request: APIRequestContext, database: string) {
  const spec = SWEEP_DATABASES[database];

  if (!spec) throw new Error(`The sweep has no fixture for the "${database}" database`);
  await prepareUseCaseWorkspace(page, request, `${database} sweep`);
  await addUseCaseDatabase(page, request, database, spec.fields);
  rememberFieldTypes(page, database, spec.fields);
  rememberSelectOptions(page, database, spec.fields);
  await addUseCaseRows(page, request, database, spec.rows);

  // The Grid widget shows the database's own grid; the other views are new.
  const fixture = fixtureDatabase(page, database);
  const world = dashboardWorld(page);

  scenarioState(page).views.Grid = { name: 'Grid', viewId: fixture.views.Grid, database, layout: 'Grid' };
  world.viewsByName = { ...world.viewsByName, Grid: { viewId: fixture.views.Grid, database } };
  await addUseCaseViews(
    page,
    request,
    database,
    SWEEP_WIDGETS.filter((widget) => widget.name !== 'Grid').map((widget) => ({
      view: widget.name,
      layout: widget.name,
      settings: widget.settings,
    }))
  );

  const names = SWEEP_WIDGETS.map((widget) => widget.name);

  await seedUseCaseDashboard(page, request, 'Dashboard', database, [names.slice(0, 4), names.slice(4)]);

  // The shared widget-chrome steps address a one-word view name as "<host> <name>".
  for (const widget of SWEEP_WIDGETS) {
    const view = namedView(page, widget.name);
    const known = world.widgets[widget.name];

    if (!/\s/.test(widget.name)) fixture.views[widget.name] = view.viewId;
    world.widgets[chromeLabel(database, widget.name)] = known;
  }

  await setDashboardTrackWidth(page, SWEEP_TRACK_WIDTH);
  for (const row of (await readDashboardSetting(page)).rows) {
    await expect.poll(() => rowLines(page, row.id), WIDGET_TIMEOUT).toEqual([row.widgets.length]);
  }

  for (const widget of SWEEP_WIDGETS) await expectWidgetRendered(page, widget);
  await expectDashboardViewMode(page);
}

/** The widget shows its content: rows, cards, a calendar, or a chart with data. */
async function expectWidgetRendered(page: Page, widget: SweepWidget) {
  const locator = sweepWidgetLocator(page, widget.name);
  const rows = SWEEP_DATABASES.Projects.rows.length;

  await expect(locator, `the "${widget.name}" widget is not on the dashboard`).toBeVisible(WIDGET_TIMEOUT);
  await expect(locator.getByTestId('dashboard-widget-placeholder')).toHaveCount(0, WIDGET_TIMEOUT);
  if (widget.layout === 'grid') await expect(gridDataRows(locator)).toHaveCount(rows, WIDGET_TIMEOUT);
  else if (widget.layout === 'board') await expect(locator.locator('.board-card')).toHaveCount(rows, WIDGET_TIMEOUT);
  else if (widget.layout === 'list') {
    await expect(locator.locator('[data-testid^="list-primary-cell-"]')).toHaveCount(rows, WIDGET_TIMEOUT);
  } else if (widget.layout === 'calendar') {
    await expect(locator.getByTestId('calendar-title')).toBeVisible(WIDGET_TIMEOUT);
  } else if (widget.categories) {
    await expect.poll(async () => (await chartTable(locator)).length, WIDGET_TIMEOUT).toBeGreaterThan(0);
  } else {
    await expect(locator.getByTestId('number-chart-value')).toHaveText(String(rows), WIDGET_TIMEOUT);
  }
}

// ---------------------------------------------------------------------------
// The tools a widget offers (`widget-tools.json`)
// ---------------------------------------------------------------------------

interface WidgetToolsFixture {
  caps: Record<string, { content_tools: boolean; sort_layouts: string[] }>;
  cases: { caps: string; role: string; layout: string; editing: boolean; expected: string[] }[];
}

const WIDGET_TOOLS_FIXTURE = fileURLToPath(
  new URL('../../src/application/database-yjs/__fixtures__/dashboard-parity/widget-tools.json', import.meta.url)
);

const FIXTURE_LAYOUT_NAMES: Partial<Record<DatabaseViewLayout, string>> = {
  [DatabaseViewLayout.Grid]: 'grid',
  [DatabaseViewLayout.Board]: 'board',
  [DatabaseViewLayout.Calendar]: 'calendar',
  [DatabaseViewLayout.Chart]: 'chart',
  [DatabaseViewLayout.List]: 'list',
  [DatabaseViewLayout.Gallery]: 'gallery',
  [DatabaseViewLayout.Feed]: 'feed',
  [DatabaseViewLayout.Timeline]: 'timeline',
};

/** The fixture's capability set the app ships with today (WP03, until WP09 flips the content tools on). */
function shippedCaps(fixture: WidgetToolsFixture): string {
  const sortLayouts = [...WIDGET_TOOL_CAPS.sortLayouts]
    .map((layout) => FIXTURE_LAYOUT_NAMES[layout])
    .sort()
    .join(',');
  const match = Object.entries(fixture.caps).find(
    ([, caps]) =>
      caps.content_tools === WIDGET_TOOL_CAPS.contentTools && [...caps.sort_layouts].sort().join(',') === sortLayouts
  );

  if (!match) throw new Error('widget-tools.json has no capability set equal to the app’s WIDGET_TOOL_CAPS');
  return match[0];
}

/** The tools `widget-tools.json` lists for an editor of a widget of `layout` in `mode`. */
function expectedWidgetTools(layout: FixtureLayout, mode: DashboardMode): string[] {
  const fixture = JSON.parse(readFileSync(WIDGET_TOOLS_FIXTURE, 'utf8')) as WidgetToolsFixture;
  const caps = shippedCaps(fixture);
  const entry = fixture.cases.find(
    (candidate) =>
      candidate.caps === caps &&
      candidate.role === 'writer' &&
      candidate.layout === layout &&
      candidate.editing === (mode === 'Edit')
  );

  if (!entry) throw new Error(`widget-tools.json lists no ${caps} writer case for a ${layout} widget in ${mode} mode`);
  return entry.expected;
}

const TOOL_LABELS: Record<string, string> = {
  filter: 'Filter',
  sort: 'Sort',
  search: 'Search',
  new: 'New',
  settings: 'Settings',
};

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

type DashboardMode = 'View' | 'Edit';

async function dashboardMode(page: Page): Promise<DashboardMode> {
  return (await DashboardSelectors.doneButton(page).isVisible()) ? 'Edit' : 'View';
}

/**
 * Open popovers, menus and dialogs (tooltips do not count): a control opened
 * something when this grows, and is closed when it is back.
 */
async function openOverlayCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const shown = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    return Array.from(
      document.querySelectorAll('[data-radix-popper-content-wrapper], [role="dialog"], .MuiPopover-paper')
    ).filter((element) => shown(element) && !element.querySelector('[role="tooltip"]')).length;
  });
}

/** Run `open`, check it opened an overlay, then close it with Escape and check every overlay it opened is gone. */
async function openAndCloseOverlay(page: Page, context: string, open: () => Promise<void>, check?: () => Promise<void>) {
  const before = await openOverlayCount(page);

  await open();
  await expect
    .poll(() => openOverlayCount(page), { ...WIDGET_TIMEOUT, message: `${context}: nothing opened` })
    .toBeGreaterThan(before);
  await check?.();
  await frameworkErrorCollector(page).expectNone(context);
  await closeOverlays(page, context, before);
}

async function closeOverlays(page: Page, context: string, baseline = 0) {
  for (let attempt = 0; attempt < 4 && (await openOverlayCount(page)) > baseline; attempt += 1) {
    await page.keyboard.press('Escape');
  }

  await expect
    .poll(() => openOverlayCount(page), { ...WIDGET_TIMEOUT, message: `${context}: did not close` })
    .toBeLessThanOrEqual(baseline);
}

/** What a sub-menu offers: its items, or the controls of an editor inside it (the Filter row's "Add filter"). */
const MENU_ITEMS =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="radio"], button, input';

/** Hover every item of `menu` that opens a sub-menu and check the sub-menu lists at least one item; choose nothing. */
async function openEverySubMenu(page: Page, menu: Locator, context: string) {
  const triggers = menu.locator('[aria-haspopup="menu"]');
  const count = await triggers.count();

  for (let index = 0; index < count; index += 1) {
    const trigger = triggers.nth(index);

    await trigger.hover();
    await expect(trigger, `${context}: a sub-menu did not open`).toHaveAttribute('aria-expanded', 'true');
    const submenu = page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);

    await expect.poll(() => submenu.locator(MENU_ITEMS).count(), WIDGET_TIMEOUT).toBeGreaterThan(0);
    await frameworkErrorCollector(page).expectNone(context);
  }
}

// ---------------------------------------------------------------------------
// One widget
// ---------------------------------------------------------------------------

/** The synced parts of a view, as the browser's database doc holds them. */
async function readViewSnapshot(page: Page, viewId: string) {
  return page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const view = bridge?.byView(id)?.databaseDoc.getMap('data').get('database').get('views').get(id);

    if (!view) return null;
    return Object.fromEntries(
      ['layout', 'filters', 'sorts', 'groups', 'layout_settings', 'field_settings'].map((key) => [
        key,
        bridge.plain(view.get(key)) ?? null,
      ])
    );
  }, viewId);
}

/** What the sweep must leave as it found: the dashboard layout and the widget's view. */
async function persistedState(page: Page, viewId: string) {
  return canonicalJson({ dashboard: await readDashboardSetting(page), view: await readViewSnapshot(page, viewId) });
}

/**
 * Open and close every control of the sweep widget `name` in the current
 * mode (section 6.1 of the fix plan): the title menu, every tool of
 * `widget-tools.json` (Settings opens each row of its panel, Source last),
 * the first row's menu, a chart's tooltip and, in Edit mode, the resize
 * handles of its row.
 */
export async function openAndCloseEveryWidgetControl(page: Page, name: string) {
  const collector = frameworkErrorCollector(page);
  const mode = await dashboardMode(page);
  const spec = sweepWidget(name);
  const widget = sweepWidgetLocator(page, name);
  const viewId = namedView(page, name).viewId;
  const before = await persistedState(page, viewId);
  const control = async (label: string, run: (context: string) => Promise<void>) => {
    const context = `${name} / ${mode} / ${label}`;

    collector.setContext(context);
    await run(context);
    await closeOverlays(page, context);
    await collector.expectNone(context);
  };

  await widget.scrollIntoViewIfNeeded();
  await control('Title menu', (context) =>
    openAndCloseOverlay(
      page,
      context,
      () => openWidgetMenu(page, widget),
      () => openEverySubMenu(page, DashboardSelectors.widgetMenu(page), context)
    )
  );

  const tools = expectedWidgetTools(spec.layout, mode);
  const shownTools = await widget
    .locator('[data-widget-tool]')
    .evaluateAll((slots) => slots.map((slot) => slot.getAttribute('data-widget-tool')));

  expect(shownTools, `${name} / ${mode}: the widget's tools differ from widget-tools.json`).toEqual(tools);
  for (const tool of tools) {
    await control(`${TOOL_LABELS[tool] ?? tool} tool`, async (context) => {
      if (tool === 'settings') {
        await openWidgetSettingsHost(page, widget, context);
        await openEveryViewSettingsRow(page, context);
        return;
      }

      await openAndCloseOverlay(page, context, async () => {
        // In View mode the tools show on hover, as for a user.
        if (mode === 'View') await widget.hover();
        await widget.locator(`[data-widget-tool="${tool}"]`).getByRole('button').first().click();
      });
    });
  }

  if (spec.rowControls) {
    await control('Row menu', (context) =>
      openAndCloseOverlay(page, context, () => openFirstRowMenu(widget, spec.rowControls as RowControls, context))
    );
  }

  if (spec.categories) await control('Chart tooltip', (context) => showFirstCategoryTooltip(page, widget, context));
  if (mode === 'Edit') {
    await control('Width handle', (context) => pressResizeHandle(page, widget, 'width', context));
    await control('Height handle', (context) => pressResizeHandle(page, widget, 'height', context));
  }

  collector.setContext('the dashboard');
  await page.mouse.move(1, 1);
  expect(await persistedState(page, viewId), `${name} / ${mode}: the sweep changed persisted state`).toBe(before);
}

/** Hover the first row or card and open its menu. */
async function openFirstRowMenu(widget: Locator, kind: RowControls, context: string) {
  if (kind === 'grid') {
    await gridDataRows(widget).first().hover();
    const button = widget
      .locator('[data-parity-id="dash-widget-grid-row-controls"]')
      .first()
      .getByTestId('row-accessory-button');

    await expect(button, `${context}: the first row offers no menu`).toBeVisible();
    await button.click();
    return;
  }

  if (kind === 'list') {
    const primary = widget.locator('[data-testid^="list-primary-cell-"]').first();
    const rowId = ((await primary.getAttribute('data-testid')) ?? '').slice('list-primary-cell-'.length);

    await widget.getByTestId(`list-row-${rowId}`).hover();
    const button = widget.getByTestId(`list-row-actions-${rowId}`).getByTestId('row-accessory-button');

    await expect(button, `${context}: the first row offers no menu`).toBeVisible();
    await button.click();
    return;
  }

  const card = widget.locator('.board-card').first();

  await card.hover();
  const more = card.locator('button[aria-haspopup="menu"]').first();

  await expect(more, `${context}: the first card offers no menu`).toBeVisible();
  await more.click();
}

/** Point at the chart's first category: its tooltip shows, and hides again when the pointer leaves. */
async function showFirstCategoryTooltip(page: Page, widget: Locator, context: string) {
  const [first] = await chartTable(widget);

  expect(first, `${context}: the chart has no category`).toBeDefined();
  await widget.scrollIntoViewIfNeeded();
  await hoverChartCategory(page, widget, first.label);
  await expect(chartTooltip(page), `${context}: no tooltip`).toBeVisible(WIDGET_TIMEOUT);
  await frameworkErrorCollector(page).expectNone(context);
  await page.mouse.move(1, 1);
  await expect(chartTooltip(page), `${context}: the tooltip stayed`).toBeHidden(WIDGET_TIMEOUT);
}

/** Hover, press, move 0 px and release a resize handle of the widget's row. */
async function pressResizeHandle(page: Page, widget: Locator, kind: 'width' | 'height', context: string) {
  const widgetId = (await widget.getAttribute('data-widget-id')) ?? '';
  const { rows } = await readDashboardSetting(page);
  const row = rows.find((candidate) => candidate.widgets.some((entry) => entry.id === widgetId));

  expect(row, `${context}: the widget is in no dashboard row`).toBeDefined();
  const rowId = row?.id ?? '';
  const index = row?.widgets.findIndex((entry) => entry.id === widgetId) ?? 0;
  const count = row?.widgets.length ?? 0;
  // A width handle sits after every widget but the last; the last one uses the handle before it.
  const handle =
    kind === 'height'
      ? DashboardSelectors.heightHandle(page, rowId)
      : DashboardSelectors.widthHandle(page, rowId, index < count - 1 ? index : index - 1);

  await DashboardSelectors.row(page, rowId).hover();
  await handle.scrollIntoViewIfNeeded();
  await handle.hover();
  await expect(handle, `${context}: no handle`).toBeVisible();
  const box = await handle.boundingBox();

  if (!box) throw new Error(`${context}: the handle is not rendered`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y);
  await page.mouse.up();
  await frameworkErrorCollector(page).expectNone(context);
}

// ---------------------------------------------------------------------------
// The settings panel ("View settings")
// ---------------------------------------------------------------------------

function settingsHost(page: Page) {
  return page.getByTestId('dashboard-widget-settings');
}

/** Open the widget's settings panel from its Settings tool. */
async function openWidgetSettingsHost(page: Page, widget: Locator, context: string) {
  const tool = widget.getByTestId('dashboard-widget-settings-button');

  await expect(tool, `${context}: no Settings tool`).toBeVisible(WIDGET_TIMEOUT);
  if ((await tool.getAttribute('data-state')) !== 'open') await tool.click();
  await expect(settingsHost(page), `${context}: the View settings panel did not open`).toBeVisible(WIDGET_TIMEOUT);
}

/**
 * Hover and click each row of the open "View settings" panel: its sub-menu
 * must list at least one item, then it is closed. The Source row comes last:
 * the picker opens in replace mode and is cancelled.
 */
export async function openEveryViewSettingsRow(page: Page, context: string) {
  const collector = frameworkErrorCollector(page);
  const host = settingsHost(page);

  await expect(host, `${context}: the View settings panel is not open`).toBeVisible(WIDGET_TIMEOUT);
  const rows = host.locator('[role="menuitem"]');
  const source = host.getByTestId('dashboard-widget-settings-source');
  const count = await rows.count();

  expect(count, `${context}: the View settings panel lists no rows`).toBeGreaterThan(1);
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);

    if ((await row.getAttribute('data-testid')) === 'dashboard-widget-settings-source') continue;
    const label = ((await row.innerText()).split('\n')[0] ?? '').trim() || `row ${index + 1}`;
    const rowContext = `${context} / ${label}`;

    expect(
      await row.getAttribute('aria-haspopup'),
      `${rowContext}: the row opens no sub-menu, so the sweep cannot open it without writing`
    ).toBe('menu');
    collector.setContext(rowContext);
    await row.hover();
    await row.click();
    await expect(row, `${rowContext}: the sub-menu did not open`).toHaveAttribute('aria-expanded', 'true');
    const submenu = page.locator(`[id="${await row.getAttribute('aria-controls')}"]`);

    await expect(submenu, `${rowContext}: the sub-menu is not shown`).toBeVisible(WIDGET_TIMEOUT);
    await expect
      .poll(() => submenu.locator(MENU_ITEMS).count(), { ...WIDGET_TIMEOUT, message: `${rowContext}: empty sub-menu` })
      .toBeGreaterThan(0);
    await collector.expectNone(rowContext);
    await closeSubMenu(page, source, submenu);
    await expect(submenu, `${rowContext}: the sub-menu did not close`).toBeHidden();
    await expect(host, `${rowContext}: closing the sub-menu closed the panel`).toBeVisible();
    await collector.expectNone(rowContext);
  }

  const sourceContext = `${context} / Source`;
  const picker = DashboardSelectors.picker(page);

  collector.setContext(sourceContext);
  await source.hover();
  await source.click();
  await expect(picker, `${sourceContext}: the picker did not open`).toBeVisible(WIDGET_TIMEOUT);
  await expect(picker).toHaveAttribute('data-mode', 'replace');
  await expect(picker.getByTestId('dashboard-widget-picker-option').first()).toBeVisible(WIDGET_TIMEOUT);
  await collector.expectNone(sourceContext);
  await page.keyboard.press('Escape');
  await expect(picker, `${sourceContext}: the picker did not close`).toBeHidden();
  await collector.expectNone(sourceContext);
}

/** Close an open sub-menu of the panel: the pointer moves on to another row, which takes the focus. */
async function closeSubMenu(page: Page, otherRow: Locator, submenu: Locator) {
  await otherRow.hover();
  try {
    await expect(submenu).toBeHidden({ timeout: 2_000 });
  } catch {
    // The pointer stayed in the sub-menu's grace area: close it from the keyboard, as a user would.
    await submenu.locator(MENU_ITEMS).first().focus();
    await page.keyboard.press('ArrowLeft');
  }
}

/** Open the "View settings" panel of the widget whose panel was just closed by its Source row, again. */
export async function reopenSettingsHostOf(page: Page, widget: Locator) {
  await openWidgetSettingsHost(page, widget, 'View settings');
}

/** The widget whose settings panel is open. */
export function widgetWithOpenSettings(page: Page): Locator {
  return DashboardSelectors.widgets(page).filter({
    has: page.locator('[data-testid="dashboard-widget-settings-button"][data-state="open"]'),
  });
}

// ---------------------------------------------------------------------------
// The toolbar and the picker
// ---------------------------------------------------------------------------

/**
 * Open and close every dashboard toolbar control: the global Filter button
 * and its popover; in Edit mode "+ Add global filter" and the menu it opens,
 * and a chip's popover when a global filter exists; the Settings menu. A
 * full-page dashboard offers no Expand button.
 */
export async function openAndCloseEveryToolbarControl(page: Page) {
  const collector = frameworkErrorCollector(page);
  const mode = await dashboardMode(page);
  const toolbar = page.getByTestId('dashboard-actions').filter({ visible: true }).first();
  const before = canonicalJson(await readDashboardSetting(page));
  const control = async (label: string, run: (context: string) => Promise<void>) => {
    const context = `Toolbar / ${mode} / ${label}`;

    collector.setContext(context);
    await run(context);
    await closeOverlays(page, context);
    await collector.expectNone(context);
  };

  await control('Global filter', (context) =>
    openAndCloseOverlay(
      page,
      context,
      () => DashboardSelectors.globalFilterButton(page).click(),
      async () => {
        await expect(DashboardSelectors.globalFilterMenu(page)).toBeVisible();
        if (mode !== 'Edit') return;
        await DashboardSelectors.globalFilterAdd(page).click();
        await expect(page.getByTestId('dashboard-global-filter-property-picker')).toBeVisible();
        await expect(page.getByTestId('dashboard-global-filter-property-option').first()).toBeVisible();
      }
    )
  );

  if (mode === 'Edit' && (await DashboardSelectors.globalFilterChips(page).count()) > 0) {
    await control('Global filter chip', (context) =>
      openAndCloseOverlay(
        page,
        context,
        () => DashboardSelectors.globalFilterChips(page).first().click(),
        () => expect(DashboardSelectors.globalFilterMenu(page)).toBeVisible()
      )
    );
  }

  await control('Settings menu', (context) =>
    openAndCloseOverlay(
      page,
      context,
      () => toolbar.getByTestId('database-actions-settings').click(),
      async () => {
        const menu = page.getByTestId('dashboard-settings-menu');

        await expect(menu).toBeVisible();
        await openEverySubMenu(page, menu, context);
      }
    )
  );

  // Expand is offered only by a dashboard embedded in a document; this one is a full page.
  await expect(toolbar.getByTestId('dashboard-toolbar-open-as-page')).toHaveCount(0);
  collector.setContext('the dashboard');
  expect(canonicalJson(await readDashboardSetting(page)), `Toolbar / ${mode}: persisted state changed`).toBe(before);
}

/** Open the widget picker from the add-widget control, show each of its tabs, then cancel it. */
export async function openAndCloseWidgetPicker(page: Page) {
  const collector = frameworkErrorCollector(page);
  const context = 'Widget picker';
  const before = canonicalJson(await readDashboardSetting(page));
  const picker = DashboardSelectors.picker(page);

  collector.setContext(context);
  const button = DashboardSelectors.addWidgetButton(page).filter({ visible: true }).first();

  await expect(button, `${context}: no add-widget control`).toBeEnabled(WIDGET_TIMEOUT);
  await button.click();
  await expect(picker, `${context}: the picker did not open`).toBeVisible(WIDGET_TIMEOUT);
  const tabs = picker.getByRole('tab');
  const count = await tabs.count();

  expect(count, `${context}: the picker shows no tabs`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const tab = tabs.nth(index);

    if (await tab.isDisabled()) continue;
    const tabContext = `${context} / ${((await tab.innerText()) || `tab ${index + 1}`).trim()}`;

    collector.setContext(tabContext);
    await tab.click();
    await expect(tab, `${tabContext}: the tab did not open`).toHaveAttribute('aria-selected', 'true');
    await expect(picker.locator('[role="tabpanel"][data-state="active"]')).toBeVisible();
    await collector.expectNone(tabContext);
  }

  collector.setContext(context);
  await page.keyboard.press('Escape');
  await expect(picker, `${context}: the picker did not close`).toBeHidden({ timeout: WIDGET_TIMEOUT_MS });
  await collector.expectNone(context);
  collector.setContext('the dashboard');
  expect(canonicalJson(await readDashboardSetting(page)), `${context}: persisted state changed`).toBe(before);
}
