/**
 * Real dashboard use cases (modelled on Notion's dashboard templates).
 *
 * A use-case scenario describes its databases, rows and views in tables, so
 * this module builds that world through the cloud API (databases, rows, folder
 * views) and the dashboard test bridge (view filters, sorts, grouping and
 * layout settings in one Yjs transaction), then drives the dashboard through
 * its real UI. Views and widgets are addressed by the view name the scenario
 * gave them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { APIRequestContext, expect, Locator, Page } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { DateFilterCondition } from '../../src/application/database-yjs/fields/date/date.type';
import { SelectOptionFilterCondition } from '../../src/application/database-yjs/fields/select-option/select_option.type';
import { TextFilterCondition } from '../../src/application/database-yjs/fields/text/text.type';
import { Types } from '../../src/application/types';

import { mockProSubscription } from './chart-test-helpers';
import {
  addFixtureDatabase,
  apiGet,
  apiPost,
  closeGlobalFilterMenu,
  DashboardSelectors,
  DashboardWorld,
  dashboardWorld,
  databaseForLabel,
  DatabaseViewLayout,
  dragFromTo,
  enterEditMode,
  FieldSpec,
  FieldType,
  FIELD_TYPE_BY_NAME,
  fixtureDatabase,
  FixtureDatabase,
  installDashboardTestBridge,
  inviteDashboardMember,
  KnownWidget,
  memberPage,
  namedOptionId,
  openDashboardAsMember,
  openDatabasePage,
  openGlobalFilterChip,
  openWidgetPicker,
  pickExistingView,
  readDashboardSetting,
  readDatabaseViews,
  registerDashboardWorld,
  rowColumnWidth,
  signBrowserInWithSession,
  signInFixtureAccount,
  splitList,
  widgetLocator,
  writeDashboardSetting,
} from './dashboard-test-helpers';
import { closeRowDetailWithEscape } from './row-detail-helpers';
import { DatabaseViewSelectors, ModalSelectors } from './selectors';
import { setupPageErrorHandling } from './test-config';

export const USE_CASE_TIMEOUT = 30_000;
const FIXTURE_TIMEOUT = 45_000;
const SPACE_PERMISSION_PRIVATE = 1;
const DASHBOARD_GRID_COLUMNS = 12;
const DASHBOARD_ROW_HEIGHT = 360;

// ---------------------------------------------------------------------------
// Scenario state
// ---------------------------------------------------------------------------

export interface UseCaseView {
  name: string;
  viewId: string;
  database: string;
  layout: string;
}

export interface UseCaseDashboard {
  name: string;
  viewId: string;
  host: string;
  /** View name → seeded widget (UI-built dashboards leave this empty). */
  widgets: Record<string, KnownWidget>;
}

interface UseCaseState {
  name: string;
  views: Record<string, UseCaseView>;
  dashboards: Record<string, UseCaseDashboard>;
  /** Database name → the last view of its folder container (new views go after it). */
  lastViewIds: Record<string, string>;
  /** Rows (as view names) the dashboard showed when last checked. */
  shownRows?: string[][];
}

const states = new WeakMap<DashboardWorld, UseCaseState>();

export function scenarioState(page: Page): UseCaseState {
  const state = states.get(dashboardWorld(page));

  if (!state) throw new Error('This scenario has no use-case workspace');
  return state;
}

export function namedView(page: Page, name: string): UseCaseView {
  const view = scenarioState(page).views[name];

  if (!view) throw new Error(`The use case has no "${name}" view`);
  return view;
}

function viewNameForId(page: Page, viewId: string): string {
  const view = Object.values(scenarioState(page).views).find((candidate) => candidate.viewId === viewId);

  return view?.name ?? `?${viewId}`;
}

export function namedDashboard(page: Page, name: string): UseCaseDashboard {
  const dashboard = scenarioState(page).dashboards[name];

  if (!dashboard) throw new Error(`The use case has no "${name}" dashboard`);
  return dashboard;
}

/** Make `name` the dashboard every widget step talks about. */
export function activateDashboard(page: Page, name: string) {
  const world = dashboardWorld(page);
  const dashboard = namedDashboard(page, name);

  world.dashboardViewId = dashboard.viewId;
  world.dashboardHost = dashboard.host;
  world.widgets = dashboard.widgets;
  return dashboard;
}

// ---------------------------------------------------------------------------
// Workspace and databases
// ---------------------------------------------------------------------------

type ApiError = Error & { message: string };

/** Retry an API write the server refuses while its folder projection catches up. */
async function retryTransient<T>(label: string, action: () => Promise<T>, codes = ['"code":-5']): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const message = (error as ApiError).message ?? '';

      if (!codes.some((code) => message.includes(code))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 + attempt * 500));
    }
  }

  throw new Error(`${label} kept failing: ${(lastError as ApiError)?.message}`);
}

async function createPrivateSpace(request: APIRequestContext, token: string, workspaceId: string, name: string) {
  const space = await retryTransient(`Creating space "${name}"`, () =>
    apiPost<{ view_id: string }>(request, token, `/api/workspace/${workspaceId}/space`, {
      name,
      space_icon: 'lock',
      space_icon_color: '#555555',
      space_permission: SPACE_PERMISSION_PRIVATE,
    })
  );

  return space.view_id;
}

/** Sign in a fresh owner with a private space named after the use case. */
export async function prepareUseCaseWorkspace(page: Page, request: APIRequestContext, useCase: string) {
  const owner = await signInFixtureAccount(request, `dashboard-owner-${uuidv4()}@appflowy.io`);

  setupPageErrorHandling(page);
  await installDashboardTestBridge(page.context());
  await mockProSubscription(page);
  await signBrowserInWithSession(page, owner);
  const workspaces = await apiGet<{ visiting_workspace: { workspace_id: string } }>(
    request,
    owner.accessToken,
    '/api/user/workspace'
  );
  const workspaceId = workspaces.visiting_workspace.workspace_id;
  const world: DashboardWorld = {
    runId: uuidv4().slice(0, 8),
    owner,
    workspaceId,
    spaceId: await createPrivateSpace(request, owner.accessToken, workspaceId, useCase),
    spaceName: useCase,
    databases: {},
    widgets: {},
    viewsByName: {},
  };

  registerDashboardWorld(page, world);
  states.set(world, { name: useCase, views: {}, dashboards: {}, lastViewIds: {} });
  return world;
}

const OPTIONAL_TABLE_CELL = /^\s*$/;

/** `| property | type | options |` → field specs (the primary "Name" field always exists). */
export function parsePropertyTable(rows: Record<string, string>[]): FieldSpec[] {
  return rows.map((row) => {
    const type = FIELD_TYPE_BY_NAME[row.type.trim()];

    if (type === undefined) throw new Error(`Unknown property type "${row.type}"`);
    const options = OPTIONAL_TABLE_CELL.test(row.options ?? '') ? undefined : splitList(row.options);

    return {
      name: row.property.trim(),
      type,
      options: type === FieldType.SingleSelect ? options ?? [] : undefined,
    };
  });
}

export async function addUseCaseDatabase(
  page: Page,
  request: APIRequestContext,
  name: string,
  fields: FieldSpec[],
  privateSpace = false
) {
  const world = dashboardWorld(page);

  if (privateSpace && !world.privateSpaceId) {
    world.privateSpaceId = await createPrivateSpace(
      request,
      world.owner.accessToken,
      world.workspaceId,
      `${scenarioState(page).name} (private)`
    );
  }

  await retryTransient(`Creating the "${name}" database`, () =>
    addFixtureDatabase(page, request, name, { fields, rows: [], privateSpace })
  );
  const database = fixtureDatabase(page, name);

  database.fieldIds.Name = await primaryFieldId(page, database.databaseId);
  scenarioState(page).lastViewIds[name] = database.views.Grid;
}

/** `today`, `today - 3`, `today + 10` → local noon of that day, as the web stores a picked date. */
export function relativeDayOffset(text: string): number {
  const match = /^today(?:\s*([+-])\s*(\d+))?$/.exec(text.trim());

  if (!match) throw new Error(`Dates are written as "today", "today - N" or "today + N", got "${text}"`);
  if (!match[1]) return 0;
  return (match[1] === '-' ? -1 : 1) * Number(match[2]);
}

function localNoonIso(dayOffset: number) {
  const date = new Date();

  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString();
}

export function startOfDayUnix(dayOffset = 0) {
  const date = new Date();

  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return Math.floor(date.getTime() / 1000);
}

function fieldTypeOf(page: Page, database: FixtureDatabase, property: string): FieldType {
  if (property === 'Name') return FieldType.RichText;
  const type = databaseFieldTypes.get(dashboardWorld(page))?.[database.name]?.[property];

  if (type === undefined) throw new Error(`"${database.name}" has no "${property}" property`);
  return type;
}

const databaseFieldTypes = new WeakMap<DashboardWorld, Record<string, Record<string, FieldType>>>();

export function rememberFieldTypes(page: Page, database: string, fields: FieldSpec[]) {
  const world = dashboardWorld(page);
  const byDatabase = databaseFieldTypes.get(world) ?? {};

  byDatabase[database] = Object.fromEntries(fields.map((field) => [field.name, field.type]));
  databaseFieldTypes.set(world, byDatabase);
}

function fieldIdOf(database: FixtureDatabase, property: string): string {
  const fieldId = database.fieldIds[property];

  if (!fieldId) throw new Error(`"${database.name}" has no "${property}" property`);
  return fieldId;
}

/** Row ids behind the grid view the browser shows for `database`. */
async function browserRowIds(page: Page, databaseId: string, viewId: string): Promise<string[]> {
  return page.evaluate(
    ({ databaseId, viewId }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const ctx = bridge?.byDatabase(databaseId);
      const view = ctx?.databaseDoc.getMap('data').get('database')?.get('views')?.get(viewId);
      const orders = view?.get('row_orders');

      return orders ? orders.toArray().map((order: { id: string }) => order.id) : [];
    },
    { databaseId, viewId }
  );
}

export async function addUseCaseRows(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  rows: Record<string, string>[]
) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseName);
  const base = `/api/workspace/${world.workspaceId}/database/${database.databaseId}`;

  for (const row of rows) {
    const cells: Record<string, string | number | boolean> = {};

    Object.entries(row).forEach(([property, raw]) => {
      const value = raw.trim();

      if (!value) return;
      const type = fieldTypeOf(page, database, property);

      if (type === FieldType.Number) cells[property] = Number(value);
      else if (type === FieldType.DateTime) cells[property] = localNoonIso(relativeDayOffset(value));
      else if (type === FieldType.Checkbox) cells[property] = /^(yes|true|checked)$/i.test(value);
      else cells[property] = value;
    });
    database.rowIds[row.Name.trim()] = await apiPost<string>(request, world.owner.accessToken, `${base}/row`, {
      cells,
      document: null,
      parse_link_as_link_preview: false,
    });
  }

  // The browser shows the database: wait for the rows to reach its doc.
  await openDatabasePage(page, databaseName, database.views.Grid);
  const expected = Object.values(database.rowIds);

  await expect
    .poll(
      async () => {
        const ids = await browserRowIds(page, database.databaseId, database.views.Grid);

        return expected.every((id) => ids.includes(id));
      },
      { timeout: FIXTURE_TIMEOUT, message: `waiting for the "${databaseName}" rows to reach the browser` }
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

interface ViewLayoutInfo {
  folderLayout: number;
  databaseLayout: DatabaseViewLayout;
  chartType?: number;
}

const LAYOUTS: Record<string, ViewLayoutInfo> = {
  Grid: { folderLayout: 1, databaseLayout: DatabaseViewLayout.Grid },
  Board: { folderLayout: 2, databaseLayout: DatabaseViewLayout.Board },
  Calendar: { folderLayout: 3, databaseLayout: DatabaseViewLayout.Calendar },
  'Bar chart': { folderLayout: 5, databaseLayout: DatabaseViewLayout.Chart, chartType: 0 },
  'Line chart': { folderLayout: 5, databaseLayout: DatabaseViewLayout.Chart, chartType: 1 },
  'Donut chart': { folderLayout: 5, databaseLayout: DatabaseViewLayout.Chart, chartType: 3 },
  'Number chart': { folderLayout: 5, databaseLayout: DatabaseViewLayout.Chart, chartType: 4 },
  List: { folderLayout: 6, databaseLayout: DatabaseViewLayout.List },
  Gallery: { folderLayout: 7, databaseLayout: DatabaseViewLayout.Gallery },
  Timeline: { folderLayout: 10, databaseLayout: DatabaseViewLayout.Timeline },
  Dashboard: { folderLayout: 11, databaseLayout: DatabaseViewLayout.Dashboard },
};

const AGGREGATION = { count: 0, sum: 1 } as const;

export interface ViewFilterSpec {
  fieldId: string;
  fieldType: FieldType;
  condition: number;
  content: string;
}

export interface ViewConfig {
  layout: DatabaseViewLayout;
  filters: ViewFilterSpec[];
  sorts: { fieldId: string; condition: number }[];
  chart?: { chartType: number; xFieldId: string; aggregationType: number; yFieldId: string };
  group?: { fieldId: string; fieldType: FieldType; columnIds: string[] };
  calendarFieldId?: string;
  timeline?: { fieldId: string; endFieldId: string };
}

function optionIdsOf(list: string) {
  return splitList(list).map(namedOptionId).join(',');
}

function parseWhere(page: Page, database: FixtureDatabase, text: string): ViewFilterSpec[] {
  return text.split(' and ').map((clause) => {
    const trimmed = clause.trim();
    const match =
      /^(.+?) is (not) (.+)$/.exec(trimmed) ??
      /^(.+?) is (empty)$/.exec(trimmed) ??
      /^(.+?) is (before today)$/.exec(trimmed) ??
      /^(.+?) is (today)$/.exec(trimmed) ??
      /^(.+?) is ()(.+)$/.exec(trimmed);

    if (!match) throw new Error(`Cannot read the filter "${trimmed}"`);
    const [, property, kind, value] = match;
    const fieldType = fieldTypeOf(page, database, property);
    const fieldId = fieldIdOf(database, property);
    const filter = (condition: number, content = ''): ViewFilterSpec => ({ fieldId, fieldType, condition, content });

    if (fieldType === FieldType.DateTime) {
      if (kind === 'empty') return filter(DateFilterCondition.DateStartIsEmpty);
      if (kind === 'today') return filter(DateFilterCondition.DateStartsToday);
      if (kind === 'before today') {
        return filter(DateFilterCondition.DateStartsBefore, JSON.stringify({ timestamp: startOfDayUnix() }));
      }

      throw new Error(`Unsupported date filter "${trimmed}"`);
    }

    if (fieldType === FieldType.SingleSelect) {
      if (kind === 'empty') return filter(SelectOptionFilterCondition.OptionIsEmpty);
      if (kind === 'not') return filter(SelectOptionFilterCondition.OptionIsNot, optionIdsOf(value));
      return filter(SelectOptionFilterCondition.OptionIs, optionIdsOf(value));
    }

    if (fieldType === FieldType.RichText) {
      if (kind === 'empty') return filter(TextFilterCondition.TextIsEmpty);
      return filter(kind === 'not' ? TextFilterCondition.TextIsNot : TextFilterCondition.TextIs, value);
    }

    throw new Error(`Unsupported filter "${trimmed}"`);
  });
}

/**
 * The settings mini-language of the view tables: `count`, `sum of P`,
 * `count by P`, `sum of P by Q`, `where …` (clauses joined with ` and `),
 * `sorted by P ascending|descending`, `grouped by P`, `by Date`,
 * `from Start to End`.
 */
export function parseViewSettings(page: Page, databaseName: string, layoutName: string, text: string): ViewConfig {
  const database = fixtureDatabase(page, databaseName);
  const info = LAYOUTS[layoutName];

  if (!info) throw new Error(`Unknown view layout "${layoutName}"`);
  const config: ViewConfig = { layout: info.databaseLayout, filters: [], sorts: [] };
  let rest = text.trim();
  const whereIndex = rest.search(/(^|\s)where /);

  if (whereIndex !== -1) {
    const where = rest.slice(whereIndex).trim().replace(/^where /, '');

    config.filters = parseWhere(page, database, where);
    rest = rest.slice(0, whereIndex).trim();
  }

  if (info.chartType !== undefined) {
    const aggregate = /^(count|sum of (.+?))(?: by (.+))?$/.exec(rest);

    if (!aggregate) throw new Error(`A chart view needs "count" or "sum of <property>", got "${text}"`);
    const [, , sumProperty, byProperty] = aggregate;

    config.chart = {
      chartType: info.chartType,
      aggregationType: sumProperty ? AGGREGATION.sum : AGGREGATION.count,
      yFieldId: sumProperty ? fieldIdOf(database, sumProperty) : '',
      xFieldId: byProperty ? fieldIdOf(database, byProperty) : '',
    };
    if (info.chartType !== 4 && !byProperty) throw new Error(`"${layoutName}" needs "by <property>": "${text}"`);
    return config;
  }

  if (!rest) return config;
  let match = /^sorted by (.+) (ascending|descending)$/.exec(rest);

  if (match) {
    config.sorts.push({ fieldId: fieldIdOf(database, match[1]), condition: match[2] === 'ascending' ? 0 : 1 });
    return config;
  }

  match = /^grouped by (.+)$/.exec(rest);
  if (match) {
    const fieldId = fieldIdOf(database, match[1]);
    const fieldType = fieldTypeOf(page, database, match[1]);
    const spec = databaseSpecOptions.get(dashboardWorld(page))?.[databaseName]?.[match[1]] ?? [];

    config.group = { fieldId, fieldType, columnIds: [fieldId, ...spec.map(namedOptionId)] };
    return config;
  }

  match = /^from (.+) to (.+)$/.exec(rest);
  if (match) {
    config.timeline = { fieldId: fieldIdOf(database, match[1]), endFieldId: fieldIdOf(database, match[2]) };
    return config;
  }

  match = /^by (.+)$/.exec(rest);
  if (match) {
    config.calendarFieldId = fieldIdOf(database, match[1]);
    return config;
  }

  throw new Error(`Cannot read the view settings "${text}"`);
}

const databaseSpecOptions = new WeakMap<DashboardWorld, Record<string, Record<string, string[]>>>();

export function rememberSelectOptions(page: Page, database: string, fields: FieldSpec[]) {
  const world = dashboardWorld(page);
  const byDatabase = databaseSpecOptions.get(world) ?? {};

  byDatabase[database] = Object.fromEntries(
    fields.filter((field) => field.options).map((field) => [field.name, field.options ?? []])
  );
  databaseSpecOptions.set(world, byDatabase);
}

interface CreatedView {
  view_id: string;
  database_id?: string;
  database_update?: number[];
}

/** Create a folder view the way the web's tab bar does (a child of the database container). */
async function createFolderView(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  name: string,
  folderLayout: number
): Promise<string> {
  const world = dashboardWorld(page);
  const state = scenarioState(page);
  const database = fixtureDatabase(page, databaseName);
  const created = await retryTransient(`Creating the "${name}" view`, () =>
    apiPost<CreatedView>(
      request,
      world.owner.accessToken,
      `/api/workspace/${world.workspaceId}/page-view/${database.pageId}/database-view`,
      {
        parent_view_id: database.pageId,
        prev_view_id: state.lastViewIds[databaseName],
        database_id: database.databaseId,
        layout: folderLayout,
        name,
        embedded: false,
      }
    )
  );

  state.lastViewIds[databaseName] = created.view_id;
  // Like the web, apply the returned database update right away.
  if (created.database_update?.length) {
    await page.evaluate(
      ({ databaseId, update }) => {
        const win = window as any;
        const ctx = win.__DASHBOARD_TEST__.byDatabase(databaseId);

        // Same origin as the web's applyYDoc: a server update is never sent back.
        win.Y.transact(ctx.databaseDoc, () => win.Y.applyUpdate(ctx.databaseDoc, new Uint8Array(update), 'remote'), 'remote');
      },
      { databaseId: database.databaseId, update: created.database_update }
    );
  }

  await expect
    .poll(
      async () =>
        (await readDatabaseViews(page, database.databaseId)).some((view) => view.id === created.view_id),
      { timeout: FIXTURE_TIMEOUT, message: `waiting for the "${name}" view to reach the browser` }
    )
    .toBe(true);
  return created.view_id;
}

/** Write a view's filters, sorts, grouping and layout settings in one transaction. */
async function configureView(page: Page, databaseId: string, viewId: string, config: ViewConfig) {
  await page.evaluate(
    ({ databaseId, viewId, config }) => {
      const win = window as any;
      const Yjs = win.Y;
      const doc = win.__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
      const database = doc.getMap('data').get('database');
      const view = database.get('views').get(viewId);
      const fields = database.get('fields');
      const nonce = () => Math.random().toString(36).slice(2, 8);
      const layoutSettings = () => {
        let settings = view.get('layout_settings');

        if (!settings) {
          settings = new Yjs.Map();
          view.set('layout_settings', settings);
        }

        return settings;
      };

      const layoutSetting = (key: string) => {
        const settings = layoutSettings();
        let setting = settings.get(key);

        if (!setting) {
          setting = new Yjs.Map();
          settings.set(key, setting);
        }

        return setting;
      };

      const mapOf = (entries: Record<string, unknown>) => {
        const map = new Yjs.Map();

        Object.entries(entries).forEach(([key, value]) => map.set(key, value));
        return map;
      };

      // Desktop-compatible field visibility for a List / Gallery (the web normalizes created views the same way).
      const cardFieldSettings = (visibleCount: number) => {
        const settings = new Yjs.Map();
        const ordered: string[] = [];

        (view.get('field_orders')?.toArray() ?? []).forEach((order: { id: string }) => {
          if (fields.has(order.id) && !ordered.includes(order.id)) ordered.push(order.id);
        });
        Array.from(fields.keys()).forEach((fieldId) => {
          if (!ordered.includes(fieldId as string)) ordered.push(fieldId as string);
        });
        ordered.forEach((fieldId, index) => {
          const setting = new Yjs.Map();
          const primary = Boolean(fields.get(fieldId)?.get('is_primary'));

          setting.set('visibility', primary || index < visibleCount ? 0 : 2);
          setting.set('wrap', false);
          settings.set(fieldId, setting);
        });
        return settings;
      };

      doc.transact(() => {
        if (config.layout === 4 || config.layout === 5) {
          const groups = view.get('groups');

          if (groups?.length) groups.delete(0, groups.length);
          view.set('field_settings', cardFieldSettings(config.layout === 4 ? 3 : 0));
          view.set('layout', config.layout);
          if (config.layout === 4) {
            layoutSettings().set(
              '4',
              mapOf({
                display_mode: 1,
                visible_field_ids: [],
                show_cover: true,
                show_icon: true,
                card_width: 0,
                show_field_names: true,
              })
            );
          } else {
            layoutSettings().set(
              '5',
              mapOf({ show_cover: true, fit_image: false, card_size: 1, card_width: 0, card_preview: 0 })
            );
          }
        }

        if (config.filters.length > 0) {
          const filters = new Yjs.Array();

          config.filters.forEach((spec) => {
            const filter = new Yjs.Map();

            filter.set('id', `uc${nonce()}`);
            filter.set('field_id', spec.fieldId);
            filter.set('condition', spec.condition);
            filter.set('content', spec.content);
            filter.set('ty', spec.fieldType);
            filter.set('filter_type', 2);
            filters.push([filter]);
          });
          view.set('filters', filters);
        }

        if (config.sorts.length > 0) {
          const sorts = new Yjs.Array();

          config.sorts.forEach((spec) => {
            const sort = new Yjs.Map();

            sort.set('id', `uc${nonce()}`);
            sort.set('field_id', spec.fieldId);
            sort.set('condition', spec.condition);
            sorts.push([sort]);
          });
          view.set('sorts', sorts);
        }

        if (config.chart) {
          const chart = new Yjs.Map();

          chart.set('chartType', config.chart.chartType);
          chart.set('xFieldId', config.chart.xFieldId);
          chart.set('aggregationType', config.chart.aggregationType);
          if (config.chart.yFieldId) chart.set('yFieldId', config.chart.yFieldId);
          chart.set('showEmptyValues', true);
          chart.set('cumulative', false);
          chart.set('dateCondition', 3);
          layoutSettings().set('3', chart);
        }

        if (config.group) {
          let groups = view.get('groups');

          if (!groups) {
            groups = new Yjs.Array();
            view.set('groups', groups);
          }

          const group = new Yjs.Map();
          const columns = new Yjs.Array();

          group.set('field_id', config.group.fieldId);
          group.set('id', `g:${nonce()}`);
          group.set('ty', config.group.fieldType);
          group.set('collapsed_group_ids', new Yjs.Array());
          group.set('content', '');
          config.group.columnIds.forEach((id: string) => {
            const column = new Yjs.Map();

            column.set('id', id);
            column.set('visible', true);
            columns.push([column]);
          });
          group.set('groups', columns);
          groups.delete(0, groups.length);
          groups.insert(0, [group]);
        }

        if (config.calendarFieldId) layoutSetting('2').set('field_id', config.calendarFieldId);
        if (config.timeline) {
          const timeline = layoutSetting('8');

          timeline.set('field_id', config.timeline.fieldId);
          timeline.set('end_field_id', config.timeline.endFieldId);
        }
      });
    },
    { databaseId, viewId, config }
  );
}

const VIEW_SYNC_KEYS = ['layout', 'filters', 'sorts', 'groups', 'layout_settings'];

/** JSON with sorted object keys (Yrs does not keep the key order of plain objects) and BigInts as numbers. */
function stableJson(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return Number(item);
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }

    return item;
  });
}

/** The synced parts of some views, as the server stores them. */
async function serverViewSnapshot(request: APIRequestContext, page: Page, databaseId: string, viewIds: string[]) {
  const world = dashboardWorld(page);
  const collab = await apiGet<{ doc_state: number[] }>(
    request,
    world.owner.accessToken,
    `/api/workspace/v1/${world.workspaceId}/collab/${databaseId}?collab_type=${Types.Database}`
  );
  const doc = new Y.Doc({ guid: databaseId });

  Y.applyUpdate(doc, new Uint8Array(collab.doc_state));
  const views = (doc.getMap('data').get('database') as Y.Map<unknown> | undefined)?.get('views') as
    | Y.Map<Y.Map<unknown>>
    | undefined;

  return stableJson(
    viewIds.map((viewId) => {
      const view = views?.get(viewId);

      return Object.fromEntries(
        VIEW_SYNC_KEYS.map((key) => {
          const value = view?.get(key);

          return [key, value instanceof Y.AbstractType ? value.toJSON() : value ?? null];
        })
      );
    })
  );
}

async function browserViewSnapshot(page: Page, databaseId: string, viewIds: string[]) {
  const snapshot = await page.evaluate(
    ({ databaseId, viewIds, keys }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const views = bridge.byDatabase(databaseId).databaseDoc.getMap('data').get('database').get('views');

      return viewIds.map((viewId: string) => {
        const view = views.get(viewId);

        return Object.fromEntries(keys.map((key: string) => [key, bridge.plain(view?.get(key)) ?? null]));
      });
    },
    { databaseId, viewIds, keys: VIEW_SYNC_KEYS }
  );

  return stableJson(snapshot);
}

/**
 * Wait until the server holds what the browser wrote to these views, so a
 * later navigation (or another browser) cannot miss the seeded settings.
 */
export async function waitForViewSync(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  viewIds: string[],
  rewrite?: () => Promise<void>
) {
  const databaseId = fixtureDatabase(page, databaseName).databaseId;
  let local = await browserViewSnapshot(page, databaseId, viewIds);
  let remote = '';
  const synced = (timeout: number) =>
    expect
      .poll(
        async () => {
          remote = await serverViewSnapshot(request, page, databaseId, viewIds).catch((error: Error) => error.message);
          return remote === local;
        },
        { timeout }
      )
      .toBe(true);

  try {
    if (rewrite) {
      try {
        await synced(20_000);
        return;
      } catch {
        // A write made while the doc was still binding to the sync channel can
        // miss the server; write the same settings once more.
        await rewrite();
        local = await browserViewSnapshot(page, databaseId, viewIds);
      }
    }

    await synced(FIXTURE_TIMEOUT);
  } catch {
    throw new Error(
      `The "${databaseName}" views did not reach the server.\nbrowser: ${local}\nserver:  ${remote}\nbrowser now: ${await browserViewSnapshot(
        page,
        databaseId,
        viewIds
      )}`
    );
  }
}

export async function addUseCaseViews(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  rows: Record<string, string>[]
) {
  const world = dashboardWorld(page);
  const state = scenarioState(page);
  const database = fixtureDatabase(page, databaseName);

  await openDatabasePage(page, databaseName, database.views.Grid);
  const configs: { viewId: string; config: ViewConfig }[] = [];

  for (const row of rows) {
    const name = row.view.trim();
    const layoutName = row.layout.trim();
    const config = parseViewSettings(page, databaseName, layoutName, row.settings ?? '');
    const viewId = await createFolderView(page, request, databaseName, name, LAYOUTS[layoutName].folderLayout);

    await configureView(page, database.databaseId, viewId, config);
    configs.push({ viewId, config });
    state.views[name] = { name, viewId, database: databaseName, layout: layoutName };
    world.viewsByName = { ...world.viewsByName, [name]: { viewId, database: databaseName } };
  }

  await waitForViewSync(
    page,
    request,
    databaseName,
    configs.map(({ viewId }) => viewId),
    async () => {
      for (const { viewId, config } of configs) await configureView(page, database.databaseId, viewId, config);
    }
  );
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

/** `| row | widgets |` → view names per row. */
export function parseDashboardRows(rows: Record<string, string>[]): string[][] {
  return [...rows]
    .sort((a, b) => Number(a.row) - Number(b.row))
    .map((row) => splitList(row.widgets));
}

/** Create a dashboard view through the API and seed its rows (it opens in View mode). */
export async function seedUseCaseDashboard(
  page: Page,
  request: APIRequestContext,
  name: string,
  host: string,
  layout: string[][]
) {
  const state = scenarioState(page);
  const hostDatabase = fixtureDatabase(page, host);

  await openDatabasePage(page, host, hostDatabase.views.Grid);
  const viewId = await createFolderView(page, request, host, name, LAYOUTS.Dashboard.folderLayout);
  const dashboard: UseCaseDashboard = { name, viewId, host, widgets: {} };
  const rows = layout.map((names) => {
    const width = Math.floor(DASHBOARD_GRID_COLUMNS / names.length);

    return {
      id: `r-${uuidv4().slice(0, 12)}`,
      height: DASHBOARD_ROW_HEIGHT,
      widgets: names.map((viewName, index) => {
        const view = namedView(page, viewName);
        const widget = {
          id: `w-${uuidv4().slice(0, 12)}`,
          view_id: view.viewId,
          database_id: fixtureDatabase(page, view.database).databaseId,
          width: index === names.length - 1 ? DASHBOARD_GRID_COLUMNS - width * (names.length - 1) : width,
        };

        dashboard.widgets[viewName] = { id: widget.id, viewId: widget.view_id, databaseId: widget.database_id };
        return widget;
      }),
    };
  });

  state.dashboards[name] = dashboard;
  activateDashboard(page, name);
  await writeDashboardSetting(page, { rows, global_filters: [] });
  await waitForViewSync(page, request, host, [viewId], () =>
    writeDashboardSetting(page, { rows, global_filters: [] })
  );
  await openUseCaseDashboard(page, name);
}

/** Navigate to the host database with the dashboard tab active and wait for its widgets. */
export async function openUseCaseDashboard(page: Page, name: string) {
  const dashboard = activateDashboard(page, name);

  await openDatabasePage(page, dashboard.host, dashboard.viewId);
  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: FIXTURE_TIMEOUT });
  await waitForDashboardWidgets(page);
}

async function waitForDashboardWidgets(scope: Page, owner?: Page) {
  const setting = await readDashboardSetting(owner ?? scope);
  const count = setting.rows.reduce((sum, row) => sum + row.widgets.length, 0);
  const seeded = Object.keys(dashboardWorld(owner ?? scope).widgets).length;

  expect(count, 'the dashboard lost its seeded widgets').toBeGreaterThanOrEqual(seeded);

  await expect(DashboardSelectors.widgets(scope)).toHaveCount(count, { timeout: FIXTURE_TIMEOUT });
  await expect(scope.getByTestId('dashboard-widget-placeholder').and(scope.locator('[data-reason="loading"]'))).toHaveCount(
    0,
    { timeout: FIXTURE_TIMEOUT }
  );
}

/** Add a dashboard from the tab bar "+" menu and rename its tab. */
export async function createDashboardThroughUi(page: Page, name: string, host: string) {
  const world = dashboardWorld(page);
  const state = scenarioState(page);
  const database = fixtureDatabase(page, host);

  await openDatabasePage(page, host, database.views.Grid);
  const before = new Set((await readDatabaseViews(page, database.databaseId)).map((view) => view.id));

  await DatabaseViewSelectors.addViewButton(page).click();
  await DashboardSelectors.addDashboardViewOption(page).click();
  let viewId = '';

  await expect
    .poll(
      async () => {
        viewId =
          (await readDatabaseViews(page, database.databaseId)).find(
            (view) => !before.has(view.id) && view.layout === DatabaseViewLayout.Dashboard
          )?.id ?? '';
        return viewId;
      },
      { timeout: FIXTURE_TIMEOUT, message: `waiting for the new dashboard of "${host}"` }
    )
    .not.toBe('');
  const tab = DatabaseViewSelectors.viewTab(page, viewId);

  await expect(tab).toHaveAttribute('data-state', 'active', { timeout: FIXTURE_TIMEOUT });
  await expect(DashboardSelectors.view(page)).toBeVisible({ timeout: FIXTURE_TIMEOUT });

  await tab.click({ button: 'right' });
  await expect(DatabaseViewSelectors.tabActionRename(page)).toBeVisible();
  await DatabaseViewSelectors.tabActionRename(page).click();
  const input = ModalSelectors.renameInput(page);

  await expect(input).toBeVisible();
  await input.fill(name);
  await ModalSelectors.renameSaveButton(page).click();
  await expect(input).toBeHidden({ timeout: USE_CASE_TIMEOUT });
  await expect(tab).toContainText(name, { timeout: USE_CASE_TIMEOUT });

  state.dashboards[name] = { name, viewId, host, widgets: {} };
  state.lastViewIds[host] = viewId;
  activateDashboard(page, name);
  world.widgets = state.dashboards[name].widgets;
}

function widgetsOfView(page: Page, viewName: string): Locator {
  return DashboardSelectors.widgetsForView(page, namedView(page, viewName).viewId);
}

async function rowIdOfWidget(page: Page, viewName: string): Promise<string> {
  const row = widgetLocator(page, viewName).locator('xpath=ancestor::div[@data-testid="dashboard-row"][1]');

  await expect(row).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  const rowId = await row.getAttribute('data-row-id');

  if (!rowId) throw new Error(`The "${viewName}" widget is not in a dashboard row`);
  return rowId;
}

export type WidgetPlacement = { type: 'default' } | { type: 'next-to'; target: string } | { type: 'new-row' };

/** Add an existing view as a widget through the picker, optionally searching for it first. */
export async function addWidgetThroughPicker(
  page: Page,
  viewName: string,
  placement: WidgetPlacement,
  search?: string
) {
  const view = namedView(page, viewName);
  const before = await widgetsOfView(page, viewName).count();

  await enterEditMode(page);
  if (placement.type === 'next-to') {
    const rowId = await rowIdOfWidget(page, placement.target);

    await DashboardSelectors.row(page, rowId).hover();
    await openWidgetPicker(page, DashboardSelectors.addWidgetRowButton(page, rowId));
  } else if (placement.type === 'new-row') {
    await openWidgetPicker(page, DashboardSelectors.addWidgetButton(page).filter({ visible: true }).last());
  } else {
    await openWidgetPicker(page);
  }

  await pickExistingView(page, view.viewId, search);
  await expect(widgetsOfView(page, viewName)).toHaveCount(before + 1, { timeout: USE_CASE_TIMEOUT });
  if (placement.type === 'next-to') {
    const rowId = await rowIdOfWidget(page, placement.target);

    await expect(DashboardSelectors.row(page, rowId).locator(`[data-view-id="${view.viewId}"]`)).toHaveCount(1);
  }
}

/** Rendered dashboard rows, as the view names their widgets show. */
export async function shownDashboardRows(scope: Page, owner: Page = scope): Promise<string[][]> {
  const ids = await DashboardSelectors.rows(scope).evaluateAll((rows) =>
    rows.map((row) =>
      Array.from(row.querySelectorAll('[data-testid="dashboard-widget"]')).map(
        (widget) => widget.getAttribute('data-view-id') ?? ''
      )
    )
  );

  return ids.map((row) => row.map((viewId) => viewNameForId(owner, viewId)));
}

export async function expectDashboardRows(page: Page, expected: string[][]) {
  await expect.poll(() => shownDashboardRows(page), { timeout: USE_CASE_TIMEOUT }).toEqual(expected);
  // The saved layout matches what is shown.
  await expect
    .poll(async () =>
      (await readDashboardSetting(page)).rows.map((row) => row.widgets.map((widget) => viewNameForId(page, widget.view_id)))
    )
    .toEqual(expected);
  scenarioState(page).shownRows = expected;
}

export function lastShownRows(page: Page): string[][] {
  const rows = scenarioState(page).shownRows;

  if (!rows) throw new Error('No step has checked the dashboard rows yet');
  return rows;
}

/** Drag the width handle next to `viewName` until the widget spans `columns`. */
export async function resizeWidgetTo(page: Page, viewName: string, columns: number) {
  const viewId = namedView(page, viewName).viewId;

  await enterEditMode(page);
  const { rows } = await readDashboardSetting(page);
  const row = rows.find((candidate) => candidate.widgets.some((widget) => widget.view_id === viewId));

  if (!row) throw new Error(`The dashboard has no "${viewName}" widget`);
  const index = row.widgets.findIndex((widget) => widget.view_id === viewId);
  const delta = columns - row.widgets[index].width;
  const last = index === row.widgets.length - 1;

  if (last && row.widgets.length === 1) throw new Error(`"${viewName}" is alone in its row and spans every column`);
  // A handle sits after each widget but the last; the last widget grows from its left edge.
  const handleIndex = last ? index - 1 : index;
  const direction = last ? -1 : 1;
  const handle = DashboardSelectors.widthHandle(page, row.id, handleIndex);
  const columnWidth = await rowColumnWidth(page, row.id);

  await DashboardSelectors.row(page, row.id).hover();
  await expect(handle).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  const box = await handle.boundingBox();

  if (!box) throw new Error('The width handle is not visible');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await dragFromTo(page, from, { x: from.x + direction * delta * columnWidth, y: from.y });
  await expect
    .poll(async () => {
      const current = (await readDashboardSetting(page)).rows.find((candidate) => candidate.id === row.id);

      return current?.widgets.find((widget) => widget.view_id === viewId)?.width;
    })
    .toBe(columns);
}

// ---------------------------------------------------------------------------
// Widget content
// ---------------------------------------------------------------------------

/** A number as a chart prints it ("330000", "330,000", "6") → 330000. */
export function chartNumber(text: string): number {
  return Number(text.replace(/[,\s]/g, ''));
}

export function namedWidget(scope: Page, owner: Page, viewName: string): Locator {
  const known = dashboardWorld(owner).widgets[viewName];

  if (known) return DashboardSelectors.widget(scope, known.id);
  return DashboardSelectors.widgetsForView(scope, namedView(owner, viewName).viewId).first();
}

/** Titles of the rows or cards a widget renders, whatever its layout. */
export async function widgetTitles(widget: Locator, primaryId: string): Promise<string[]> {
  return widget.evaluate((element, primaryFieldId) => {
    const text = (node: Element | null) => (node?.textContent ?? '').trim();
    const grid = element.querySelector('[data-testid="database-grid"]');

    if (grid) {
      return Array.from(grid.querySelectorAll('[data-testid^="grid-row-"]'))
        .filter((row) => row.getAttribute('data-testid') !== 'grid-row-undefined')
        .map((row) => {
          const rowId = (row.getAttribute('data-testid') ?? '').replace('grid-row-', '');

          return text(row.querySelector(`[data-testid="grid-cell-${rowId}-${primaryFieldId}"]`));
        });
    }

    const list = element.querySelector('[data-testid="database-list"]');

    if (list) {
      return Array.from(list.querySelectorAll('[data-testid^="list-primary-cell-"]')).map((cell) => text(cell));
    }

    const gallery = element.querySelector('[data-testid="database-gallery"]');

    if (gallery) {
      return Array.from(gallery.querySelectorAll('[data-testid^="gallery-card-title-"]'))
        .filter((title) => /^gallery-card-title-[^-]/.test(title.getAttribute('data-testid') ?? '') &&
          !(title.getAttribute('data-testid') ?? '').startsWith('gallery-card-title-surface-'))
        .map((title) => text(title));
    }

    const board = element.querySelector('.database-board');

    if (board) {
      return Array.from(board.querySelectorAll('.board-card')).map((card) =>
        text(card.querySelector('.truncate')?.firstElementChild ?? card)
      );
    }

    return [];
  }, primaryId);
}

/** The rows (or cards) of `viewName`'s widget as `scope` shows them, as a set or in order. */
export async function expectWidgetTitles(
  scope: Page,
  owner: Page,
  viewName: string,
  expected: string[],
  ordered = false
) {
  const widget = namedWidget(scope, owner, viewName);
  const primaryId = fixtureDatabase(owner, databaseForLabel(owner, viewName)).fieldIds.Name;
  const normalize = (titles: string[]) => (ordered ? titles : [...titles].sort());

  await expect(widget).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  await expect
    .poll(async () => normalize(await widgetTitles(widget, primaryId)), { timeout: USE_CASE_TIMEOUT })
    .toEqual(normalize(expected));
}

export function boardColumn(widget: Locator, column: string): Locator {
  return widget
    .getByTestId('board-column')
    .filter({ has: widget.page().getByTestId('board-column-name').getByText(column, { exact: true }) });
}

export async function boardColumnTitles(widget: Locator, column: string): Promise<string[]> {
  return boardColumn(widget, column)
    .locator('.board-card')
    .evaluateAll((cards) =>
      cards.map((card) => (card.querySelector('.truncate')?.firstElementChild ?? card).textContent?.trim() ?? '')
    );
}

/** Titles of the rows a timeline widget draws bars for (sorted). */
export async function timelineBarTitles(page: Page, viewName: string): Promise<string[]> {
  const database = fixtureDatabase(page, databaseForLabel(page, viewName));
  const titleById = new Map(Object.entries(database.rowIds).map(([title, id]) => [id, title]));
  const ids = await widgetLocator(page, viewName)
    .locator('[data-testid^="timeline-bar-"]')
    .evaluateAll((bars) => bars.map((bar) => (bar.getAttribute('data-testid') ?? '').replace('timeline-bar-', '')));

  return ids.map((id) => titleById.get(id) ?? `?${id}`).sort();
}

/** Donut centre total. */
export function donutTotal(widget: Locator): Locator {
  return widget.locator('.recharts-wrapper').locator('xpath=..').locator('..').getByText('Total', { exact: true })
    .locator('xpath=preceding-sibling::*[1]');
}

/** Category → value of a bar chart, from its axis labels and bar value labels. */
export async function barChartValues(widget: Locator): Promise<Record<string, number>> {
  return widget.evaluate((element) => {
    const ticks = Array.from(element.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value')).map(
      (tick) => (tick.textContent ?? '').trim()
    );
    const values = Array.from(element.querySelectorAll('.recharts-label-list .recharts-label')).map((label) =>
      Number((label.textContent ?? '').replace(/[,\s]/g, ''))
    );
    const result: Record<string, number> = {};

    ticks.forEach((tick, index) => {
      result[tick] = values[index];
    });
    return result;
  });
}

/** The index of a chart category in the rendered data (legend and bars follow data order). */
async function chartCategoryIndex(widget: Locator, label: string): Promise<number> {
  const labels = await widget.evaluate((element) => {
    const legend = Array.from(element.querySelectorAll('button span.text-xs')).map((span) => (span.textContent ?? '').trim());

    if (element.querySelector('.recharts-pie')) return legend;
    return Array.from(element.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value')).map((tick) =>
      (tick.textContent ?? '').trim()
    );
  });
  const index = labels.indexOf(label);

  if (index === -1) throw new Error(`The chart has no "${label}" category (it has ${labels.join(', ')})`);
  return index;
}

/** Click a bar, or the middle of a donut slice, the way a user points at it. */
export async function clickChartSegment(page: Page, widget: Locator, label: string) {
  await expect(widget.locator('.recharts-wrapper')).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  await expect
    .poll(() => chartCategoryIndex(widget, label).catch(() => -1), { timeout: USE_CASE_TIMEOUT })
    .toBeGreaterThan(-1);
  const index = await chartCategoryIndex(widget, label);

  if ((await widget.locator('.recharts-pie').count()) === 0) {
    const bar = widget.locator('.recharts-bar-rectangle path').nth(index);

    await bar.scrollIntoViewIfNeeded();
    await bar.click();
    return;
  }

  const sector = widget.locator('.recharts-pie-sector').nth(index);

  // Recharts draws the slice labels once its entry animation has finished.
  await expect
    .poll(
      () =>
        widget.evaluate(
          (element) =>
            element.querySelectorAll('.recharts-pie-labels text').length ===
            element.querySelectorAll('.recharts-pie-sector').length
        ),
      { timeout: USE_CASE_TIMEOUT }
    )
    .toBe(true);
  await sector.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  // Slice labels sit on the slice's mid-angle, outside the ring: step back onto the ring.
  const point = await widget.evaluate((element, sliceIndex) => {
    const surface = element.querySelector('.recharts-pie')?.closest('svg');
    const labelNode = element.querySelectorAll('.recharts-pie-labels text')[sliceIndex];

    if (!surface || !labelNode) return null;
    const rect = surface.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const lx = rect.x + Number(labelNode.getAttribute('x'));
    const ly = rect.y + Number(labelNode.getAttribute('y'));
    // Inner radius 70, outer 110: aim at the middle of the ring.
    const ratio = 90 / Math.hypot(lx - cx, ly - cy);
    const x = cx + (lx - cx) * ratio;
    const y = cy + (ly - cy) * ratio;
    const hit = document.elementFromPoint(x, y);
    const sectors = Array.from(element.querySelectorAll('.recharts-pie-sector'));

    return { x, y, hits: Boolean(hit && sectors[sliceIndex]?.contains(hit)) };
  }, index);

  if (!point) throw new Error(`Cannot locate the "${label}" slice`);
  expect(point.hits, `the "${label}" slice is not under the pointer`).toBe(true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
}

export function drillDown(page: Page): Locator {
  return page.locator('.MuiDialog-paper').filter({ has: page.locator('.MuiDialogTitle-root') }).first();
}

export async function drillDownTitles(page: Page): Promise<string[]> {
  return drillDown(page)
    .locator('.MuiDialogContent-root button')
    .evaluateAll((buttons) => buttons.map((button) => (button.textContent ?? '').trim()));
}

// ---------------------------------------------------------------------------
// Editing data from widgets and row pages
// ---------------------------------------------------------------------------

/** Find a row id by its title in the widget (rows created during the scenario are learned here). */
export async function rowIdByTitle(page: Page, viewName: string, title: string): Promise<string> {
  const database = fixtureDatabase(page, databaseForLabel(page, viewName));
  const known = database.rowIds[title];

  if (known) return known;
  const rowId = await page.evaluate(
    ({ databaseId, title }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const ctx = bridge?.byDatabase(databaseId);
      const database = ctx?.databaseDoc.getMap('data').get('database');
      const fieldEntries: [string, any][] = Array.from(database?.get('fields')?.entries() ?? []);
      const primaryId = fieldEntries.find(([, field]) => field.get('is_primary'))?.[0];
      const rowMap = ctx?.rowMap ?? {};

      const rowEntries: [string, any][] = Object.entries(rowMap);

      for (const [id, rowDoc] of rowEntries) {
        const cell = rowDoc?.getMap('data')?.get('database_row')?.get('cells')?.get(primaryId);
        const data = cell?.get('data');
        const text = typeof data === 'string' ? data : data?.toString?.() ?? '';

        if (text.trim() === title) return id;
      }

      return '';
    },
    { databaseId: database.databaseId, title }
  );

  if (!rowId) throw new Error(`No "${title}" row in "${database.name}"`);
  database.rowIds[title] = rowId;
  return rowId;
}

async function chooseSelectOption(page: Page, value: string) {
  const menu = page.getByTestId('select-option-menu');

  await expect(menu).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  const option = menu.getByTestId(`select-option-${namedOptionId(value)}`);

  await expect(option).toBeVisible();
  await option.click();
  await expect(menu.getByTestId(`select-option-${namedOptionId(value)}`)).toBeVisible();
  // Picking an option keeps the menu open; Escape closes the menu only.
  if (await menu.isVisible()) await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

/** Edit a grid cell of a widget: pick a select option or type a number / text. */
export async function editWidgetCell(page: Page, viewName: string, title: string, property: string, value: string) {
  const widget = widgetLocator(page, viewName);
  const database = fixtureDatabase(page, databaseForLabel(page, viewName));
  const rowId = await rowIdByTitle(page, viewName, title);
  const fieldId = fieldIdOf(database, property);
  const type = fieldTypeOf(page, database, property);
  const cell = widget.getByTestId(`grid-cell-${rowId}-${fieldId}`);

  await expect(cell).toBeAttached({ timeout: USE_CASE_TIMEOUT });
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  if (type === FieldType.SingleSelect) {
    await chooseSelectOption(page, value);
    return;
  }

  const input = cell.locator('input, textarea, [contenteditable="true"]').first();

  await expect(input).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  await input.fill(value);
  await input.press('Enter');
  await page.keyboard.press('Escape');
}

export async function expectPersistedCell(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  title: string,
  property: string,
  expected: string
) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseName);
  const rowId = database.rowIds[title];
  const fieldId = fieldIdOf(database, property);

  await expect
    .poll(
      async () => {
        const details = await apiGet<{ id: string; cells: Record<string, unknown> }[]>(
          request,
          world.owner.accessToken,
          `/api/workspace/${world.workspaceId}/database/${database.databaseId}/row/detail?ids=${rowId}`
        );
        const cells = details[0]?.cells ?? {};
        const value = cells[property] ?? cells[fieldId];

        return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
      },
      { timeout: USE_CASE_TIMEOUT, message: `waiting for "${property}" of "${title}" to be saved` }
    )
    .toBe(expected);
}

async function primaryFieldId(page: Page, databaseId: string): Promise<string> {
  return page.evaluate((id) => {
    const bridge = (window as any).__DASHBOARD_TEST__;
    const fields = bridge.byDatabase(id).databaseDoc.getMap('data').get('database').get('fields');
    const entries: [string, any][] = Array.from(fields.entries());

    return entries.find(([, field]) => field.get('is_primary'))?.[0] ?? '';
  }, databaseId);
}

/** Add a row through a grid widget's "New row" button and type its name into the new row. */
export async function addRowInWidget(page: Page, viewName: string, title: string) {
  const widget = widgetLocator(page, viewName);
  const database = fixtureDatabase(page, databaseForLabel(page, viewName));
  const viewId = namedView(page, viewName).viewId;
  const before = await browserRowIds(page, database.databaseId, viewId);
  const button = widget.getByTestId('grid-new-row');

  await button.scrollIntoViewIfNeeded();
  await button.click();
  let rowId = '';

  await expect
    .poll(
      async () => {
        rowId = (await browserRowIds(page, database.databaseId, viewId)).find((id) => !before.includes(id)) ?? '';
        return rowId;
      },
      { timeout: USE_CASE_TIMEOUT, message: 'waiting for the new row' }
    )
    .not.toBe('');
  const cell = widget.getByTestId(`grid-cell-${rowId}-${await primaryFieldId(page, database.databaseId)}`);
  // A filtered table opens the new row's page (its title focused) so the row can be filled in.
  const titleInput = page.getByTestId('row-title-input');

  await page.waitForTimeout(500);
  if (await titleInput.isVisible()) {
    await titleInput.click();
    await page.keyboard.type(title);
    await expect(titleInput).toContainText(title);
    await closeRowDetailWithEscape(page);
    await expect(rowPage(page)).toHaveCount(0, { timeout: USE_CASE_TIMEOUT });
  } else {
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    const input = cell.locator('input, textarea, [contenteditable="true"]').first();

    await expect(input).toBeVisible({ timeout: USE_CASE_TIMEOUT });
    await input.fill(title);
    await input.press('Enter');
  }

  database.rowIds[title] = rowId;
  await expect(cell).toContainText(title, { timeout: USE_CASE_TIMEOUT });
}

export function rowPage(scope: Page): Locator {
  return scope.locator('.MuiDialog-paper').filter({ has: scope.getByTestId('row-title-input') }).last();
}

/** Wait for a row page showing `title` (its title is a textarea, so compare values). */
export async function expectRowPage(scope: Page, title: string) {
  const titleInputs = scope.locator('.MuiDialog-paper').getByTestId('row-title-input');

  await expect(titleInputs.last()).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  await expect
    .poll(() => titleInputs.evaluateAll((inputs) => inputs.map((input) => (input as HTMLTextAreaElement).value)))
    .toContain(title);
}

/** Set a property on the open row page (select option, number, text or a date picked in its calendar). */
export async function setRowPageProperty(page: Page, property: string, value: string) {
  const dialog = rowPage(page);

  await expect(dialog).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  const label = dialog.locator('.property-label').filter({ hasText: new RegExp(`^\\s*${property}\\s*$`) }).first();
  const showHidden = dialog.getByRole('button', { name: /^Show \d+ hidden fields?$/ });

  await expect(label.or(showHidden).first()).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  // The view hides this property: reveal the hidden fields first, as a user would.
  if (!(await label.isVisible())) await showHidden.click();
  await expect(label).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  const cell = label.locator('xpath=following-sibling::*[1]');

  await cell.click();
  if (/^today/.test(value)) {
    const picker = page.getByTestId('datetime-picker-popover');

    await expect(picker).toBeVisible({ timeout: USE_CASE_TIMEOUT });
    await pickCalendarDay(page, relativeDayOffset(value), picker);
    await expect(cell).not.toHaveText(new RegExp(`^\\s*Add ${property}\\s*$`), { timeout: USE_CASE_TIMEOUT });
    if (await picker.isVisible()) await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    return;
  }

  const menu = page.getByTestId('select-option-menu');
  const input = cell.locator('input, textarea').first();

  await expect(menu.or(input).first()).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  if (await menu.isVisible()) {
    await chooseSelectOption(page, value);
    return;
  }

  await input.fill(value);
  await input.press('Enter');
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Pick a day in the open date picker, stepping months as needed. */
export async function pickCalendarDay(page: Page, dayOffset: number, scope?: Locator) {
  const target = new Date();

  target.setDate(target.getDate() + dayOffset);
  const picker = (scope ?? page).locator('.rdp').filter({ visible: true }).last();

  await expect(picker).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  const caption = `${MONTHS[target.getMonth()]} ${target.getFullYear()}`;

  for (let step = 0; step < 24; step += 1) {
    const shown = ((await picker.locator('.rdp-caption_label, [role="presentation"]').first().textContent()) ?? '').trim();

    if (shown.includes(caption)) break;
    const [shownMonth, shownYear] = shown.split(/\s+/);
    const shownIndex = Number(shownYear) * 12 + MONTHS.indexOf(shownMonth);
    const targetIndex = target.getFullYear() * 12 + target.getMonth();

    await picker.locator(targetIndex < shownIndex ? 'button[name="previous-month"]' : 'button[name="next-month"]').click();
  }

  const day = picker
    .locator('button[name="day"]:not(.day-outside), td[role="gridcell"]:not(.day-outside) button')
    .filter({ hasText: new RegExp(`^${target.getDate()}$`) })
    .first();

  await day.click();
}

// ---------------------------------------------------------------------------
// Global filters
// ---------------------------------------------------------------------------

/** Database names of the dashboard's widgets, in widget order. */
async function dashboardSourceDatabases(page: Page): Promise<string[]> {
  const world = dashboardWorld(page);
  const { rows } = await readDashboardSetting(page);
  const names: string[] = [];

  rows.forEach((row) =>
    row.widgets.forEach((widget) => {
      const database = Object.values(world.databases).find((candidate) => candidate.databaseId === widget.database_id);

      if (database && !names.includes(database.name)) names.push(database.name);
    })
  );
  return names;
}

function mappedTargets(page: Page) {
  return DashboardSelectors.globalFilterTargets(page).evaluateAll((targets) =>
    targets
      .filter((target) => (target.getAttribute('data-field-id') ?? '') !== '')
      .map((target) => ({
        databaseId: target.getAttribute('data-database-id') ?? '',
        fieldId: target.getAttribute('data-field-id') ?? '',
      }))
  );
}

/**
 * Start a global filter from "Filter multiple sources", pick the property type
 * of `property`, map every dashboard source that has a property of that name
 * (or the override) and remove the others.
 */
export async function startGlobalFilter(
  scope: Page,
  owner: Page,
  property: string,
  overrides: Record<string, string> = {}
) {
  const world = dashboardWorld(owner);
  const sources = await dashboardSourceDatabases(owner);
  const wanted = sources
    .map((name) => ({ database: fixtureDatabase(owner, name), property: overrides[name] ?? property }))
    .filter(({ database, property: name }) => Boolean(database.fieldIds[name]));

  if (wanted.length === 0) throw new Error(`No dashboard source has a "${property}" property`);
  const type = fieldTypeOf(owner, wanted[0].database, wanted[0].property);

  await DashboardSelectors.globalFilterButton(scope).click();
  const menu = DashboardSelectors.globalFilterMenu(scope);

  await expect(menu).toBeVisible();
  await DashboardSelectors.globalFilterAdd(scope).click();
  await DashboardSelectors.globalFilterPropertyOption(scope, type).click();
  await expect(scope.getByTestId('dashboard-global-filter-editor')).toBeVisible();
  await expect(DashboardSelectors.globalFilterTargets(scope).first()).toBeVisible({ timeout: USE_CASE_TIMEOUT });

  for (const { database, property: name } of wanted) {
    const fieldId = database.fieldIds[name];
    const target = DashboardSelectors.globalFilterTarget(scope, database.databaseId);

    if (!(await target.isVisible())) {
      await scope.getByTestId('dashboard-global-filter-add-source').click();
      await scope
        .locator(
          `[data-testid="dashboard-global-filter-add-source-option"][data-database-id="${database.databaseId}"]`
        )
        .click();
      await expect(target).toBeVisible();
    }

    if ((await target.getAttribute('data-field-id')) === fieldId) continue;
    await target.getByTestId('dashboard-global-filter-target-select').click();
    await scope
      .locator(`[data-testid="dashboard-global-filter-target-option"][data-field-id="${fieldId}"]`)
      .click();
    await expect(target).toHaveAttribute('data-field-id', fieldId);
  }

  const wantedIds = wanted.map(({ database }) => database.databaseId);

  for (const { databaseId } of await mappedTargets(scope)) {
    if (wantedIds.includes(databaseId)) continue;
    const target = DashboardSelectors.globalFilterTarget(scope, databaseId);

    await target.getByTestId('dashboard-global-filter-target-remove').click();
    await expect(target).toHaveCount(0);
  }

  await expect
    .poll(async () => (await mappedTargets(scope)).map((target) => target.databaseId).sort())
    .toEqual([...wantedIds].sort());
  void world;
  return type;
}

export async function toggleFilterOption(scope: Page, optionName: string) {
  const option = DashboardSelectors.globalFilterContent(scope).locator(
    `[data-testid="dashboard-global-filter-option"][data-option-id="${namedOptionId(optionName)}"]`
  );
  const checked = (await option.getAttribute('data-checked')) === 'true';

  await option.click();
  await expect(option).toHaveAttribute('data-checked', checked ? 'false' : 'true');
}

export async function chooseFilterCondition(scope: Page, label: string) {
  const trigger = DashboardSelectors.globalFilterCondition(scope);

  if (((await trigger.textContent()) ?? '').trim() === label) return;
  await trigger.click();
  await scope
    .getByTestId('dashboard-global-filter-condition-option')
    .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`), visible: true })
    .first()
    .click();
  await expect(trigger).toHaveText(label);
}

export async function finishGlobalFilter(scope: Page) {
  await DashboardSelectors.globalFilterDone(scope).click();
  await expect(DashboardSelectors.globalFilterMenu(scope)).toBeHidden();
}

export async function addSelectGlobalFilter(
  scope: Page,
  owner: Page,
  property: string,
  options: string,
  overrides: Record<string, string> = {}
) {
  await startGlobalFilter(scope, owner, property, overrides);
  await chooseFilterCondition(scope, 'Is');
  for (const option of splitList(options)) await toggleFilterOption(scope, option);
  await finishGlobalFilter(scope);
}

export async function addOnOrAfterDateFilter(page: Page, property: string, day: string) {
  await startGlobalFilter(page, page, property);
  await chooseFilterCondition(page, 'Is on or after');
  await page.getByTestId('dashboard-global-filter-date-trigger').click();
  await pickCalendarDay(page, relativeDayOffset(day));
  await expect(page.getByTestId('dashboard-global-filter-date-trigger')).not.toHaveText(/Type a value/);
  await finishGlobalFilter(page);
}

export async function removeGlobalFilter(scope: Page, name: string) {
  await openGlobalFilterChip(scope, name);
  await DashboardSelectors.globalFilterDelete(scope).click();
  await expect(DashboardSelectors.globalFilterMenu(scope)).toBeHidden();
}

export async function stopApplyingGlobalFilter(page: Page, name: string, databaseName: string) {
  await openGlobalFilterChip(page, name);
  const target = DashboardSelectors.globalFilterTarget(page, fixtureDatabase(page, databaseName).databaseId);

  await target.getByTestId('dashboard-global-filter-target-remove').click();
  await expect(target).toHaveCount(0);
  await closeGlobalFilterMenu(page);
}

export async function changeSelectGlobalFilter(scope: Page, name: string, option: string) {
  await openGlobalFilterChip(scope, name);
  const selected = await DashboardSelectors.globalFilterContent(scope)
    .locator('[data-testid="dashboard-global-filter-option"][data-checked="true"]')
    .evaluateAll((options) => options.map((element) => element.getAttribute('data-option-id') ?? ''));

  for (const optionId of selected) {
    if (optionId === namedOptionId(option)) continue;
    await DashboardSelectors.globalFilterContent(scope)
      .locator(`[data-testid="dashboard-global-filter-option"][data-option-id="${optionId}"]`)
      .click();
  }

  if (!selected.includes(namedOptionId(option))) await toggleFilterOption(scope, option);
  await closeGlobalFilterMenu(scope);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/** Invite a workspace member with read-only access to the use-case space. */
export async function inviteReadOnlyMember(page: Page, request: APIRequestContext) {
  return retryTransient('Inviting a read-only member', () => inviteDashboardMember(page, request, 'read-only'));
}

/** Open a use-case dashboard in the member's browser (reusing it when already open). */
export async function openDashboardForMember(page: Page, name: string, viewport?: { width: number; height: number }) {
  const world = dashboardWorld(page);
  const dashboard = activateDashboard(page, name);
  const member = world.member;

  if (!member) throw new Error('No member has been invited in this scenario');
  let scope: Page;

  const url = `/app/${world.workspaceId}/${fixtureDatabase(page, dashboard.host).pageId}?v=${dashboard.viewId}`;

  if (member.page) {
    scope = member.page;
    await scope.goto(url, { waitUntil: 'domcontentloaded' });
  } else {
    // Sign in on a desktop-sized window (the sign-in helper waits for the sidebar).
    scope = await openDashboardAsMember(page);
  }

  if (viewport) {
    await scope.setViewportSize(viewport);
    await scope.goto(url, { waitUntil: 'domcontentloaded' });
  }

  await expect(DashboardSelectors.view(scope)).toBeVisible({ timeout: FIXTURE_TIMEOUT });
  await waitForDashboardWidgets(scope, page);
  return scope;
}

export async function expectMemberViewMode(page: Page) {
  const member = memberPage(page);

  await expect(DashboardSelectors.view(member)).toBeVisible();
  await expect(DashboardSelectors.widgets(member).first()).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  await expect(DashboardSelectors.editButton(member)).toHaveCount(0);
  await expect(DashboardSelectors.doneButton(member)).toHaveCount(0);
  await expect(DashboardSelectors.widthHandles(member)).toHaveCount(0);
  await expect(DashboardSelectors.addWidgetButton(member).filter({ visible: true })).toHaveCount(0);
}

export async function expectLocalOnlyFilters(scope: Page) {
  await expect(DashboardSelectors.globalFilterLocalBadge(scope).first()).toBeVisible({ timeout: USE_CASE_TIMEOUT });
  await expect(DashboardSelectors.globalFilterLocalBadge(scope).first()).toContainText(/Only you see/);
  await expect(DashboardSelectors.globalFilterSaveForEverybody(scope)).toHaveCount(0);
}

export async function expectStackedWidgets(scope: Page) {
  await expect
    .poll(
      async () => {
        const boxes = await DashboardSelectors.widgets(scope).evaluateAll((widgets) =>
          widgets.map((widget) => {
            const rect = widget.getBoundingClientRect();

            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          })
        );
        const viewport = scope.viewportSize()?.width ?? 0;

        return (
          boxes.length > 1 &&
          boxes.every((box, index) => index === 0 || box.y >= boxes[index - 1].y + boxes[index - 1].height - 1) &&
          boxes.every((box) => Math.abs(box.x - boxes[0].x) < 2 && box.width > viewport * 0.6)
        );
      },
      { timeout: USE_CASE_TIMEOUT }
    )
    .toBe(true);
  expect(await scope.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
