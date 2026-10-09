/**
 * Dashboard widget chrome (WP03, addendum A5): the widget box, its title pill
 * and card, the tools and their popovers, the settings host, the selection
 * outline and the dashboard toolbar. The wording is shared with the desktop
 * BDD (`dashboard_widget_chrome.feature`).
 *
 * A widget is named by its view name: "Grid" is the dashboard host's Grid
 * widget, labelled "<host> Grid" by the composite Given.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { pressEscapeUntilHidden, resolveColor, WIDGET_TIMEOUT } from '../../support/dashboard-shared-helpers';
import {
  addFixtureDatabase,
  DashboardSelectors,
  dashboardWorld,
  fixtureDatabase,
  gridDataRows,
  peekDashboardWorld,
  prepareDashboardFixture,
  readDashboardSetting,
  readDatabaseViews,
  splitList,
  viewIdForLabel,
  widgetLocator,
} from '../../support/dashboard-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { DatabaseFilterSelectors } from '../../support/selectors';

const { Given, When, Then } = createBdd();

const OFFLINE_TIMEOUT = { timeout: 60_000 };
const TOLERANCE = 1;
const TOOL_LABELS: Record<string, string> = {
  filter: 'Filter',
  sort: 'Sort',
  search: 'Search',
  new: 'New',
  settings: 'Settings',
};
const TOOLBAR_LABELS: Record<string, string> = {
  'dashboard-global-filter-button': 'Filter',
  'dashboard-toolbar-open-as-page': 'Open as full page',
  'database-actions-settings': 'Settings',
  'dashboard-edit-button': 'Edit',
  'dashboard-done-button': 'Done',
};
const SETTING_TOGGLES: Record<string, string> = {
  'Show widget titles': 'dashboard-settings-show-widget-titles',
  'Show icons in heading': 'dashboard-settings-show-icons-in-heading',
};
/** The first Checkbox property of each fixture database. */
const CHECKBOX_PROPERTY: Record<string, string> = { Projects: 'Urgent', Tasks: 'Blocked' };
/** The list widget's title inset, shared with desktop (`dashboard-parity/widget-content.json`). */
const LIST_TITLE_INSET = (
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../src/application/database-yjs/__fixtures__/dashboard-parity/widget-content.json', import.meta.url)
      ),
      'utf8'
    )
  ) as { geometry: { list_title_inset: number } }
).geometry.list_title_inset;
const rememberedCards = new WeakMap<Page, { width: number; height: number }>();
const linkedDashboards = new WeakMap<Page, { viewId: string; name: string }>();
const blockedSources = new WeakMap<Page, (url: URL) => boolean>();

/**
 * The widget label of a view name ("Grid" → "Projects Grid"). The bare name
 * is also registered as a view of the host, for shared steps that take labels.
 */
function labelOf(page: Page, name: string) {
  if (/\s/.test(name.trim())) return name;
  const world = dashboardWorld(page);
  const database = world.dashboardHost ?? 'Projects';
  const label = `${database} ${name}`;

  world.viewsByName = { ...world.viewsByName, [name]: { viewId: viewIdForLabel(page, label), database } };
  return label;
}

function widgetOf(page: Page, name: string) {
  return widgetLocator(page, labelOf(page, name));
}

async function box(locator: Locator) {
  const rect = await locator.boundingBox();

  if (!rect) throw new Error('The element is not rendered');
  return rect;
}

/** The tools shown (opacity 1) in DOM order; hidden tools keep a slot at opacity 0. */
async function visibleTools(widget: Locator) {
  return widget
    .locator('[data-widget-tool]')
    .evaluateAll((slots) =>
      slots.filter((slot) => getComputedStyle(slot).opacity === '1').map((slot) => slot.getAttribute('data-widget-tool'))
    );
}

async function settledToolOpacities(widget: Locator) {
  return widget
    .locator('[data-widget-tool]')
    .evaluateAll((slots) => slots.map((slot) => getComputedStyle(slot).opacity));
}

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given('a document links {string} as a dashboard', async ({ page, request }, database: string) => {
  if (!peekDashboardWorld(page)) await prepareDashboardFixture(page, request, [database]);
  else if (!dashboardWorld(page).databases[database]) await addFixtureDatabase(page, request, database);
  const { databaseId } = fixtureDatabase(page, database);
  const before = new Set((await readDatabaseViews(page, databaseId)).map((view) => view.id));
  const documentId = await createDocumentPageAndNavigate(page);

  await insertLinkedDatabaseViaSlash(page, documentId, database, 'Dashboard');
  const block = page.locator(`#editor-${documentId} [data-block-type="dashboard"]`);

  await expect(block.getByTestId('dashboard-view')).toBeVisible(WIDGET_TIMEOUT);
  let linked: { viewId: string; name: string } | undefined;

  await expect
    .poll(async () => {
      const view = (await readDatabaseViews(page, databaseId)).find(
        (candidate) => !before.has(candidate.id) && candidate.layout === 9
      );

      linked = view ? { viewId: view.id, name: view.name } : undefined;
      return Boolean(linked);
    }, WIDGET_TIMEOUT)
    .toBe(true);
  linkedDashboards.set(page, linked as { viewId: string; name: string });
});

Given(
  'the {string} database cannot be reached and is not cached in this browser',
  async ({ page }, database: string) => {
    const source = fixtureDatabase(page, database);
    // Every request for the source's data: its database, its pages and views
    // (a page view carries the database collab) and its rows. Its permission
    // check still answers.
    const ids = [source.databaseId, source.pageId, ...Object.values(source.views), ...Object.values(source.rowIds)];
    const isSourceRequest = (url: URL) =>
      !url.pathname.endsWith('/permission') && ids.some((id) => url.pathname.includes(id));
    const dashboardUrl = page.url();

    blockedSources.set(page, isSourceRequest);
    await page.route(isSourceRequest, (route) => route.abort('internetdisconnected'));
    // Forget every cached collab while no page of the app is open to hold or
    // write it back: a static file of the same origin runs no app code.
    await page.goto(new URL('/appflowy.svg', dashboardUrl).toString());
    const remaining = await page.evaluate(async () => {
      const names = (await indexedDB.databases()).map((database) => database.name).filter(Boolean) as string[];

      await Promise.all(
        names.map(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase(name);

              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
              request.onblocked = () => reject(new Error(`deleting ${name} is blocked`));
            })
        )
      );
      return (await indexedDB.databases()).length;
    });

    expect(remaining).toBe(0);
    await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
    await expect(DashboardSelectors.view(page)).toBeVisible(WIDGET_TIMEOUT);
  }
);

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('I move the pointer away from the dashboard', async ({ page }) => {
  await page.mouse.move(1, 1);
  // The tools also show while the widget holds the keyboard focus.
  await DashboardSelectors.view(page)
    .first()
    .evaluate((view) => {
      const active = document.activeElement as HTMLElement | null;

      if (active && view.contains(active)) active.blur();
    });
});

When('I hover the {string} widget', async ({ page }, name: string) => {
  const widget = widgetOf(page, name);
  const rect = await box(widget);

  // Over the card, away from the header tools.
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
});

When('I filter the {string} widget by its checkbox property', async ({ page }, name: string) => {
  const label = labelOf(page, name);
  const widget = widgetLocator(page, label);
  const property = CHECKBOX_PROPERTY[label.split(' ')[0]];

  await widget.hover();
  await widget.locator('[data-widget-tool="filter"]').getByTestId('database-actions-filter').click();
  await DatabaseFilterSelectors.propertyItemByName(page, property).filter({ visible: true }).click();
  // The new rule's editor opens inside the widget's Filters popover; close both.
  await pressEscapeUntilHidden(page, page.getByTestId('dashboard-widget-filters-popover'));
  await expect(widget.getByTestId('database-actions-filter')).toHaveAttribute('data-active', 'true');
});

When('I open the {string} tool of the {string} widget', async ({ page }, tool: string, name: string) => {
  const widget = widgetOf(page, name);
  const slot = widget.locator(`[data-widget-tool="${tool.toLowerCase()}"]`);

  await widget.hover();
  await slot.getByRole('button').first().click();
});

When('I press Escape', async ({ page }) => {
  await page.keyboard.press('Escape');
});

When('I press Enter', async ({ page }) => {
  await page.keyboard.press('Enter');
});

When('I focus the {string} widget title', async ({ page }, name: string) => {
  await widgetOf(page, name).getByTestId('dashboard-widget-title-button').focus();
});

When('I click the {string} widget title', async ({ page }, name: string) => {
  await widgetOf(page, name).getByTestId('dashboard-widget-title-button').click();
});

When('I right-click the {string} widget outside its title', async ({ page }, name: string) => {
  await expect(DashboardSelectors.widgetMenu(page)).toBeHidden();
  const rect = await box(widgetOf(page, name));

  // The box's bottom padding: the widget itself, not its content.
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height - 3, { button: 'right' });
});

When('I remember the size of the {string} widget card', async ({ page }, name: string) => {
  const rect = await box(widgetOf(page, name).getByTestId('dashboard-widget-body'));

  rememberedCards.set(page, { width: rect.width, height: rect.height });
});

When('I close the {string} panel', async ({ page }, panel: string) => {
  expect(panel).toBe('View settings');
  await page.getByTestId('dashboard-widget-settings-close').click();
  await expect(page.getByTestId('dashboard-widget-settings')).toBeHidden();
});

async function setDashboardToggle(page: Page, setting: string, on: boolean) {
  const testId = SETTING_TOGGLES[setting];

  expect(testId, `Unknown dashboard setting "${setting}"`).toBeTruthy();
  await page.getByTestId('dashboard-actions').getByTestId('database-actions-settings').click();
  const toggle = page.getByTestId(testId);

  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('data-checked')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('data-checked', String(on));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dashboard-settings-menu')).toBeHidden();
}

When('I turn on the dashboard setting {string}', async ({ page }, setting: string) => {
  await setDashboardToggle(page, setting, true);
});

When('I turn off the dashboard setting {string}', async ({ page }, setting: string) => {
  await setDashboardToggle(page, setting, false);
});

When('I click the {string} button of the {string} widget', async ({ page }, button: string, name: string) => {
  expect(button).toBe('Widget options');
  await widgetOf(page, name).getByTestId('dashboard-widget-options-button').click();
});

When('I choose {string} in the widget menu', async ({ page }, action: string) => {
  await DashboardSelectors.widgetMenuItem(
    page,
    action as Parameters<typeof DashboardSelectors.widgetMenuItem>[1]
  ).click();
});

When('I click {string} in the dashboard toolbar', async ({ page }, label: string) => {
  const testId = Object.entries(TOOLBAR_LABELS).find(([, value]) => value === label)?.[0];

  expect(testId, `Unknown toolbar button "${label}"`).toBeTruthy();
  await page
    .getByTestId('dashboard-actions')
    .getByTestId(testId as string)
    .click();
});

When('I hover row {int} of the {string} widget', async ({ page }, row: number, name: string) => {
  await gridDataRows(widgetOf(page, name))
    .nth(row - 1)
    .hover();
});

When('the connection to the {string} database comes back', async ({ page }, database: string) => {
  const isSourceRequest = blockedSources.get(page);

  expect(isSourceRequest, `The "${database}" database was never blocked`).toBeTruthy();
  await page.unroute(isSourceRequest as (url: URL) => boolean);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
});

// ---------------------------------------------------------------------------
// Then: the box, the header and the card
// ---------------------------------------------------------------------------

Then(
  'the {string} widget title is a {string} button above the widget card',
  async ({ page }, name: string, accessibleName: string) => {
    const widget = widgetOf(page, name);
    const title = widget.getByTestId('dashboard-widget-title-button');

    await expect(title).toBeVisible(WIDGET_TIMEOUT);
    await expect(title).toHaveAttribute('aria-label', accessibleName);
    expect(await title.evaluate((element) => element.tagName)).toBe('BUTTON');
    const titleBox = await box(title);
    const cardBox = await box(widget.getByTestId('dashboard-widget-body'));

    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(cardBox.y + 0.5);
  }
);

Then('the {string} widget title shows no icon', async ({ page }, name: string) => {
  await expect(widgetOf(page, name).getByTestId('dashboard-widget-title-button')).toBeVisible(WIDGET_TIMEOUT);
  await expect(widgetOf(page, name).getByTestId('dashboard-widget-title-icon')).toHaveCount(0);
});

Then('the {string} widget title shows the view icon', async ({ page }, name: string) => {
  await expect(widgetOf(page, name).getByTestId('dashboard-widget-title-icon')).toBeVisible(WIDGET_TIMEOUT);
});

Then('the {string} widget header is {int} pixels tall', async ({ page }, name: string, height: number) => {
  const rect = await box(widgetOf(page, name).getByTestId('dashboard-widget-header'));

  expect(Math.abs(rect.height - height)).toBeLessThanOrEqual(0.5);
});

Then(
  'the {string} widget card is {int} pixels shorter than its row',
  async ({ page }, name: string, difference: number) => {
    const widget = widgetOf(page, name);

    await expect
      .poll(async () => {
        const widgetBox = await box(widget);
        const cardBox = await box(widget.getByTestId('dashboard-widget-body'));

        return Math.abs(widgetBox.height - cardBox.height - difference);
      })
      .toBeLessThanOrEqual(TOLERANCE);
  }
);

Then('the {string} widget has no title', async ({ page }, name: string) => {
  const widget = widgetOf(page, name);

  await expect(widget.getByTestId('dashboard-widget-tool-capsule')).toBeAttached(WIDGET_TIMEOUT);
  await expect(widget.getByTestId('dashboard-widget-header')).toHaveCount(0);
  await expect(widget.getByTestId('dashboard-widget-title')).toHaveCount(0);
});

Then('the {string} widget card keeps its size', async ({ page }, name: string) => {
  const before = rememberedCards.get(page);

  expect(before, 'Remember the card size first').toBeDefined();
  await expect
    .poll(async () => {
      const rect = await box(widgetOf(page, name).getByTestId('dashboard-widget-body'));

      return (
        Math.abs(rect.width - (before?.width ?? 0)) <= TOLERANCE &&
        Math.abs(rect.height - (before?.height ?? 0)) <= TOLERANCE
      );
    })
    .toBe(true);
});

Then('the {string} widget has the edit tint', async ({ page }, name: string) => {
  const widget = widgetOf(page, name);

  await expect(widget).toHaveAttribute('data-editing', 'true');
  await expect
    .poll(() => widget.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
});

Then('the {string} widget title is blue', async ({ page }, name: string) => {
  const title = widgetOf(page, name).getByTestId('dashboard-widget-title-button');
  const action = await resolveColor(page, '--text-action');

  await expect.poll(() => title.evaluate((element) => getComputedStyle(element).color)).toBe(action);
});

Then('the {string} widget header has no drag glyph and no more button', async ({ page }, name: string) => {
  const header = widgetOf(page, name).getByTestId('dashboard-widget-header');

  await expect(header).toBeVisible();
  await expect(header.getByTestId('dashboard-widget-menu-button')).toHaveCount(0);
  await expect(header.getByTestId('dashboard-widget-options-button')).toHaveCount(0);
  // Any glyph in the band belongs to the tools.
  expect(
    await header.evaluate(
      (element) =>
        Array.from(element.querySelectorAll('svg')).filter((svg) => !svg.closest('[data-testid="database-actions"]'))
          .length
    )
  ).toBe(0);
});

Then('the {string} widget card shows no filter bar', async ({ page }, name: string) => {
  const widget = widgetOf(page, name);

  await expect(widget.getByTestId('dashboard-widget-body')).toBeVisible(WIDGET_TIMEOUT);
  await expect(widget.locator('.database-conditions')).toHaveCount(0);
  await expect(widget.getByTestId('database-filter-condition')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Then: tools and popovers
// ---------------------------------------------------------------------------

Then('the {string} widget shows no tools', async ({ page }, name: string) => {
  const widget = widgetOf(page, name);

  await expect(widget.locator('[data-widget-tool]').first()).toBeAttached(WIDGET_TIMEOUT);
  await expect.poll(() => settledToolOpacities(widget)).toEqual(expect.arrayContaining(['0']));
  await expect.poll(() => visibleTools(widget)).toEqual([]);
});

async function expectVisibleTools(page: Page, name: string, tools: string) {
  const widget = widgetOf(page, name);
  const expected = splitList(tools);

  await expect(widget.locator('[data-widget-tool]').first()).toBeAttached(WIDGET_TIMEOUT);
  await expect
    .poll(async () => (await visibleTools(widget)).map((tool) => TOOL_LABELS[tool ?? ''] ?? tool))
    .toEqual(expected);
}

Then('the {string} widget shows the tools {string}', async ({ page }, name: string, tools: string) => {
  await expectVisibleTools(page, name, tools);
});

Then('the {string} widget shows the tools {string} without hover', async ({ page }, name: string, tools: string) => {
  await page.mouse.move(1, 1);
  await expectVisibleTools(page, name, tools);
});

Then('the {string} tool of the {string} widget is highlighted', async ({ page }, tool: string, name: string) => {
  const button = widgetOf(page, name).locator(`[data-widget-tool="${tool.toLowerCase()}"]`).getByRole('button').first();
  const accent = await resolveColor(page, '--fill-theme-thick');

  await expect(button).toHaveAttribute('data-active', 'true');
  await expect.poll(() => button.evaluate((element) => getComputedStyle(element).color)).toBe(accent);
});

Then('the widget {string} popover lists {int} rule(s)', async ({ page }, kind: string, count: number) => {
  const popover = page.getByTestId(`dashboard-widget-${kind.toLowerCase()}-popover`);

  await expect(popover).toBeVisible();
  await expect(popover).toContainText(kind);
  await expect(popover.getByTestId(kind === 'Filters' ? 'database-filter-condition' : 'sort-condition')).toHaveCount(
    count
  );
});

Then('the widget {string} popover is closed', async ({ page }, kind: string) => {
  await expect(page.getByTestId(`dashboard-widget-${kind.toLowerCase()}-popover`)).toBeHidden();
});

// ---------------------------------------------------------------------------
// Then: the menu, the selection and the settings host
// ---------------------------------------------------------------------------

Then('the widget menu is open', async ({ page }) => {
  await expect(DashboardSelectors.widgetMenu(page)).toBeVisible();
});

Then('the widget menu is closed', async ({ page }) => {
  await expect(DashboardSelectors.widgetMenu(page)).toBeHidden();
});

Then('the {string} widget title has the keyboard focus', async ({ page }, name: string) => {
  await expect(widgetOf(page, name).getByTestId('dashboard-widget-title-button')).toBeFocused();
});

Then('the {string} widget is outlined', async ({ page }, name: string) => {
  await expect(widgetOf(page, name)).toHaveAttribute('data-selected', 'true');
});

Then('the {string} widget is not outlined', async ({ page }, name: string) => {
  await expect(widgetOf(page, name)).not.toHaveAttribute('data-selected', 'true');
});

Then('the {string} panel opens beside the {string} widget', async ({ page }, panel: string, name: string) => {
  const host = page.getByTestId('dashboard-widget-settings');

  await expect(host).toBeVisible();
  await expect(host).toContainText(panel);
  const hostBox = await box(host);
  const widgetBox = await box(widgetOf(page, name));
  const right = hostBox.x >= widgetBox.x + widgetBox.width - 0.5;
  // WP06 §1.6 (one dock for the picker and the settings host): anchored at the box's top-right corner;
  // without room on the right the host opens on its left, its right edge 8px inside the box (over the widget).
  const dockedLeft = Math.abs(hostBox.x + hostBox.width - (widgetBox.x + widgetBox.width - 8)) <= 1;

  expect(right || dockedLeft).toBe(true);
  await expect(host).toHaveAttribute('data-side', right ? 'right' : 'left');
  // Top-aligned with the widget, shifted up only as far as the window edge
  // needs (the host's 16px collision padding): a chart widget's host holds
  // the whole chart panel (WP11, up to 560px tall) and may not fit below a
  // widget in the lower half of the window.
  const viewportHeight = page.viewportSize()?.height ?? Number.POSITIVE_INFINITY;

  // Measured once the host settles: the chart panel's rows mount after it opens and the host is placed again.
  await expect
    .poll(
      async () => {
        const settled = await box(host);
        const expectedTop = Math.max(16, Math.min(widgetBox.y, viewportHeight - 16 - settled.height));

        return Math.abs(settled.y - expectedTop);
      },
      { message: 'the View settings host is top-aligned with the widget, within the window' }
    )
    .toBeLessThanOrEqual(8);
});

Then('the dashboard layout setting {string} is true', async ({ page }, key: string) => {
  expect(key).toBe('show_icons_in_heading');
  await expect.poll(async () => (await readDashboardSetting(page)).show_icons_in_heading).toBe(true);
});

// ---------------------------------------------------------------------------
// Then: the toolbar
// ---------------------------------------------------------------------------

Then('the dashboard toolbar shows {string} from left to right', async ({ page }, buttons: string) => {
  const toolbar = page.getByTestId('dashboard-actions').filter({ visible: true }).first();

  await expect(toolbar).toBeVisible(WIDGET_TIMEOUT);
  await expect
    .poll(async () => {
      const boxes = await toolbar
        .locator('button[data-testid]')
        .evaluateAll((elements) =>
          elements.map((element) => ({ id: element.getAttribute('data-testid'), x: element.getBoundingClientRect().x }))
        );

      return boxes.sort((a, b) => a.x - b.x).map((entry) => TOOLBAR_LABELS[entry.id ?? ''] ?? entry.id);
    })
    .toEqual(splitList(buttons));
});

Then('the dashboard Edit button shows no icon', async ({ page }) => {
  const edit = DashboardSelectors.editButton(page);

  await expect(edit).toBeVisible();
  await expect(edit.locator('svg')).toHaveCount(0);
});

Then('the {string} dashboard is open as a full page', async ({ page }, name: string) => {
  const linked = linkedDashboards.get(page);

  expect(linked, 'No dashboard was linked in this scenario').toBeDefined();
  expect(linked?.name).toBe(name);
  await expect.poll(() => page.url(), WIDGET_TIMEOUT).toContain(linked?.viewId ?? '');
  await expect(DashboardSelectors.view(page).first()).toBeVisible(WIDGET_TIMEOUT);
  // A full page: no document block around the dashboard any more.
  await expect(page.locator('[data-block-type="dashboard"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Then: the grid inside a widget (addendum A5)
// ---------------------------------------------------------------------------

Then(
  'the first column of the {string} widget starts {int} pixels inside the widget card',
  async ({ page }, name: string, inset: number) => {
    const widget = widgetOf(page, name);
    const column = widget.locator('[data-parity-id="dash-widget-grid-first-column"]').first();

    await expect(column).toBeVisible(WIDGET_TIMEOUT);
    const card = await box(widget.getByTestId('dashboard-widget-body'));

    expect(Math.abs((await box(column)).x - card.x - inset)).toBeLessThanOrEqual(0.5);
  }
);

Then(
  'the first row title of the {string} widget starts {int} pixels inside the widget card',
  async ({ page }, name: string, inset: number) => {
    expect(inset, 'widget-content.json geometry.list_title_inset').toBe(LIST_TITLE_INSET);
    const widget = widgetOf(page, name);
    // The title cell: the row icon when the row shows one, else the title text.
    const title = widget.locator('[data-testid^="list-primary-cell-"]').first();

    await expect(title).toBeVisible(WIDGET_TIMEOUT);
    // Polled: the card settles its padding when the mode changes.
    await expect
      .poll(async () => {
        const card = await box(widget.getByTestId('dashboard-widget-body'));

        return Math.abs((await box(title)).x - card.x - inset);
      })
      .toBeLessThanOrEqual(0.5);
  }
);

Then('the column headers of the {string} widget start at the top of the widget card', async ({ page }, name: string) => {
  const widget = widgetOf(page, name);
  const header = widget.locator('[data-parity-id="dash-widget-grid-header"]').first();

  await expect(header).toBeVisible(WIDGET_TIMEOUT);
  const card = await box(widget.getByTestId('dashboard-widget-body'));

  expect(Math.abs((await box(header)).y - card.y)).toBeLessThanOrEqual(0.5);
});

Then('the {string} widget shows no row selection checkboxes', async ({ page }, name: string) => {
  const widget = widgetOf(page, name);

  await expect(gridDataRows(widget).first()).toBeVisible(WIDGET_TIMEOUT);
  // A checkbox property's cells are values, not row selection.
  expect(
    await widget.evaluate(
      (element) =>
        Array.from(element.querySelectorAll('[role="checkbox"], input[type="checkbox"]')).filter(
          (checkbox) => !checkbox.closest('.grid-row-cell')
        ).length
    )
  ).toBe(0);
  await expect(widget.getByTestId('row-add-button')).toHaveCount(0);
});

Then(
  'each one-line row of the {string} widget is {int} pixels tall plus a {int} pixel divider',
  async ({ page }, name: string, height: number, divider: number) => {
    const rows = gridDataRows(widgetOf(page, name));

    await expect(rows.first()).toBeVisible(WIDGET_TIMEOUT);
    const measure = () =>
      rows.evaluateAll((elements) =>
        elements.map((element) => {
          const cell = element.querySelector('.grid-row-cell');
          const rect = element.getBoundingClientRect();

          return {
            top: rect.top,
            height: rect.height,
            border: cell ? Number.parseFloat(getComputedStyle(cell).borderTopWidth) || 0 : 0,
          };
        })
      );
    // The largest gap from the contract over every row height and row pitch.
    const deviation = async () => {
      const measured = await measure();
      const heights = measured.map((row) => Math.abs(row.height - (height + divider)));
      const pitches = measured
        .slice(1)
        .map((row, index) => Math.abs(row.top - measured[index].top - (height + divider)));

      return Math.max(0, ...heights, ...pitches);
    };

    await expect.poll(deviation, { message: 'one-line rows of 36px plus a 1px divider' }).toBeLessThanOrEqual(0.5);
    const measured = await measure();

    expect(measured.length).toBeGreaterThan(1);
    for (const row of measured) expect(row.border, JSON.stringify(measured)).toBe(divider);
  }
);

Then('row {int} of the {string} widget shows only its row menu button', async ({ page }, row: number, name: string) => {
  const widget = widgetOf(page, name);
  const controls = widget.locator('[data-parity-id="dash-widget-grid-row-controls"]').nth(row - 1);

  await expect(controls).toBeVisible();
  await expect(controls.getByTestId('row-accessory-button')).toHaveCount(1);
  await expect(widget.getByTestId('row-add-button')).toHaveCount(0);
});

Then('the {string} widget shows no scrollbar', async ({ page }, name: string) => {
  const widget = widgetOf(page, name);

  await expect(widget.locator('[data-parity-id="dash-widget-grid-scrollbar"]').first()).toBeVisible(WIDGET_TIMEOUT);
  await expect
    .poll(() =>
      widget.evaluate((element) => {
        const scrollers = Array.from(
          element.querySelectorAll<HTMLElement>('[data-parity-id="dash-widget-grid-scrollbar"]')
        );
        const classic = scrollers.some(
          (scroller) =>
            scroller.offsetWidth - scroller.clientWidth > 2 || scroller.offsetHeight - scroller.clientHeight > 2
        );
        const sticky = Array.from(element.querySelectorAll<HTMLElement>('.appflowy-visible-scrollbar')).some(
          (bar) => getComputedStyle(bar).visibility === 'visible' && bar.getBoundingClientRect().height > 0
        );

        return classic || sticky;
      })
    )
    .toBe(false);
});

Then(
  'the {string} widget shows the {string} placeholder saying {string}',
  async ({ page }, label: string, reason: string, text: string) => {
    const placeholder = widgetLocator(page, label).getByTestId('dashboard-widget-placeholder');

    // The view loader retries a failed request with backoff before it gives up.
    await expect(placeholder).toHaveAttribute('data-reason', reason, OFFLINE_TIMEOUT);
    await expect(placeholder).toContainText(text);
    await expect(placeholder.getByTestId('dashboard-widget-remove-button')).toHaveCount(0);
  }
);
