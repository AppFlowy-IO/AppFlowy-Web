/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { fileURLToPath } from 'url';

import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import protobuf from 'protobufjs';
import { stringify as uuidStringify } from 'uuid';
import * as Y from 'yjs';

import { ViewLayout } from '../../../src/application/types';
import { readOpenDatabase } from '../../support/dashboard-loading-helpers';
import {
  apiGet,
  apiPost,
  browserAccessToken,
  clearCachedDatabaseStorage,
  readServerDatabaseDoc,
} from '../../support/dashboard-shared-helpers';
import {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_LAYOUT_KEY,
  DashboardSelectors,
  DatabaseViewLayout,
  gridDataRows,
  installDashboardTestBridge,
  readDatabaseViews,
} from '../../support/dashboard-test-helpers';
import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { EMPLOYEE_FIELDS, employeeRecords, loadEmployeesFixture, seededEmployeesDatabase } from '../../support/employees-database';
import { DatabaseViewSelectors } from '../../support/selectors';
import { grantWorkspaceProSubscription, mockProSubscription } from '../../support/subscription-test-helpers';

const { Given, When, Then } = createBdd();

/** Every blob diff page of the employees database after the first arrives this much later. */
const SLOW_PAGE_DELAY_MS = 1500;
/** How soon after the widget shows its grid the first HR employees must be listed. */
const FIRST_ROWS_WITHIN_MS = 5000;
const LOAD_TIMEOUT_MS = 180000;
const SAMPLES_KEY = '__LARGE_SOURCE_WIDGET_SAMPLES__';

interface OpenDatabase {
  workspaceId: string;
  pageId: string;
  databaseId: string;
  activeViewId: string;
}

interface LargeSourceScenario {
  employees: OpenDatabase & {
    hrViewId: string;
    /** The HR view's rows that work in HR, in the view's order. */
    hrRowIds: string[];
  };
  team?: OpenDatabase & { dashboardViewId: string };
  /** "Has no saved result": the next open starts with empty browser storage. */
  noSavedResult?: boolean;
  /** Page clock from which the widget samples belong to the visit under test. */
  samplesFrom?: number;
  /** Page clock by which the HR widget had to stop showing its loading row. */
  noLoadingRowFrom?: number;
}

/** One look at the HR widget, taken every 100 ms by the page. */
interface WidgetSample {
  /** Milliseconds since the page started loading. */
  t: number;
  rowIds: string[];
  loading: boolean;
  hydrating: boolean;
  rowCount: string | null;
}

const scenarios = new WeakMap<Page, LargeSourceScenario>();

function currentScenario(page: Page): LargeSourceScenario {
  const scenario = scenarios.get(page);

  if (!scenario) throw new Error('The employees HR view has not been prepared in this scenario');
  return scenario;
}

function currentTeam(page: Page) {
  const { team } = currentScenario(page);

  if (!team) throw new Error('The Team dashboard has not been prepared in this scenario');
  return team;
}

function departmentOptionId(name: string): string {
  const field = loadEmployeesFixture().fields.find((candidate) => candidate.id === EMPLOYEE_FIELDS.Department);
  const content = JSON.parse(String(field?.type_options['3']?.content ?? '{}')) as {
    options?: { id: string; name: string }[];
  };
  const option = content.options?.find((candidate) => candidate.name === name);

  if (!option) throw new Error(`The employees fixture has no "${name}" department`);
  return option.id;
}

/** Views of a database the app has open: id, layout and row order. */
async function readViews(page: Page, databaseId: string) {
  return readDatabaseViews(page, databaseId, { rowIds: true });
}

/** Adds a grid view through the tab bar "+" menu of the open database and returns its id. */
async function addGridViewThroughTabs(page: Page, databaseId: string) {
  const before = new Set((await readViews(page, databaseId)).map((view) => view.id));

  await DatabaseViewSelectors.addViewButton(page).click();
  await DatabaseViewSelectors.viewTypeOption(page, 'Grid').first().click();
  let viewId = '';

  await expect
    .poll(
      async () => {
        viewId =
          (await readViews(page, databaseId)).find(
            (view) => !before.has(view.id) && !view.inline && view.layout === DatabaseViewLayout.Grid
          )?.id ?? '';
        return viewId;
      },
      { timeout: 60000, message: 'waiting for the new grid view' }
    )
    .not.toBe('');
  await expect(DatabaseViewSelectors.viewTab(page, viewId)).toHaveAttribute('data-state', 'active', {
    timeout: 60000,
  });
  return viewId;
}

/** A Cloud API call made with the signed-in browser's token. */
async function cloudApi<T>(page: Page, path: string, data?: unknown): Promise<T> {
  const token = await browserAccessToken(page);

  return data === undefined ? apiGet<T>(page.request, token, path) : apiPost<T>(page.request, token, path, data);
}

/**
 * Creates a Dashboard view of an open database through the Cloud API, the way
 * the web's tab bar does, and returns its id. (The web's own creation menu is
 * behind EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED.)
 */
async function createDashboardView(page: Page, database: OpenDatabase) {
  type FolderView = { parent_view_id?: string; extra?: unknown };
  const isContainer = (view: FolderView) => {
    const extra = typeof view.extra === 'string' ? JSON.parse(view.extra || '{}') : view.extra;

    return Boolean((extra as { is_database_container?: boolean } | undefined)?.is_database_container);
  };

  const base = `/api/workspace/${database.workspaceId}`;
  const view = await cloudApi<FolderView>(page, `${base}/view/${database.activeViewId}?depth=0`);
  const parentId = view.parent_view_id;
  // New views of a database live under its container, when it has one.
  const containerId =
    parentId && isContainer(await cloudApi<FolderView>(page, `${base}/view/${parentId}?depth=0`))
      ? parentId
      : database.activeViewId;

  // Hosted servers (CI) apply the Pro policy to Dashboard views.
  grantWorkspaceProSubscription(database.workspaceId);
  const created = await cloudApi<{ view_id: string; database_update?: number[] }>(
    page,
    `${base}/page-view/${containerId}/database-view`,
    {
      parent_view_id: containerId,
      database_id: database.databaseId,
      layout: ViewLayout.Dashboard,
      name: 'Dashboard',
      embedded: false,
    }
  );

  // Like the web, apply the returned database update right away.
  if (created.database_update?.length) {
    await page.evaluate(
      ({ databaseId, update }) => {
        const win = window as any;
        const doc = win.__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;

        win.Y.transact(doc, () => win.Y.applyUpdate(doc, new Uint8Array(update), 'remote'), 'remote');
      },
      { databaseId: database.databaseId, update: created.database_update }
    );
  }

  await expect
    .poll(async () => (await readViews(page, database.databaseId)).some((known) => known.id === created.view_id), {
      timeout: 60000,
      message: 'waiting for the dashboard view to reach the browser',
    })
    .toBe(true);
  return created.view_id;
}

/** Row ids in the order the blob diff pages delivered them. */
function rowIdsInDeliveryOrder(pages: Buffer[]): string[] {
  // The protocol's schema, read at run time: the generated module is built for the app bundler.
  const schema = fileURLToPath(new URL('../../../src/proto/database_blob.proto', import.meta.url));
  const DiffResponse = protobuf.loadSync(schema).lookupType('database_blob.DatabaseBlobDiffResponse');
  const rowIds = new Set<string>();

  pages.forEach((body) => {
    const page = DiffResponse.decode(new Uint8Array(body)) as unknown as {
      creates: { rowId?: Uint8Array }[];
      updates: { rowId?: Uint8Array }[];
    };

    [...page.creates, ...page.updates].forEach((update) => {
      if (update.rowId?.length === 16) rowIds.add(uuidStringify(update.rowId));
    });
  });
  return Array.from(rowIds);
}

/** The server's copy of a view of a database (`read` gets the view map). */
async function readServerView<T>(page: Page, database: OpenDatabase, viewId: string, read: (view?: Y.Map<unknown>) => T) {
  const access = { token: await browserAccessToken(page), workspaceId: database.workspaceId };

  return readServerDatabaseDoc(page.request, access, database.databaseId, (yDatabase) =>
    read((yDatabase?.get('views') as Y.Map<Y.Map<unknown>> | undefined)?.get(viewId))
  );
}

/** Row ids of a view in the server's copy of a database. */
async function readServerRowOrder(page: Page, database: OpenDatabase, viewId: string): Promise<string[]> {
  return readServerView(page, database, viewId, (view) =>
    ((view?.get('row_orders') as Y.Array<{ id: string }> | undefined)?.toJSON() ?? []).map(
      (row: { id: string }) => row.id
    )
  );
}

/**
 * Lists the HR view's rows in the order the server delivers them, as in a
 * database imported in one go, so its first rows arrive with the first page.
 * Rows created through the web get random ids and arrive in any order, and
 * the widget only shows matches from the first row on, so rows never move.
 */
async function listHrViewInDeliveryOrder(
  page: Page,
  employees: LargeSourceScenario['employees'],
  deliveryOrder: string[]
) {
  const rowOrder = await page.evaluate(
    ({ databaseId, viewId, deliveryOrder }) => {
      const doc = (window as any).__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
      const rowOrders = doc.getMap('data').get('database').get('views').get(viewId).get('row_orders');
      const rows: { id: string; height?: number }[] = rowOrders.toJSON();
      const position = new Map(deliveryOrder.map((rowId, index) => [rowId, index]));
      const reordered = [...rows].sort(
        (left, right) =>
          (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      );

      doc.transact(() => {
        rowOrders.delete(0, rowOrders.length);
        rowOrders.push(reordered);
      });
      return reordered.map((row) => row.id);
    },
    { databaseId: employees.databaseId, viewId: employees.hrViewId, deliveryOrder }
  );

  await expect
    .poll(async () => (await readServerRowOrder(page, employees, employees.hrViewId)).join(','), {
      timeout: 60000,
      message: 'waiting for the HR view row order to reach the server',
    })
    .toBe(rowOrder.join(','));
  const hrRows = new Set(employees.hrRowIds);

  employees.hrRowIds = rowOrder.filter((rowId) => hrRows.has(rowId));
}

async function openDashboard(page: Page, team: { workspaceId: string; dashboardViewId: string }) {
  await page.goto(new URL(`/app/${team.workspaceId}/${team.dashboardViewId}`, page.url()).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: 60000 });
}

function hrWidget(page: Page): Locator {
  return DashboardSelectors.widgetsForView(page, currentScenario(page).employees.hrViewId);
}

async function readSamples(page: Page): Promise<WidgetSample[]> {
  return page.evaluate((key) => ((window as any)[key] ?? []) as WidgetSample[], SAMPLES_KEY);
}

Given(
  'the employees database has a grid view filtered to the {string} department',
  async ({ page }, department: string) => {
    const employees = await readOpenDatabase(page);
    const optionId = departmentOptionId(department);
    const fixtureRows = loadEmployeesFixture().rows;
    const departmentIndex = loadEmployeesFixture().fields.findIndex((field) => field.id === EMPLOYEE_FIELDS.Department);
    // Seeded rows follow the fixture order in the grid the suite seeded.
    const seededRowIds = (await readViews(page, employees.databaseId)).find(
      (view) => view.id === employees.activeViewId
    )?.rowIds;

    if (!seededRowIds?.length) throw new Error('The employees grid lists no rows');
    const departmentByRowId = new Map(
      seededRowIds.map((rowId, index) => [rowId, fixtureRows[index]?.[departmentIndex]?.data])
    );
    const hrViewId = await addGridViewThroughTabs(page, employees.databaseId);

    await page.evaluate(
      ({ viewId, fieldId, content }) => {
        const win = window as any;
        const Y = win.Y;
        const doc = win.__TEST_DATABASE_CONTEXT__.databaseDoc;
        const view = doc.getMap('data').get('database').get('views').get(viewId);

        doc.transact(() => {
          let filters = view.get('filters');

          if (!filters) {
            filters = new Y.Array();
            view.set('filters', filters);
          }

          const filter = new Y.Map();

          filter.set('id', `large-source-${viewId}`);
          filter.set('field_id', fieldId);
          // Single select, a data filter, "is".
          filter.set('ty', 3);
          filter.set('filter_type', 2);
          filter.set('condition', 0);
          filter.set('content', content);
          filters.delete(0, filters.length);
          filters.push([filter]);
        });
      },
      { viewId: hrViewId, fieldId: EMPLOYEE_FIELDS.Department, content: optionId }
    );

    let hrViewRowIds: string[] = [];

    // The new view lists every employee once its row order has synced.
    await expect
      .poll(
        async () => {
          hrViewRowIds =
            (await readViews(page, employees.databaseId)).find((view) => view.id === hrViewId)?.rowIds ?? [];
          return hrViewRowIds.length;
        },
        { timeout: 60000, message: 'waiting for the HR view to list every employee' }
      )
      .toBe(seededRowIds.length);
    const hrRowIds = hrViewRowIds.filter((rowId) => departmentByRowId.get(rowId) === optionId);

    expect(hrRowIds.length).toBeGreaterThan(0);
    // The source view itself lists exactly the department.
    await expect(DatabaseViewSelectors.gridView(page)).toHaveAttribute('data-row-count', String(hrRowIds.length), {
      timeout: LOAD_TIMEOUT_MS,
    });
    scenarios.set(page, { employees: { ...employees, hrViewId, hrRowIds } });
  }
);

Given('a new database has a dashboard showing its own grid and the employees HR view', async ({ page }) => {
  const current = currentScenario(page);

  // Widgets mount their own databases; the bridge keeps every database context reachable.
  await installDashboardTestBridge(page.context());
  await mockProSubscription(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGridReady(page);
  await createDatabaseView(page, 'Grid');
  await waitForGridReady(page);

  let team: OpenDatabase | undefined;

  await expect
    .poll(
      async () => {
        team = await readOpenDatabase(page).catch(() => undefined);
        return Boolean(team && team.databaseId !== current.employees.databaseId && team.pageId);
      },
      { timeout: 60000, message: 'waiting for the new database to open' }
    )
    .toBe(true);
  const host = team as OpenDatabase;
  const dashboardViewId = await createDashboardView(page, host);
  const width = DASHBOARD_GRID_COLUMNS / 2;

  const rows = [
    {
      id: 'large-source-row',
      height: DASHBOARD_DEFAULT_ROW_HEIGHT,
      widgets: [
        { id: 'team-grid', view_id: host.activeViewId, database_id: host.databaseId, width },
        {
          id: 'employees-hr',
          view_id: current.employees.hrViewId,
          database_id: current.employees.databaseId,
          width: DASHBOARD_GRID_COLUMNS - width,
        },
      ],
    },
  ];

  // The widget's first load walks every row of the employees database; record its pages.
  const blobPages: Buffer[] = [];
  const blobDiffUrl = `**/api/workspace/*/database/${current.employees.databaseId}/blob/diff`;
  const recordBlobPage = async (route: Route) => {
    const response = await route.fetch().catch(() => null);

    if (!response) {
      await route.abort().catch(() => undefined);
      return;
    }

    blobPages.push(await response.body());
    await route.fulfill({ response }).catch(() => undefined);
  };

  await page.route(blobDiffUrl, recordBlobPage);
  await openDashboard(page, { workspaceId: host.workspaceId, dashboardViewId });
  // Written again if a reload (the test bridge recovers from failed chunk loads) raced the first write.
  await expect
    .poll(
      async () => {
        await page
          .evaluate(
            ({ viewId, layoutKey, rows }) => {
              const win = window as any;
              const doc = win.__DASHBOARD_TEST__?.byView(viewId)?.databaseDoc;

              if (!doc) return;
              const Y = win.Y;
              const view = doc.getMap('data').get('database').get('views').get(viewId);

              if (view.get('layout_settings')?.get(layoutKey)?.get('rows')) return;
              doc.transact(() => {
                let layouts = view.get('layout_settings');

                if (!layouts) {
                  layouts = new Y.Map();
                  view.set('layout_settings', layouts);
                }

                let setting = layouts.get(layoutKey);

                if (!setting) {
                  setting = new Y.Map();
                  layouts.set(layoutKey, setting);
                }

                setting.set('rows', rows);
              });
            },
            { viewId: dashboardViewId, layoutKey: String(DASHBOARD_LAYOUT_KEY), rows }
          )
          .catch(() => undefined);
        return DashboardSelectors.widgets(page).count();
      },
      { timeout: 60000, message: 'waiting for the dashboard to show both widgets' }
    )
    .toBe(2);
  await expect(hrWidget(page).getByTestId('database-grid')).toHaveAttribute(
    'data-row-count',
    String(current.employees.hrRowIds.length),
    { timeout: LOAD_TIMEOUT_MS }
  );
  await page.unroute(blobDiffUrl, recordBlobPage);
  const deliveryOrder = rowIdsInDeliveryOrder(blobPages);

  expect(deliveryOrder.length, 'the widget loaded every employee through the blob diff').toBeGreaterThanOrEqual(
    current.employees.hrRowIds.length
  );
  await listHrViewInDeliveryOrder(page, current.employees, deliveryOrder);
  current.team = { ...host, dashboardViewId };
});

/** Record the HR widget every 100 ms from the first frame of the next page load. */
async function recordHrWidget(page: Page) {
  await page.addInitScript(
    ({ viewId, key }) => {
      const samples: unknown[] = [];

      (window as any)[key] = samples;
      window.setInterval(() => {
        const widget = document.querySelector(`[data-testid="dashboard-widget"][data-view-id="${viewId}"]`);
        const grid = widget?.querySelector('[data-testid="database-grid"]');

        if (!widget || !grid) return;
        samples.push({
          t: Math.round(performance.now()),
          rowIds: Array.from(widget.querySelectorAll('[data-testid^="grid-row-"]'))
            .map((row) => (row.getAttribute('data-testid') ?? '').slice('grid-row-'.length))
            .filter((rowId) => rowId && rowId !== 'undefined'),
          loading: Boolean(widget.querySelector('[data-testid="grid-loading-indicator"]')),
          hydrating: grid.getAttribute('data-hydrating') === 'true',
          rowCount: grid.getAttribute('data-row-count'),
        });
      }, 100);
    },
    { viewId: currentScenario(page).employees.hrViewId, key: SAMPLES_KEY }
  );
}

/**
 * Open the Team dashboard in a new document, recording the HR widget; after
 * "has no saved result" the browser storage is empty first (the web's
 * counterpart of a fresh desktop session without the view's saved result).
 */
async function openTeamDashboard(page: Page, beforeOpen?: () => Promise<void>) {
  const scenario = currentScenario(page);

  if (scenario.noSavedResult) await clearCachedDatabaseStorage(page);
  await beforeOpen?.();
  await recordHrWidget(page);
  scenario.samplesFrom = 0;
  // A full page load: nothing of the earlier visit stays in memory.
  await openDashboard(page, currentTeam(page));
}

When(
  'I open that dashboard while the employees database loads slowly',
  { tags: 'not @dashboard-loading' },
  async ({ page }) => {
    const { employees } = currentScenario(page);
    let pages = 0;

    await page.route(`**/api/workspace/*/database/${employees.databaseId}/blob/diff`, async (route) => {
      const response = await route.fetch().catch(() => null);

      if (!response) {
        await route.abort().catch(() => undefined);
        return;
      }

      pages += 1;
      if (pages > 1) await new Promise((resolve) => setTimeout(resolve, SLOW_PAGE_DELAY_MS));
      await route.fulfill({ response }).catch(() => undefined);
    });
    await openTeamDashboard(page);
  }
);

Given('the employees HR view has no saved result', async ({ page }) => {
  const scenario = currentScenario(page);

  // Empty now, and again right before the dashboard opens (a step in between may read the view).
  scenario.noSavedResult = true;
  await clearCachedDatabaseStorage(page);
  await openDashboard(page, currentTeam(page));
});

Given('the employees HR view is sorted by Name', async ({ page }) => {
  const { employees } = currentScenario(page);
  const sortId = `large-source-sort-${employees.hrViewId}`;

  await expect(hrWidget(page).getByTestId('database-grid')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await page.evaluate(
    ({ databaseId, viewId, fieldId, sortId }) => {
      const win = window as any;
      const doc = win.__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
      const view = doc.getMap('data').get('database').get('views').get(viewId);

      doc.transact(() => {
        let sorts = view.get('sorts');

        if (!sorts) {
          sorts = new win.Y.Array();
          view.set('sorts', sorts);
        }

        const sort = new win.Y.Map();

        sort.set('id', sortId);
        sort.set('field_id', fieldId);
        // `SortCondition.Ascending`.
        sort.set('condition', 0);
        sorts.delete(0, sorts.length);
        sorts.push([sort]);
      });
    },
    { databaseId: employees.databaseId, viewId: employees.hrViewId, fieldId: EMPLOYEE_FIELDS.Name, sortId }
  );
  await expect
    .poll(
      () =>
        readServerView(page, employees, employees.hrViewId, (view) =>
          ((view?.get('sorts') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []).map((sort) => sort.get('id'))
        ),
      { timeout: 60000, message: 'waiting for the HR view sort to reach the server' }
    )
    .toEqual([sortId]);

  // The app sorts text with this collator and keeps the view's order for equal names.
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true, usage: 'sort' });
  const records = employeeRecords();
  const nameByRowId = new Map(
    seededEmployeesDatabase().rowIds.map((rowId, index) => [rowId, records[index]?.Name.data ?? ''])
  );

  employees.hrRowIds = [...employees.hrRowIds].sort((left, right) =>
    collator.compare(nameByRowId.get(left) ?? '', nameByRowId.get(right) ?? '')
  );
});

When('I open that dashboard', async ({ page }) => {
  await openTeamDashboard(page);
});

When('I open that dashboard while the employees HR view is open in another tab', async ({ page }) => {
  const { employees } = currentScenario(page);

  await openTeamDashboard(page, async () => {
    const other = await page.context().newPage();

    await other.goto(new URL(`/app/${employees.workspaceId}/${employees.pageId}?v=${employees.hrViewId}`, page.url()).toString(), {
      waitUntil: 'domcontentloaded',
    });
    await expect(DatabaseViewSelectors.gridView(other)).toHaveAttribute('data-row-count', String(employees.hrRowIds.length), {
      timeout: LOAD_TIMEOUT_MS,
    });
  });
});

/** Navigate inside the app (no new document), as a click on another page would. */
async function navigateInApp(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

When('I open another page and return to the dashboard', async ({ page }) => {
  const scenario = currentScenario(page);
  const team = currentTeam(page);
  const { employees } = scenario;

  await expect(hrWidget(page).getByTestId('database-grid')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await navigateInApp(page, `/app/${employees.workspaceId}/${employees.pageId}`);
  await expect(DashboardSelectors.view(page)).toHaveCount(0, { timeout: 60000 });
  await expect(DatabaseViewSelectors.gridView(page).first()).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  scenario.samplesFrom = await page.evaluate(() => performance.now());
  await navigateInApp(page, `/app/${team.workspaceId}/${team.dashboardViewId}`);
  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: 60000 });
});

Then('the HR widget shows its first HR employees within 5 seconds, above a loading row', async ({ page }) => {
  const { employees } = currentScenario(page);
  const widget = hrWidget(page);

  await expect(widget.getByTestId('database-grid')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(gridDataRows(widget).first()).toBeVisible({ timeout: FIRST_ROWS_WITHIN_MS + 5000 });

  const samples = await readSamples(page);
  const gridShownAt = samples[0]?.t ?? 0;
  const firstRows = samples.find((sample) => sample.rowIds.length > 0);

  expect(firstRows, 'the HR widget listed no row').toBeDefined();
  expect((firstRows as WidgetSample).t - gridShownAt).toBeLessThanOrEqual(FIRST_ROWS_WITHIN_MS);
  // They came before the employees database finished loading.
  expect(firstRows?.hydrating).toBe(true);
  expect(firstRows?.rowCount).toBeNull();
  // And they are the first HR employees, in the view's order.
  expect(firstRows?.rowIds).toEqual(employees.hrRowIds.slice(0, firstRows?.rowIds.length));
});

Then('the HR widget lists every HR employee of the fixture', async ({ page }) => {
  const { employees } = currentScenario(page);
  const widget = hrWidget(page);
  const grid = widget.getByTestId('database-grid');

  await expect(grid).toHaveAttribute('data-row-count', String(employees.hrRowIds.length), { timeout: LOAD_TIMEOUT_MS });
  await expect(grid).not.toHaveAttribute('data-hydrating', 'true');
  await expect(widget.getByTestId('grid-loading-indicator')).toHaveCount(0);
  const shown = await gridDataRows(widget).evaluateAll((rows) =>
    rows.map((row) => (row.getAttribute('data-testid') ?? '').slice('grid-row-'.length))
  );

  expect(shown.length).toBeGreaterThan(0);
  expect(shown).toEqual(employees.hrRowIds.slice(0, shown.length));
});

Then('the HR widget never looked empty while it loaded', async ({ page }) => {
  const { employees } = currentScenario(page);
  const samples = await readSamples(page);

  expect(samples.length).toBeGreaterThan(0);
  samples.forEach((sample) => {
    // Rows, or the loading row: never a grid with neither.
    expect(sample.rowIds.length > 0 || sample.loading, `the HR widget looked empty at ${sample.t} ms`).toBe(true);
    expect(sample.rowCount).not.toBe('0');
    // Rows only ever append below the ones already shown.
    expect(sample.rowIds).toEqual(employees.hrRowIds.slice(0, sample.rowIds.length));
  });
});

/** Wait until the page clock passes `at` (ms since the page started loading). */
async function waitForPageClock(page: Page, at: number) {
  await expect
    .poll(() => page.evaluate(() => performance.now()), {
      timeout: Math.max(0, at - (await page.evaluate(() => performance.now()))) + 10000,
      message: `waiting for the page clock to reach ${Math.round(at)} ms`,
    })
    .toBeGreaterThan(at);
}

/** The widget samples of the visit under test. */
async function visitSamples(page: Page) {
  const from = currentScenario(page).samplesFrom ?? 0;

  return (await readSamples(page)).filter((sample) => sample.t >= from);
}

Then(
  'the HR widget shows no loading row within {int} seconds of its last row',
  async ({ page }, seconds: number) => {
    const scenario = currentScenario(page);
    const count = String(scenario.employees.hrRowIds.length);
    const listed = (await visitSamples(page)).find((sample) => sample.rowCount === count);

    expect(listed, 'the HR widget never listed every HR employee').toBeDefined();
    const deadline = (listed as WidgetSample).t + seconds * 1000;

    // The loading row is gone by the deadline, and every look from then on agrees.
    await waitForPageClock(page, deadline + 200);
    const after = (await visitSamples(page)).filter((sample) => sample.t >= deadline);

    expect(after.length, 'no look at the HR widget after the deadline').toBeGreaterThan(0);
    expect(
      after.filter((sample) => sample.loading).map((sample) => sample.t),
      `the HR widget still showed its loading row ${seconds} s after its last row (ms since load)`
    ).toEqual([]);
    await expect(hrWidget(page).getByTestId('grid-loading-indicator')).toHaveCount(0);
    scenario.noLoadingRowFrom = deadline;
  }
);

Then('the HR widget still shows no loading row {int} seconds later', async ({ page }, seconds: number) => {
  const scenario = currentScenario(page);
  const from = scenario.noLoadingRowFrom;

  expect(from, 'check the loading row is gone first').toBeDefined();
  const until = (from as number) + seconds * 1000;

  await waitForPageClock(page, until + 200);
  const looks = (await visitSamples(page)).filter((sample) => sample.t >= (from as number) && sample.t <= until);
  const count = String(scenario.employees.hrRowIds.length);

  expect(looks.length, 'no look at the HR widget in the window').toBeGreaterThan(0);
  expect(
    looks.filter((sample) => sample.loading).map((sample) => sample.t),
    'the HR widget showed its loading row again (ms since load)'
  ).toEqual([]);
  expect(
    looks.filter((sample) => sample.rowCount !== count).map((sample) => sample.t),
    'the HR widget stopped listing every HR employee (ms since load)'
  ).toEqual([]);
  await expect(hrWidget(page).getByTestId('grid-loading-indicator')).toHaveCount(0);
  await expect(hrWidget(page).getByTestId('database-grid')).toHaveAttribute('data-row-count', count);
});
