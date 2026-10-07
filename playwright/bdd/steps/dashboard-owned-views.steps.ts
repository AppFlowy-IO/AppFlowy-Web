/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  chooseWidgetMenuEntryAt,
  createWidgetViewThroughPicker,
  expectViewGone,
  folderViewExists,
  persistedWidgetAt,
  readFolderViewName,
  readOwnedViewMarkers,
  widgetAtIndex,
} from '../../support/dashboard-add-widget-helpers';
import {
  convertedCopyViewId,
  copiedDatabaseWidget,
  CopiedDatabaseDashboard,
  duplicateDatabaseDashboardFromSidebar,
  isTabFullyVisible,
  readDatabaseViews,
  readFolderViewExtra,
  readViewGroups,
  renameDatabaseView,
  reopenDatabaseOnTab,
  seedDatabaseTabs,
  switchViewToDashboard,
  tabBarViewIds,
  tabStripOverflows,
  widgetAt,
  widgetViewId,
} from '../../support/dashboard-owned-views-helpers';
import { WIDGET_TIMEOUT, WIDGET_TIMEOUT_MS } from '../../support/dashboard-shared-helpers';
import {
  addDashboardView,
  addFixtureDatabase,
  addViewThroughTabs,
  allWidgets,
  apiGet,
  createDatabaseViewThroughApi,
  DashboardSelectors,
  dashboardViewId,
  dashboardWorld,
  databaseForLabel,
  enterEditMode,
  DatabaseViewLayout,
  expectDashboardMode,
  expectRowHeight,
  expectRowWidths,
  fixtureDatabase,
  hostDatabase,
  LAYOUT_BY_NAME,
  leaveEditMode,
  openDashboard,
  openDatabasePage,
  openWidgetPicker,
  parseViewLabel,
  pickExistingView,
  prepareDashboardFixture,
  readDashboardSetting,
  splitList,
  viewIdForLabel,
} from '../../support/dashboard-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { BlockSelectors, DatabaseViewSelectors } from '../../support/selectors';

/**
 * WP05 dashboard-owned widget views (W2: the active tab reveal and
 * conversion; W4: created, duplicated, deleted and renamed widget views, the
 * picker listing and the dashboard duplicates). The wording is identical on desktop
 * (`integration_test/desktop/bdd/database/dashboard/dashboard_owned_views*.feature`).
 */
const { Given, When, Then } = createBdd();

/** The persisted widget at a 1-based reading-order position. */
async function persistedWidget(page: Page, index: number) {
  const widgets = (await readDashboardSetting(page)).rows.flatMap((row) => row.widgets);
  const widget = widgets[index - 1];

  if (!widget) throw new Error(`The dashboard has no widget ${index} (it has ${widgets.length})`);
  return widget;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

Given(
  'a {string} database with a {string} view and an empty dashboard in Edit mode',
  async ({ page, request }, database: string, layout: string) => {
    await prepareDashboardFixture(page, request, [database]);
    if (!fixtureDatabase(page, database).views[layout]) await addViewThroughTabs(page, database, layout);
    await addDashboardView(page, database);
    await expectDashboardMode(page, 'Edit');
  }
);

Given(
  '{string} has {int} more {string} views before the dashboard tab',
  async ({ page, request }, database: string, count: number, layout: string) => {
    const world = dashboardWorld(page);
    const fixture = fixtureDatabase(page, database);
    const seeded = await seedDatabaseTabs(page, request, database, count, layout);

    // The container lists them between its first Grid and the dashboard.
    await expect
      .poll(async () => {
        const container = await apiGet<{ children?: { view_id: string }[] }>(
          request,
          world.owner.accessToken,
          `/api/workspace/${world.workspaceId}/view/${fixture.pageId}?depth=1`
        );

        return (container.children ?? []).map((child) => child.view_id);
      }, WIDGET_TIMEOUT)
      .toEqual([fixture.views[layout], ...seeded, dashboardViewId(page)]);
  }
);

Given(
  '{string} has a {string} view named {string}',
  async ({ page, request }, database: string, layout: string, name: string) => {
    const viewId = await addViewThroughTabs(page, database, layout);
    const world = dashboardWorld(page);

    await renameDatabaseView(page, request, database, viewId, name);
    world.viewsByName = { ...(world.viewsByName ?? {}), [name]: { viewId, database } };
  }
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

When('the user reopens the {string} database on the dashboard tab', async ({ page }, database: string) => {
  await reopenDatabaseOnTab(page, database, dashboardViewId(page));
});

When(
  'the user switches the {string} view of {string} to the Dashboard layout',
  async ({ page }, name: string, database: string) => {
    await switchViewToDashboard(page, database, viewIdForLabel(page, name));
  }
);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

Then('the active tab is fully visible in the tab bar', async ({ page }) => {
  const viewId = dashboardViewId(page);
  const tab = DatabaseViewSelectors.viewTab(page, viewId);

  await expect(tab).toHaveAttribute('data-state', 'active');
  // Only a strip too narrow for every tab can hide the active one.
  await expect.poll(() => tabStripOverflows(page), WIDGET_TIMEOUT).toBe(true);
  const tabIds = await tabBarViewIds(page);

  expect(tabIds[tabIds.length - 1]).toBe(viewId);
  await expect.poll(() => isTabFullyVisible(page, viewId), WIDGET_TIMEOUT).toBe(true);
});

Then('dashboard row {int} has widths {string}', async ({ page }, rowIndex: number, widths: string) => {
  await expectRowWidths(page, rowIndex, splitList(widths).map(Number));
});

// "Is N pixels tall" is exact (within a rendered pixel); "is about N px tall" allows a snap step.
Then('dashboard row {int} is {int} pixels tall', async ({ page }, rowIndex: number, height: number) => {
  await expectRowHeight(page, rowIndex, height);
});

Then('widget {int} is titled {string}', async ({ page }, index: number, title: string) => {
  await expect(widgetAt(page, index).getByTestId('dashboard-widget-title')).toHaveText(title, WIDGET_TIMEOUT);
});

Then(
  'widget {int} shows a {string} view with the groups of the original {string} view',
  async ({ page }, index: number, layout: string, name: string) => {
    const original = viewIdForLabel(page, name);
    const { view_id: viewId, database_id: databaseId } = await persistedWidget(page, index);
    const views = await readDatabaseViews(page, databaseId);
    const originalGroups = await readViewGroups(page, databaseId, original);

    expect(viewId).not.toBe(original);
    expect(views.find((view) => view.id === viewId)?.layout).toBe(LAYOUT_BY_NAME[layout]);
    expect(originalGroups).toEqual(expect.arrayContaining([expect.objectContaining({ field_id: expect.any(String) })]));
    expect(await readViewGroups(page, databaseId, viewId)).toEqual(originalGroups);
    await expect(widgetAt(page, index).getByTestId('board-column').first()).toBeVisible(WIDGET_TIMEOUT);
  }
);

Then('the view of widget {int} belongs to the dashboard', async ({ page, request }, index: number) => {
  const owner = dashboardViewId(page);
  const { view_id: viewId, database_id: databaseId } = await persistedWidget(page, index);

  // Both copies of the marker: the collab mirror and the authoritative folder extra.
  await expect
    .poll(async () => (await readDatabaseViews(page, databaseId)).find((view) => view.id === viewId)?.dashboardOwner)
    .toBe(owner);
  await expect
    .poll(async () => (await readFolderViewExtra(page, request, viewId)).dashboard_owner, WIDGET_TIMEOUT)
    .toBe(owner);
});

Then(
  'the {string} tab bar shows {string} with the dashboard icon',
  async ({ page }, database: string, name: string) => {
    const viewId = viewIdForLabel(page, name);
    const tab = DatabaseViewSelectors.viewTab(page, viewId);

    if (!(await tab.isVisible())) await openDatabasePage(page, database, viewId);
    await expect(tab).toContainText(name);
    await expect(DashboardSelectors.viewIcon(tab)).toBeVisible();
    // Its owned copy has the same name but is not a tab.
    await expect
      .poll(async () => {
        const texts = await DatabaseViewSelectors.viewTab(page).allInnerTexts();

        return texts.filter((text) => text.trim() === name).length;
      })
      .toBe(1);
  }
);

// dashboard-creation.feature: the layout switcher seeds the converted view's copy.
Then('widget {int} shows a copy of the {string} view', async ({ page }, index: number, label: string) => {
  const original = viewIdForLabel(page, label);
  const copyId = convertedCopyViewId(page, original);
  const databaseId = fixtureDatabase(page, databaseForLabel(page, label)).databaseId;
  const named = Boolean(dashboardWorld(page).viewsByName?.[label]);

  expect(await widgetViewId(page, index)).toBe(copyId);
  const views = await readDatabaseViews(page, databaseId);
  const copy = views.find((view) => view.id === copyId);

  expect(copy).toBeDefined();
  if (!named) expect(copy?.layout).toBe(LAYOUT_BY_NAME[parseViewLabel(label).layout]);
  expect(copy?.name).toBe(views.find((view) => view.id === original)?.name);
  expect(copy?.dashboardOwner).toBe(original);
  await expect(DashboardSelectors.widgetsForView(page, copyId)).toBeVisible(WIDGET_TIMEOUT);
});

// ---------------------------------------------------------------------------
// W4: widget views (WP05b)
// ---------------------------------------------------------------------------

/** What the scenario remembered: a duplicate's copy, a deleted widget's view, the views before an action, a copied dashboard. */
interface OwnedViewsMemory {
  copiedViewId?: string;
  shownViewIds: Record<number, string>;
  viewIdsBefore?: string[];
  otherDashboardViewId?: string;
  copiedDashboardViewId?: string;
  documentViewId?: string;
  databaseCopy?: CopiedDatabaseDashboard;
}

const memories = new WeakMap<Page, OwnedViewsMemory>();

function memory(page: Page): OwnedViewsMemory {
  let entry = memories.get(page);

  if (!entry) {
    entry = { shownViewIds: {} };
    memories.set(page, entry);
  }

  return entry;
}

async function hostViewIdList(page: Page, database: string) {
  return (await readDatabaseViews(page, fixtureDatabase(page, database).databaseId)).map((view) => view.id).sort();
}

/** The collab view of `viewId` as plain JSON (filters, sorts, groups, field settings, layout settings). */
async function readViewConfiguration(page: Page, databaseId: string, viewId: string) {
  return page.evaluate(
    ({ databaseId: id, viewId: view }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const collabView = bridge?.byDatabase(id)?.databaseDoc.getMap('data').get('database')?.get('views')?.get(view);
      const plain = (key: string) =>
        JSON.parse(JSON.stringify(bridge.plain(collabView?.get(key)) ?? null, (_k, value) => (typeof value === 'bigint' ? Number(value) : value)));

      return {
        layout: Number(collabView?.get('layout') ?? 0),
        filters: plain('filters'),
        sorts: plain('sorts'),
        groups: plain('groups'),
        field_settings: plain('field_settings'),
        layout_settings: plain('layout_settings'),
      };
    },
    { databaseId, viewId }
  );
}

/** The new Dashboard-layout view of the host database that is not `except`. */
async function newDashboardViewId(page: Page, known: string[]) {
  // The host database, also before the scenario's dashboard is known (a linked block being set up).
  const databaseId = fixtureDatabase(page, dashboardWorld(page).dashboardHost ?? 'Projects').databaseId;
  let viewId = '';

  await expect
    .poll(
      async () => {
        const views = await readDatabaseViews(page, databaseId);

        viewId = views.find((view) => view.layout === DatabaseViewLayout.Dashboard && !known.includes(view.id))?.id ?? '';
        return viewId;
      },
      { ...WIDGET_TIMEOUT, message: 'waiting for the copied dashboard view' }
    )
    .not.toBe('');
  return viewId;
}

function copiedDashboardViewId(page: Page) {
  const viewId = memory(page).copiedDashboardViewId;

  if (!viewId) throw new Error('No dashboard was copied in this scenario');
  return viewId;
}

When(
  'the user creates a new {string} view of {string} from the widget picker',
  async ({ page }, layout: string, database: string) => {
    await createWidgetViewThroughPicker(page, layout, database);
  }
);

When(
  'the user adds the {string} view of {string} from the widget picker',
  async ({ page }, layout: string, database: string) => {
    await openWidgetPicker(page);
    await pickExistingView(page, fixtureDatabase(page, database).views[layout]);
  }
);

When('the user opens the widget picker', async ({ page }) => {
  await openWidgetPicker(page);
});

When('the user duplicates widget {int}', async ({ page }, index: number) => {
  const before = allWidgets(await readDashboardSetting(page)).map((widget) => widget.view_id);

  await chooseWidgetMenuEntryAt(page, index, 'duplicate');
  let copy = '';

  await expect
    .poll(
      async () => {
        const after = allWidgets(await readDashboardSetting(page)).map((widget) => widget.view_id);

        copy = after.find((viewId) => !before.includes(viewId)) ?? '';
        return after.length === before.length + 1 && Boolean(copy);
      },
      { ...WIDGET_TIMEOUT, message: 'waiting for the duplicate and its own view' }
    )
    .toBe(true);
  memory(page).copiedViewId = copy;
});

When('the user tries to duplicate widget {int}', async ({ page }, index: number) => {
  memory(page).viewIdsBefore = await hostViewIdList(page, hostDatabase(page).name);
  await chooseWidgetMenuEntryAt(page, index, 'duplicate', { refused: true });
});

When('the user deletes widget {int}', async ({ page }, index: number) => {
  const before = allWidgets(await readDashboardSetting(page)).length;

  memory(page).shownViewIds[index] = (await persistedWidgetAt(page, index)).view_id;
  await chooseWidgetMenuEntryAt(page, index, 'delete');
  await expect.poll(async () => allWidgets(await readDashboardSetting(page)).length, WIDGET_TIMEOUT).toBe(before - 1);
});

When('the user undoes the last dashboard change', async ({ page }) => {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

  await DashboardSelectors.view(page).dispatchEvent('pointerdown', { bubbles: true });
  await page.keyboard.press(`${modifier}+z`);
});

When('the user clicks Done', async ({ page }) => {
  await leaveEditMode(page);
});

When(
  'the user renames widget {int} to {string} in its view settings',
  async ({ page }, index: number, name: string) => {
    const widget = widgetAtIndex(page, index);
    const tool = widget.getByTestId('dashboard-widget-settings-button');

    await widget.hover();
    await expect(tool).toBeVisible(WIDGET_TIMEOUT);
    if ((await tool.getAttribute('data-state')) !== 'open') await tool.click();
    const input = page.getByTestId('dashboard-widget-view-name-input');

    await expect(input).toBeVisible(WIDGET_TIMEOUT);
    await input.fill(name);
    await input.press('Enter');
    await page.keyboard.press('Escape');
  }
);

When('the user opens the data source of widget {int}', async ({ page }, index: number) => {
  const viewId = (await persistedWidgetAt(page, index)).view_id;

  memory(page).shownViewIds[index] = viewId;
  await chooseWidgetMenuEntryAt(page, index, 'view-data-source');
  await expect(DatabaseViewSelectors.viewTab(page, viewId)).toHaveAttribute('data-state', 'active', {
    timeout: WIDGET_TIMEOUT_MS,
  });
});

When('the user duplicates the dashboard tab', async ({ page }) => {
  const known = (await readDatabaseViews(page, hostDatabase(page).databaseId)).map((view) => view.id);
  const tab = DatabaseViewSelectors.viewTab(page, dashboardViewId(page));

  await tab.click({ button: 'right' });
  await expect(DatabaseViewSelectors.tabActionDuplicate(page)).toBeVisible(WIDGET_TIMEOUT);
  await DatabaseViewSelectors.tabActionDuplicate(page).click({ force: true });
  memory(page).copiedDashboardViewId = await newDashboardViewId(page, known);
});

Given(
  'another dashboard of {string} owns a {string} view',
  async ({ page, request }, database: string, layout: string) => {
    const otherDashboard = await createDatabaseViewThroughApi(page, request, {
      database,
      name: 'Other dashboard',
      folderLayout: 11,
    });
    const owned = await createDatabaseViewThroughApi(page, request, {
      database,
      name: layout,
      folderLayout: layout === 'Calendar' ? 3 : 1,
    });

    // The collab mirror of the owner marker: every reader of the picker sees it at once.
    await page.evaluate(
      ({ databaseId, viewId, owner }) => {
        const bridge = (window as any).__DASHBOARD_TEST__;
        const doc = bridge.byDatabase(databaseId).databaseDoc;
        const view = doc.getMap('data').get('database').get('views').get(viewId);

        doc.transact(() => view.set('dashboard_owner', owner));
      },
      { databaseId: fixtureDatabase(page, database).databaseId, viewId: owned, owner: otherDashboard }
    );
    memory(page).otherDashboardViewId = otherDashboard;
    dashboardWorld(page).viewsByName = {
      ...(dashboardWorld(page).viewsByName ?? {}),
      [`other dashboard ${layout}`]: { viewId: owned, database },
    };
    await openDashboard(page);
    // The reopened dashboard has a widget, so it opens in View mode: the scenario stays in Edit mode.
    await expect(DashboardSelectors.view(page)).toBeVisible(WIDGET_TIMEOUT);
    await enterEditMode(page);
  }
);

Given(
  'a document with a linked dashboard of {string} showing the {string} view and a new {string} view',
  async ({ page, request }, database: string, layout: string, newLayout: string) => {
    await prepareDashboardFixture(page, request, [database]);
    const fixture = fixtureDatabase(page, database);
    const known = (await readDatabaseViews(page, fixture.databaseId)).map((view) => view.id);
    const documentId = await createDocumentPageAndNavigate(page);

    await insertLinkedDatabaseViaSlash(page, documentId, database, 'Dashboard');
    const block = page.locator(`#editor-${documentId} [data-block-type="dashboard"]`);

    await expect(block.getByTestId('dashboard-view')).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
    const world = dashboardWorld(page);

    world.dashboardHost = database;
    world.dashboardViewId = await newDashboardViewId(page, known);
    memory(page).documentViewId = documentId;
    await expectDashboardMode(page, 'Edit');
    await openWidgetPicker(page);
    await pickExistingView(page, fixture.views[layout]);
    await createWidgetViewThroughPicker(page, newLayout, database);
  }
);

When('the user duplicates the dashboard block', async ({ page }) => {
  const documentId = memory(page).documentViewId;

  if (!documentId) throw new Error('No document was set up in this scenario');
  const known = (await readDatabaseViews(page, hostDatabase(page).databaseId)).map((view) => view.id);
  const block = page.locator(`#editor-${documentId} [data-block-type="dashboard"]`).first();

  await expect
    .poll(
      async () => {
        const box = await block.boundingBox();

        if (box) await page.mouse.move(box.x + 24, box.y + 16);
        return BlockSelectors.dragHandle(page).isVisible();
      },
      WIDGET_TIMEOUT
    )
    .toBe(true);
  await BlockSelectors.dragHandle(page).click({ force: true });
  await expect(BlockSelectors.controlsMenu(page)).toBeVisible(WIDGET_TIMEOUT);
  await BlockSelectors.controlsMenuAction(page, 'duplicate').click({ force: true });
  await expect(page.locator(`#editor-${documentId} [data-block-type="dashboard"]`)).toHaveCount(2, WIDGET_TIMEOUT);
  memory(page).copiedDashboardViewId = await newDashboardViewId(page, known);
});

// Checks ---------------------------------------------------------------------

Then('the view of widget {int} does not belong to the dashboard', async ({ page, request }, index: number) => {
  const { view_id: viewId, database_id: databaseId } = await persistedWidgetAt(page, index);

  expect((await readOwnedViewMarkers(page, databaseId))[viewId]).toBeNull();
  expect((await readFolderViewExtra(page, request, viewId)).dashboard_owner).toBeUndefined();
});

Then(
  'the {string} tab bar does not show the view of widget {int}',
  async ({ page }, _database: string, index: number) => {
    const viewId = (await persistedWidgetAt(page, index)).view_id;

    await expect(DatabaseViewSelectors.viewTab(page, viewId)).toHaveCount(0, WIDGET_TIMEOUT);
    expect(await tabBarViewIds(page)).not.toContain(viewId);
  }
);

Then('the {string} tab bar shows the dashboard tab as active', async ({ page }, _database: string) => {
  await expect(DatabaseViewSelectors.viewTab(page, dashboardViewId(page))).toHaveAttribute('data-state', 'active');
});

Then('the {string} tab bar shows the {string} view', async ({ page }, database: string, layout: string) => {
  const viewId = fixtureDatabase(page, database).views[layout];
  const tab = DatabaseViewSelectors.viewTab(page, viewId);

  if (!(await tab.isVisible())) await openDatabasePage(page, database);
  await expect(DatabaseViewSelectors.viewTab(page, viewId)).toBeVisible(WIDGET_TIMEOUT);
});

Then('widget {int} shows a different view than widget {int}', async ({ page }, index: number, other: number) => {
  const [widget, otherWidget] = await Promise.all([persistedWidgetAt(page, index), persistedWidgetAt(page, other)]);

  expect(widget.view_id).not.toBe(otherWidget.view_id);
  await expect(widgetAtIndex(page, index)).toHaveAttribute('data-view-id', widget.view_id);
});

Then(
  'widget {int} has the same filters, sorts and settings as widget {int}',
  async ({ page }, index: number, other: number) => {
    const [widget, otherWidget] = await Promise.all([persistedWidgetAt(page, index), persistedWidgetAt(page, other)]);

    await expect
      .poll(() => readViewConfiguration(page, widget.database_id, widget.view_id), WIDGET_TIMEOUT)
      .toEqual(await readViewConfiguration(page, otherWidget.database_id, otherWidget.view_id));
  }
);

Then('the copied view no longer exists in {string}', async ({ page }, database: string) => {
  const viewId = memory(page).copiedViewId;

  if (!viewId) throw new Error('No widget was duplicated in this scenario');
  await expectViewGone(page, fixtureDatabase(page, database).databaseId, viewId);
});

Then('the {string} database has no new views', async ({ page }, database: string) => {
  const before = memory(page).viewIdsBefore;

  if (!before) throw new Error('Nothing was tried in this scenario');
  expect(await hostViewIdList(page, database)).toEqual(before);
});

Then(
  'the view that widget {int} showed still exists in {string}',
  async ({ page, request }, index: number, database: string) => {
    const viewId = memory(page).shownViewIds[index];

    expect((await readDatabaseViews(page, fixtureDatabase(page, database).databaseId)).some((view) => view.id === viewId)).toBe(
      true
    );
    expect(await folderViewExists(page, request, viewId)).toBe(true);
  }
);

Then(
  'the view that widget {int} showed no longer exists in {string}',
  async ({ page }, index: number, database: string) => {
    await expectViewGone(page, fixtureDatabase(page, database).databaseId, memory(page).shownViewIds[index]);
  }
);

Then('the view of widget {int} is named {string}', async ({ page, request }, index: number, name: string) => {
  const { view_id: viewId, database_id: databaseId } = await persistedWidgetAt(page, index);

  await expect
    .poll(async () => (await readDatabaseViews(page, databaseId)).find((view) => view.id === viewId)?.name, WIDGET_TIMEOUT)
    .toBe(name);
  await expect.poll(() => readFolderViewName(page, request, viewId), WIDGET_TIMEOUT).toBe(name);
});

Then('the dashboard layout stores no widget title', async ({ page }) => {
  const keys = await page.evaluate(
    ({ databaseId, viewId }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const view = bridge.byDatabase(databaseId).databaseDoc.getMap('data').get('database').get('views').get(viewId);
      const rows = bridge.plain(view.get('layout_settings').get('9').get('rows')) as { widgets: Record<string, unknown>[] }[];

      return rows.flatMap((row) => row.widgets.flatMap((widget) => Object.keys(widget)));
    },
    { databaseId: hostDatabase(page).databaseId, viewId: dashboardViewId(page) }
  );

  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((key) => !['id', 'view_id', 'database_id', 'width'].includes(key))).toEqual([]);
});

Then('the widget picker lists the view of widget {int}', async ({ page }, index: number) => {
  const viewId = (await persistedWidgetAt(page, index)).view_id;

  await expect(
    DashboardSelectors.pickerSection(page, 'host').locator(`[data-testid="dashboard-widget-picker-option"][data-view-id="${viewId}"]`)
  ).toBeVisible(WIDGET_TIMEOUT);
});

Then('the widget picker does not list views that belong to another dashboard', async ({ page }) => {
  const owned = Object.entries(dashboardWorld(page).viewsByName ?? {})
    .filter(([name]) => name.startsWith('other dashboard '))
    .map(([, view]) => view.viewId);

  expect(owned.length).toBeGreaterThan(0);
  for (const viewId of owned) await expect(DashboardSelectors.pickerOption(page, viewId)).toHaveCount(0);
  // Nor in a search.
  await DashboardSelectors.pickerSearch(page).fill('Calendar');
  for (const viewId of owned) await expect(DashboardSelectors.pickerOption(page, viewId)).toHaveCount(0);
});

Then('the tab bar shows only the view of widget {int}', async ({ page }, index: number) => {
  const viewId = memory(page).shownViewIds[index];

  await expect.poll(() => tabBarViewIds(page), WIDGET_TIMEOUT).toEqual([viewId]);
});

Then('the copied dashboard has {int} widgets', async ({ page }, count: number) => {
  await expect
    .poll(async () => allWidgets(await readDashboardSetting(page, copiedDashboardViewId(page))).length, WIDGET_TIMEOUT)
    .toBe(count);
});

Then(
  'widget {int} of the copied dashboard shows the {string} view of {string}',
  async ({ page }, index: number, layout: string, database: string) => {
    const widgets = allWidgets(await readDashboardSetting(page, copiedDashboardViewId(page)));

    expect(widgets[index - 1]?.view_id).toBe(fixtureDatabase(page, database).views[layout]);
  }
);

Then(
  'widget {int} of the copied dashboard shows a view that belongs to the copied dashboard',
  async ({ page }, index: number) => {
    const copy = copiedDashboardViewId(page);
    const original = allWidgets(await readDashboardSetting(page))[index - 1];
    let widget = original;

    // The copies of owned views are made after the tab copy (WP05 §1.7), then the copy's layout is remapped.
    await expect
      .poll(
        async () => {
          widget = allWidgets(await readDashboardSetting(page, copy))[index - 1] ?? original;
          return widget.view_id;
        },
        { ...WIDGET_TIMEOUT, message: 'waiting for the copied dashboard to show its own copy of the view' }
      )
      .not.toBe(original.view_id);
    await expect.poll(async () => (await readOwnedViewMarkers(page, widget.database_id))[widget.view_id], WIDGET_TIMEOUT).toBe(copy);
  }
);

Then('widget {int} of the copied dashboard is titled {string}', async ({ page }, index: number, title: string) => {
  const widget = allWidgets(await readDashboardSetting(page, copiedDashboardViewId(page)))[index - 1];

  await expect
    .poll(async () => (await readDatabaseViews(page, widget.database_id)).find((view) => view.id === widget.view_id)?.name, WIDGET_TIMEOUT)
    .toBe(title);
});

Then('the copied dashboard block has {int} widgets', async ({ page }, count: number) => {
  await expect
    .poll(async () => allWidgets(await readDashboardSetting(page, copiedDashboardViewId(page))).length, WIDGET_TIMEOUT)
    .toBe(count);
});

/** The copied block's widget showing a view named `label` in the original block, by position. */
async function copiedBlockWidget(page: Page, label: string) {
  const original = allWidgets(await readDashboardSetting(page));
  const views = await readDatabaseViews(page, hostDatabase(page).databaseId);
  const index = original.findIndex((widget) => views.find((view) => view.id === widget.view_id)?.name === label);

  expect(index, `the original block shows a "${label}" widget`).toBeGreaterThanOrEqual(0);
  return { copy: allWidgets(await readDashboardSetting(page, copiedDashboardViewId(page)))[index], original: original[index] };
}

Then(
  "the copied block's {string} widget shows the {string} view of {string}",
  async ({ page }, label: string, layout: string, database: string) => {
    const { copy } = await copiedBlockWidget(page, label);

    expect(copy?.view_id).toBe(fixtureDatabase(page, database).views[layout]);
  }
);

Then(
  "the copied block's {string} widget shows a view that belongs to the copied dashboard",
  async ({ page }, label: string) => {
    let { copy, original } = await copiedBlockWidget(page, label);

    // The copies of owned views are made after the block's dashboard copy, then its layout is remapped.
    await expect
      .poll(
        async () => {
          ({ copy, original } = await copiedBlockWidget(page, label));
          return copy?.view_id;
        },
        { ...WIDGET_TIMEOUT, message: 'waiting for the copied block to show its own copy of the view' }
      )
      .not.toBe(original.view_id);
    await expect
      .poll(async () => (await readOwnedViewMarkers(page, copy.database_id))[copy.view_id], WIDGET_TIMEOUT)
      .toBe(copiedDashboardViewId(page));
  }
);

// Database-page copies remap owned views while keeping external widget sources.

Given('a {string} database with a {string} view', async ({ page, request }, database: string, layout: string) => {
  await addFixtureDatabase(page, request, database);
  if (!fixtureDatabase(page, database).views[layout]) await addViewThroughTabs(page, database, layout);
  await openDashboard(page);
});

When('the user duplicates the {string} database page from the sidebar', async ({ page, request }, database: string) => {
  memory(page).databaseCopy = await duplicateDatabaseDashboardFromSidebar(page, request, database);
});

function databaseCopy(page: Page): CopiedDatabaseDashboard {
  const copy = memory(page).databaseCopy;

  if (!copy) throw new Error('No database page has been copied in this scenario');
  return copy;
}

Then(
  "the copied dashboard's {string} widget shows a view of the copied database",
  async ({ page, request }, name: string) => {
    const copy = databaseCopy(page);
    const { original, widget } = await copiedDatabaseWidget(page, request, copy, name);

    expect(original.database_id).toBe(copy.originalDatabaseId);
    expect(widget.database_id).toBe(copy.databaseId);
    expect(widget.view_id).not.toBe(original.view_id);
    await expect(DashboardSelectors.widgetsForView(page, widget.view_id)).toBeVisible(WIDGET_TIMEOUT);
    await expect
      .poll(async () => (await readDatabaseViews(page, copy.databaseId)).find((view) => view.id === widget.view_id)?.dashboardOwner, WIDGET_TIMEOUT)
      .toBe(copy.dashboardViewId);
    expect((await readFolderViewExtra(page, request, widget.view_id)).dashboard_owner).toBe(copy.dashboardViewId);
  }
);

Then(
  "the copied dashboard's {string} widget still shows the {string} view of {string}",
  async ({ page, request }, name: string, layout: string, database: string) => {
    const { original, widget } = await copiedDatabaseWidget(page, request, databaseCopy(page), name);
    const source = fixtureDatabase(page, database);

    expect(widget.view_id).toBe(source.views[layout]);
    expect(widget.database_id).toBe(source.databaseId);
    expect(widget.view_id).toBe(original.view_id);
    expect(widget.database_id).toBe(original.database_id);
    await expect(DashboardSelectors.widgetsForView(page, widget.view_id)).toBeVisible(WIDGET_TIMEOUT);
  }
);

Then('the copied {string} view is not a tab of the copied database', async ({ page, request }, name: string) => {
  const copy = databaseCopy(page);
  const { widget } = await copiedDatabaseWidget(page, request, copy, name);
  const tabs = await tabBarViewIds(page);

  expect(tabs).toContain(copy.dashboardViewId);
  expect(tabs).not.toContain(widget.view_id);
  expect((await readFolderViewExtra(page, request, widget.view_id)).dashboard_owner).toBe(copy.dashboardViewId);
});
