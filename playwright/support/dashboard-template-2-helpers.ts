/**
 * Dashboard template scenarios, set 2 (`dashboard-usecases/content-calendar`,
 * `product-roadmap`, `agency-hub` and `inventory-reorder`): what those
 * templates need beyond the use-case helpers of `dashboard-usecase-helpers.ts`.
 *
 * - Seeding: property types the use-case tables do not know (URL, Checklist,
 *   Person, Relation, Rollup, Formula, Created by, Last edited by, a Number
 *   currency), rows with people, relations and checklists, select options
 *   with their own ids, and the richer view settings of the templates (min,
 *   max, average, median and count-values calculations, date grouping per
 *   week / month / relative date, Number, Checkbox and Checklist filters).
 *   Everything else goes through the use-case helpers, so a template world is
 *   a use-case world.
 * - The calendar, timeline and chart widgets as the templates drive them,
 *   global filters of every property type, the widget picker's no-nesting
 *   rule, dashboard tab copies and the cold-load cap (addendum A9).
 *
 * People are written "me" (the owner running the scenario) and "the
 * teammate" (the member a scenario invites); days are written "today",
 * "today - N" or "today + N".
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
import { readFileSync } from 'fs';

import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

import { DASHBOARD_LOADING } from '../../src/application/database-yjs/dashboard-loading';
import { CalculationType, DateGroupCondition } from '../../src/application/database-yjs/database.type';
import { CheckboxFilterCondition } from '../../src/application/database-yjs/fields/checkbox/checkbox.type';
import { ChecklistFilterCondition } from '../../src/application/database-yjs/fields/checklist/checklist.type';
import { DateFilterCondition } from '../../src/application/database-yjs/fields/date/date.type';
import { NumberFilterCondition } from '../../src/application/database-yjs/fields/number/number.type';
import { SelectOptionFilterCondition } from '../../src/application/database-yjs/fields/select-option/select_option.type';
import { TextFilterCondition } from '../../src/application/database-yjs/fields/text/text.type';
import { DatabaseViewLayout, ViewLayout } from '../../src/application/types';

import { TypeOptionUpdate, waitForTypeOptionSync, writeTypeOptions } from './chart-render-helpers';
import { chartPanel } from './chart-settings-helpers';
import {
  fieldRowsOf,
  pickGlobalFilterProperty,
  toggleGlobalFilterOptionByName,
} from './dashboard-global-filter-helpers';
import { loadStats } from './dashboard-loading-helpers';
import { switchViewToDashboard } from './dashboard-owned-views-helpers';
import { apiGet, clearCachedDatabaseStorage, escapeRegExp } from './dashboard-shared-helpers';
import {
  addGlobalFilter,
  allWidgets,
  chooseWidgetMenuAction,
  createDatabaseViewThroughApi,
  DashboardSelectors,
  dashboardWorld,
  DashboardWorld,
  databaseForLabel,
  FieldSpec,
  FieldType,
  fillGlobalFilterText,
  fixtureDatabase,
  FixtureDatabase,
  inviteDashboardMember,
  KnownWidget,
  memberPage,
  namedOptionId,
  openDatabasePage,
  readDashboardSetting,
  readDatabaseViews,
  splitList,
  widgetLocator,
} from './dashboard-test-helpers';
import {
  activateDashboard,
  addRowsThroughApi,
  addUseCaseDatabase,
  ApiRow,
  barChartValues,
  chooseFilterCondition,
  configureView,
  editWidgetCell,
  finishGlobalFilter,
  namedDashboard,
  namedView,
  namedWidget,
  openUseCaseDashboard,
  pickCalendarDay,
  relativeDayOffset,
  rememberFieldTypes,
  rememberSelectOptions,
  rowIdByTitle,
  rowPage,
  scenarioState,
  startOfDayUnix,
  USE_CASE_TIMEOUT,
  ViewConfig,
  ViewFilterSpec,
  waitForViewSync,
  widgetTitles,
} from './dashboard-usecase-helpers';
import { closeRowDetailWithEscape } from './row-detail-helpers';
import { DatabaseViewSelectors, ModalSelectors } from './selectors';
import { dragBy } from './timeline-test-helpers';

const WAIT = { timeout: USE_CASE_TIMEOUT };
/** A cold dashboard over four databases finishes loading within this. */
const COLD_LOAD_TIMEOUT_MS = 120_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Scenario state
// ---------------------------------------------------------------------------

/** A person of the scenario, as the profile API and the people pickers know them. */
export interface TemplatePerson {
  uuid: string;
  email: string;
  name: string;
}

export type PersonName = 'me' | 'the teammate';

/** A property of a template database, as its table described it. */
export interface TemplateField {
  name: string;
  type: FieldType;
  /** Select option names. */
  options?: string[];
  /** Relation: the related database. */
  relatedDatabase?: string;
  /** Number: the `NumberFormat` id. */
  numberFormat?: number;
  /** Formula: the expression. */
  expression?: string;
  /** Rollup: the relation property, the related property and the calculation. */
  rollup?: { relation: string; target: string; calculation: CalculationType };
}

interface TemplateState {
  /** Database → property → its description. */
  fields: Record<string, Record<string, TemplateField>>;
  /** Databases whose select options have their own ids: the id prefix. */
  optionPrefixes: Record<string, string>;
  /** Seeded (and dragged) dates as day offsets: database → row title → property → offset. */
  dayOffsets: Record<string, Record<string, Record<string, number>>>;
  /** Timeline views: view name → the start and end properties. */
  timelines: Record<string, { start: string; end: string }>;
  /** Calendar views: view name → the date property. */
  calendars: Record<string, string>;
  people: Partial<Record<PersonName, TemplatePerson>>;
}

const states = new WeakMap<DashboardWorld, TemplateState>();

function templateState(page: Page): TemplateState {
  const world = dashboardWorld(page);
  let state = states.get(world);

  if (!state) {
    state = { fields: {}, optionPrefixes: {}, dayOffsets: {}, timelines: {}, calendars: {}, people: {} };
    states.set(world, state);
  }

  return state;
}

function slug(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function exactText(text: string) {
  return new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);
}

type ApiError = Error & { message: string };

/** Retry an API write the server refuses while its folder projection catches up (`"code":-5`). */
async function retryTransient<T>(label: string, action: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!((error as ApiError).message ?? '').includes('"code":-5')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 + attempt * 500));
    }
  }

  throw new Error(`${label} kept failing: ${(lastError as ApiError)?.message}`);
}

/** `today + N` as local noon, as the web stores a picked date. */
function localNoonIso(dayOffset: number) {
  const date = new Date();

  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString();
}

/** The local calendar day `dayOffset` days from today. */
function localDay(dayOffset: number): Date {
  const date = new Date();

  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date;
}

/** `YYYY-MM-DD` of a local day, as FullCalendar's `data-date`. */
function isoLocalDay(dayOffset: number): string {
  const date = localDay(dayOffset);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Days from today to the local calendar day of `instant`. */
function dayOffsetOf(instant: Date): number {
  const day = new Date(instant);

  day.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - localDay(0).getTime()) / DAY_MS);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

async function profileOf(request: APIRequestContext, token: string): Promise<TemplatePerson> {
  const profile = await apiGet<{ uuid: string; email: string; name?: string | null }>(
    request,
    token,
    '/api/user/profile'
  );

  return { uuid: profile.uuid, email: profile.email, name: profile.name || profile.email };
}

function personName(text: string): PersonName {
  const name = text.trim();

  if (name !== 'me' && name !== 'the teammate') throw new Error(`People are "me" or "the teammate", got "${text}"`);
  return name;
}

/** "me" or "the teammate", read from the profile API once per scenario. */
export async function templatePerson(page: Page, request: APIRequestContext, who: string): Promise<TemplatePerson> {
  const name = personName(who);
  const state = templateState(page);
  const known = state.people[name];

  if (known) return known;
  const world = dashboardWorld(page);
  const token = name === 'me' ? world.owner.accessToken : world.member?.session.accessToken;

  if (!token) throw new Error('No teammate has been invited in this scenario');
  const person = await profileOf(request, token);

  state.people[name] = person;
  return person;
}

/** Invite a workspace member who can edit the use-case space; they are "the teammate". */
export async function inviteEditingTeammate(page: Page, request: APIRequestContext, space: string) {
  const world = dashboardWorld(page);

  // The use-case space is named after the use case.
  expect(space).toBe(world.spaceName);
  const member = await retryTransient('Inviting an editing member', () =>
    inviteDashboardMember(page, request, 'read-and-write')
  );

  templateState(page).people['the teammate'] = await profileOf(request, member.session.accessToken);
}

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

const FIELD_TYPES: Record<string, FieldType> = {
  Text: FieldType.RichText,
  Number: FieldType.Number,
  Date: FieldType.DateTime,
  Select: FieldType.SingleSelect,
  Checkbox: FieldType.Checkbox,
  URL: FieldType.URL,
  Checklist: FieldType.Checklist,
  Person: FieldType.Person,
  Relation: FieldType.Relation,
  Rollup: FieldType.Rollup,
  Formula: FieldType.Formula,
  'Created by': FieldType.CreatedBy,
  'Last edited by': FieldType.LastEditedBy,
  'Created time': FieldType.CreatedTime,
  'Last edited time': FieldType.LastEditedTime,
};

/** The Number formats a template names (shared `NumberFormat` ids). */
const NUMBER_FORMATS: Record<string, number> = {
  'US dollar': 1,
  'Canadian dollar': 2,
  Euro: 4,
  Pound: 5,
  Yen: 6,
  Percent: 36,
};

const ROLLUP_CALCULATIONS: Record<string, CalculationType> = {
  average: CalculationType.Average,
  max: CalculationType.Max,
  median: CalculationType.Median,
  min: CalculationType.Min,
  sum: CalculationType.Sum,
  count: CalculationType.Count,
};

/** Types whose cells the app computes: a template row never gives them a value. */
const COMPUTED_TYPES: ReadonlySet<FieldType> = new Set([
  FieldType.Formula,
  FieldType.Rollup,
  FieldType.CreatedBy,
  FieldType.LastEditedBy,
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
]);

/**
 * `| property | type | options |`: the options column holds a select's
 * options, a Number's currency ("US dollar"), a Relation's database, a
 * Formula's expression or a Rollup's "Relation: Property, calculation".
 */
export function parseTemplateProperties(rows: Record<string, string>[]): TemplateField[] {
  return rows.map((row) => {
    const name = row.property.trim();
    const type = FIELD_TYPES[row.type.trim()];
    const options = (row.options ?? '').trim();

    if (type === undefined) throw new Error(`Unknown property type "${row.type}"`);
    const field: TemplateField = { name, type };

    if (type === FieldType.SingleSelect) field.options = splitList(options);
    if (type === FieldType.Number && options) {
      field.numberFormat = NUMBER_FORMATS[options];
      if (field.numberFormat === undefined) throw new Error(`Unknown number format "${options}"`);
    }

    if (type === FieldType.Relation) {
      if (!options) throw new Error(`The relation "${name}" names no database`);
      field.relatedDatabase = options;
    }

    if (type === FieldType.Formula) {
      if (!options) throw new Error(`The formula "${name}" has no expression`);
      field.expression = options;
    }

    if (type === FieldType.Rollup) {
      const match = /^(.+?):\s*(.+?),\s*(\w+)$/.exec(options);
      const calculation = match ? ROLLUP_CALCULATIONS[match[3].toLowerCase()] : undefined;

      if (!match || calculation === undefined) {
        throw new Error(`A rollup is written "Relation: Property, calculation", got "${options}"`);
      }

      field.rollup = { relation: match[1], target: match[2], calculation };
    }

    return field;
  });
}

/** The type of a template property ("Name" is the primary text). */
export function templateFieldType(page: Page, database: string, property: string): FieldType {
  if (property === 'Name') return FieldType.RichText;
  const field = templateState(page).fields[database]?.[property];

  if (!field) throw new Error(`"${database}" has no "${property}" property`);
  return field.type;
}

function fieldIdOf(database: FixtureDatabase, property: string): string {
  const fieldId = database.fieldIds[property];

  if (!fieldId) throw new Error(`"${database.name}" has no "${property}" property`);
  return fieldId;
}

/** The type options the server cannot be given at creation: currencies, relations, formulas and rollups. */
function typeOptionUpdates(page: Page, database: FixtureDatabase, fields: TemplateField[]): TypeOptionUpdate[] {
  return fields.flatMap((field): TypeOptionUpdate[] => {
    const fieldId = fieldIdOf(database, field.name);

    if (field.numberFormat !== undefined) {
      return [{ fieldId, type: field.type, entries: { format: field.numberFormat } }];
    }

    if (field.relatedDatabase) {
      const related = fixtureDatabase(page, field.relatedDatabase);

      return [
        {
          fieldId,
          type: field.type,
          entries: { database_id: related.databaseId, is_two_way: false, source_limit: 0, target_limit: 0 },
        },
      ];
    }

    if (field.expression) return [{ fieldId, type: field.type, entries: { expression: field.expression, format: 0 } }];
    if (field.rollup) {
      const relation = fields.find((candidate) => candidate.name === field.rollup?.relation);

      if (!relation?.relatedDatabase) {
        throw new Error(`The rollup "${field.name}" needs a relation of "${database.name}"`);
      }

      const related = fixtureDatabase(page, relation.relatedDatabase);

      return [
        {
          fieldId,
          type: field.type,
          entries: {
            relation_field_id: fieldIdOf(database, relation.name),
            target_field_id: fieldIdOf(related, field.rollup.target),
            calculation_type: field.rollup.calculation,
            show_as: 0,
            condition_value: '',
          },
        },
      ];
    }

    return [];
  });
}

/**
 * Create a template database: its properties through the use-case helper
 * (which prunes the server's template data), then the type options the
 * creation request cannot carry, written in the browser and waited for on
 * the server.
 */
export async function addTemplateDatabase(
  page: Page,
  request: APIRequestContext,
  name: string,
  rows: Record<string, string>[],
  privateSpace = false
) {
  const fields = parseTemplateProperties(rows);
  const specs: FieldSpec[] = fields.map((field) => ({
    name: field.name,
    type: field.type,
    options: field.type === FieldType.SingleSelect ? field.options ?? [] : undefined,
  }));

  await addUseCaseDatabase(page, request, name, specs, privateSpace);
  rememberFieldTypes(page, name, specs);
  rememberSelectOptions(page, name, specs);
  templateState(page).fields[name] = Object.fromEntries(fields.map((field) => [field.name, field]));
  const database = fixtureDatabase(page, name);
  const updates = typeOptionUpdates(page, database, fields);

  if (updates.length === 0) return;
  await openDatabasePage(page, name, database.views.Grid);
  await writeTypeOptions(page, database.databaseId, updates);
  await waitForTypeOptionSync(page, request, database.databaseId, updates);
}

/** The id of a select option of `database`: its own id, or the id every database shares for that name. */
export function templateOptionId(page: Page, database: string, name: string): string {
  const prefix = templateState(page).optionPrefixes[database];

  return prefix ? `${prefix}-${slug(name)}` : namedOptionId(name);
}

async function readSelectContent(page: Page, databaseId: string, fieldId: string) {
  return page.evaluate(
    ({ databaseId, fieldId, type }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const field = bridge.byDatabase(databaseId).databaseDoc.getMap('data').get('database').get('fields').get(fieldId);
      const content = field?.get('type_option')?.get(String(type))?.get('content');

      return (content ? JSON.parse(content) : { options: [] }) as {
        options: { id: string; name: string; color: string }[];
        disable_color?: boolean;
      };
    },
    { databaseId, fieldId, type: FieldType.SingleSelect }
  );
}

/**
 * Give every select option of `databaseName` its own id, as a database made
 * separately has (the use-case databases share one id per option name).
 * Runs before the rows are added: the server maps their option names to the
 * new ids.
 */
export async function giveOwnOptionIds(page: Page, request: APIRequestContext, databaseName: string) {
  const state = templateState(page);
  const database = fixtureDatabase(page, databaseName);
  const selects = Object.values(state.fields[databaseName] ?? {}).filter(
    (field) => field.type === FieldType.SingleSelect
  );

  if (selects.length === 0) throw new Error(`"${databaseName}" has no select property`);
  expect(Object.keys(database.rowIds), 'own option ids are given before the rows are added').toEqual([]);
  state.optionPrefixes[databaseName] = slug(databaseName);
  await openDatabasePage(page, databaseName, database.views.Grid);
  const updates: TypeOptionUpdate[] = [];

  for (const field of selects) {
    const fieldId = fieldIdOf(database, field.name);
    const content = await readSelectContent(page, database.databaseId, fieldId);
    const options = content.options.map((option) => ({
      ...option,
      id: templateOptionId(page, databaseName, option.name),
    }));

    updates.push({
      fieldId,
      type: FieldType.SingleSelect,
      entries: { content: JSON.stringify({ ...content, options }) },
    });
  }

  await writeTypeOptions(page, database.databaseId, updates);
  await waitForTypeOptionSync(page, request, database.databaseId, updates);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** `[x] Counted, [ ] Inspected` → a checklist cell (option ids are stable per item name). */
function checklistCell(text: string) {
  const items = splitList(text).map((item) => {
    const match = /^\[( |x)\]\s*(.+)$/i.exec(item);

    if (!match) throw new Error(`Checklist items are written "[x] Done" or "[ ] To do", got "${item}"`);
    return { id: `cl-${slug(match[2])}`, name: match[2].trim(), done: match[1].toLowerCase() === 'x' };
  });

  return {
    options: items.map(({ id, name }) => ({ id, name, color: 'Purple' })),
    selected_option_ids: items.filter((item) => item.done).map((item) => item.id),
  };
}

/**
 * Template table rows (`| Name | Status | ... |`), each value typed by its
 * property: people as "me" / "the teammate", relations as row titles of the
 * related database, checklists as "[x] item, [ ] item", dates as day offsets.
 */
export async function addTemplateRows(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  rows: Record<string, string>[]
) {
  const state = templateState(page);
  const offsets = (state.dayOffsets[databaseName] ??= {});
  const apiRows: ApiRow[] = [];

  for (const row of rows) {
    const title = row.Name.trim();
    const cells: Record<string, unknown> = {};

    for (const [property, raw] of Object.entries(row)) {
      const value = raw.trim();

      if (!value) continue;
      const type = templateFieldType(page, databaseName, property);

      if (COMPUTED_TYPES.has(type)) throw new Error(`"${property}" is computed: a template row gives it no value`);
      if (type === FieldType.Number) {
        const number = Number(value);

        if (!Number.isFinite(number)) throw new Error(`"${value}" is not a number`);
        cells[property] = number;
      } else if (type === FieldType.DateTime) {
        const offset = relativeDayOffset(value);

        cells[property] = localNoonIso(offset);
        (offsets[title] ??= {})[property] = offset;
      } else if (type === FieldType.Checkbox) {
        cells[property] = /^(yes|true|checked)$/i.test(value);
      } else if (type === FieldType.Person) {
        const people = await Promise.all(splitList(value).map((who) => templatePerson(page, request, who)));

        cells[property] = people.map((person) => person.uuid);
      } else if (type === FieldType.Relation) {
        const related = fixtureDatabase(page, state.fields[databaseName][property].relatedDatabase as string);

        cells[property] = {
          row_ids: splitList(value).map((relatedTitle) => {
            const rowId = related.rowIds[relatedTitle];

            if (!rowId) throw new Error(`"${related.name}" has no "${relatedTitle}" row`);
            return rowId;
          }),
        };
      } else if (type === FieldType.Checklist) {
        cells[property] = checklistCell(value);
      } else {
        cells[property] = value;
      }
    }

    // People, relations and checklists are JSON cells: the Cloud API converts them by property type.
    apiRows.push({ title, cells: cells as ApiRow['cells'] });
  }

  await addRowsThroughApi(page, request, databaseName, apiRows);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

interface TemplateLayout {
  folderLayout: number;
  databaseLayout: DatabaseViewLayout;
  chartType?: number;
}

/** The view layouts of the template tables (the use-case table's names). */
const LAYOUTS: Record<string, TemplateLayout> = {
  Grid: { folderLayout: ViewLayout.Grid, databaseLayout: DatabaseViewLayout.Grid },
  Board: { folderLayout: ViewLayout.Board, databaseLayout: DatabaseViewLayout.Board },
  Calendar: { folderLayout: ViewLayout.Calendar, databaseLayout: DatabaseViewLayout.Calendar },
  'Bar chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: 0 },
  'Horizontal bar chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: 2 },
  'Line chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: 1 },
  'Donut chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: 3 },
  'Number chart': { folderLayout: ViewLayout.Chart, databaseLayout: DatabaseViewLayout.Chart, chartType: 4 },
  List: { folderLayout: ViewLayout.List, databaseLayout: DatabaseViewLayout.List },
  Gallery: { folderLayout: ViewLayout.Gallery, databaseLayout: DatabaseViewLayout.Gallery },
  Timeline: { folderLayout: ViewLayout.Timeline, databaseLayout: DatabaseViewLayout.Timeline },
  Dashboard: { folderLayout: ViewLayout.Dashboard, databaseLayout: DatabaseViewLayout.Dashboard },
};

/** Chart calculations by the words the settings use (`ChartAggregationType`). */
const CHART_CALCULATIONS: Record<string, number> = {
  count: 0,
  sum: 1,
  average: 2,
  min: 3,
  max: 4,
  median: 5,
  'count unique values': 6,
  'count values': 7,
};

const DATE_GROUPING: Record<string, DateGroupCondition> = {
  day: DateGroupCondition.Day,
  week: DateGroupCondition.Week,
  month: DateGroupCondition.Month,
  year: DateGroupCondition.Year,
  'relative date': DateGroupCondition.Relative,
};

/** A view's settings: the use-case config plus the chart's date grouping. */
export interface TemplateViewSettings {
  config: ViewConfig;
  dateCondition?: DateGroupCondition;
  timeline?: { start: string; end: string };
  /** A calendar's date property. */
  calendar?: string;
}

/** One `where` clause, by the property's type. */
function parseTemplateClause(page: Page, databaseName: string, clause: string): ViewFilterSpec {
  const text = clause.trim();
  const database = fixtureDatabase(page, databaseName);
  const match =
    /^(.+?) is (not) (.+)$/.exec(text) ??
    /^(.+?) is (empty|checked|unchecked|complete|incomplete|today|before today)()$/.exec(text) ??
    /^(.+?) is (less than|greater than) (.+)$/.exec(text) ??
    /^(.+?) (contains) (.+)$/.exec(text) ??
    /^(.+?) is ()(.+)$/.exec(text);

  if (!match) throw new Error(`Cannot read the filter "${text}"`);
  const [, property, kind, value] = match;
  const fieldType = templateFieldType(page, databaseName, property);
  const fieldId = fieldIdOf(database, property);
  const filter = (condition: number, content = ''): ViewFilterSpec => ({ fieldId, fieldType, condition, content });
  const unsupported = () => new Error(`Unsupported filter "${text}"`);

  switch (fieldType) {
    case FieldType.DateTime:
      if (kind === 'empty') return filter(DateFilterCondition.DateStartIsEmpty);
      if (kind === 'today') return filter(DateFilterCondition.DateStartsToday);
      if (kind === 'before today') {
        return filter(DateFilterCondition.DateStartsBefore, JSON.stringify({ timestamp: startOfDayUnix() }));
      }

      throw unsupported();
    case FieldType.SingleSelect: {
      const ids = splitList(value)
        .map((name) => templateOptionId(page, databaseName, name))
        .join(',');

      if (kind === 'empty') return filter(SelectOptionFilterCondition.OptionIsEmpty);
      if (kind === 'not') return filter(SelectOptionFilterCondition.OptionIsNot, ids);
      if (kind === '') return filter(SelectOptionFilterCondition.OptionIs, ids);
      throw unsupported();
    }

    case FieldType.RichText:
    case FieldType.URL:
      if (kind === 'empty') return filter(TextFilterCondition.TextIsEmpty);
      if (kind === 'not') return filter(TextFilterCondition.TextIsNot, value);
      if (kind === 'contains') return filter(TextFilterCondition.TextContains, value);
      if (kind === '') return filter(TextFilterCondition.TextIs, value);
      throw unsupported();
    case FieldType.Number:
      if (kind === 'empty') return filter(NumberFilterCondition.NumberIsEmpty);
      if (kind === 'less than') return filter(NumberFilterCondition.LessThan, value);
      if (kind === 'greater than') return filter(NumberFilterCondition.GreaterThan, value);
      if (kind === 'not') return filter(NumberFilterCondition.NotEqual, value);
      if (kind === '') return filter(NumberFilterCondition.Equal, value);
      throw unsupported();
    case FieldType.Checkbox:
      if (kind === 'checked') return filter(CheckboxFilterCondition.IsChecked);
      if (kind === 'unchecked') return filter(CheckboxFilterCondition.IsUnChecked);
      throw unsupported();
    case FieldType.Checklist:
      if (kind === 'complete') return filter(ChecklistFilterCondition.IsComplete);
      if (kind === 'incomplete') return filter(ChecklistFilterCondition.IsIncomplete);
      throw unsupported();
    default:
      throw unsupported();
  }
}

const CHART_SETTINGS =
  /^(?:(count)|(count unique values|count values|sum|average|median|min|max) of (.+?))(?: by (.+?))?(?: per (day|week|month|year|relative date))?(?:, group by (.+?))?(?:, (stacked|grouped|percent))?$/;

/**
 * The settings mini-language of the template view tables, a superset of the
 * use-case one: a chart is `count`, `count values of P`, `count unique values
 * of P`, `sum|average|median|min|max of P`, then `by Q`, `per day|week|month|
 * year|relative date`, `, group by R` and `, stacked|grouped|percent`; any
 * view can add `where …` (clauses joined with ` and `); other layouts take
 * `sorted by P ascending|descending`, `grouped by P`, `by Date` (calendar)
 * or `from Start to End` (timeline).
 */
export function parseTemplateViewSettings(
  page: Page,
  databaseName: string,
  layoutName: string,
  text: string
): TemplateViewSettings {
  const database = fixtureDatabase(page, databaseName);
  const layout = LAYOUTS[layoutName];

  if (!layout) throw new Error(`Unknown view layout "${layoutName}"`);
  const settings: TemplateViewSettings = { config: { layout: layout.databaseLayout, filters: [], sorts: [] } };
  let rest = text.trim();
  const whereIndex = rest.search(/(^|\s)where /);

  if (whereIndex !== -1) {
    const where = rest
      .slice(whereIndex)
      .trim()
      .replace(/^where /, '');

    settings.config.filters = where.split(' and ').map((clause) => parseTemplateClause(page, databaseName, clause));
    rest = rest.slice(0, whereIndex).trim();
  }

  if (layout.chartType !== undefined) {
    const match = CHART_SETTINGS.exec(rest);

    if (!match) throw new Error(`Cannot read the chart settings "${text}"`);
    const [, count, calculation, valueProperty, byProperty, per, groupByProperty, groupStyle] = match;

    settings.config.chart = {
      chartType: layout.chartType,
      aggregationType: count ? CHART_CALCULATIONS.count : CHART_CALCULATIONS[calculation],
      yFieldId: valueProperty ? fieldIdOf(database, valueProperty) : '',
      xFieldId: byProperty ? fieldIdOf(database, byProperty) : '',
      ...(groupByProperty ? { groupByFieldId: fieldIdOf(database, groupByProperty) } : {}),
      ...(groupStyle ? { groupStyle: groupStyle as 'stacked' | 'grouped' | 'percent' } : {}),
    };
    if (layout.chartType !== 4 && !byProperty) throw new Error(`"${layoutName}" needs "by <property>": "${text}"`);
    if (per) settings.dateCondition = DATE_GROUPING[per];
    return settings;
  }

  if (!rest) return settings;
  let match = /^sorted by (.+) (ascending|descending)$/.exec(rest);

  if (match) {
    settings.config.sorts.push({ fieldId: fieldIdOf(database, match[1]), condition: match[2] === 'ascending' ? 0 : 1 });
    return settings;
  }

  match = /^grouped by (.+)$/.exec(rest);
  if (match) {
    const property = match[1];
    const options = templateState(page).fields[databaseName]?.[property]?.options ?? [];
    const fieldId = fieldIdOf(database, property);

    settings.config.group = {
      fieldId,
      fieldType: templateFieldType(page, databaseName, property),
      columnIds: [fieldId, ...options.map((name) => templateOptionId(page, databaseName, name))],
    };
    return settings;
  }

  match = /^from (.+) to (.+)$/.exec(rest);
  if (match) {
    settings.config.timeline = { fieldId: fieldIdOf(database, match[1]), endFieldId: fieldIdOf(database, match[2]) };
    settings.timeline = { start: match[1], end: match[2] };
    return settings;
  }

  match = /^by (.+)$/.exec(rest);
  if (match) {
    settings.config.calendarFieldId = fieldIdOf(database, match[1]);
    settings.calendar = match[1];
    return settings;
  }

  throw new Error(`Cannot read the view settings "${text}"`);
}

/** Write a view's settings (`configureView`), then the chart keys the use-case config has no word for. */
async function applyTemplateView(page: Page, databaseId: string, viewId: string, settings: TemplateViewSettings) {
  await configureView(page, databaseId, viewId, settings.config);
  if (settings.dateCondition === undefined) return;
  await page.evaluate(
    ({ databaseId, viewId, dateCondition }) => {
      const doc = (window as any).__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc;
      const chart = doc.getMap('data').get('database').get('views').get(viewId).get('layout_settings').get('3');

      doc.transact(() => chart.set('date_condition', dateCondition));
    },
    { databaseId, viewId, dateCondition: settings.dateCondition }
  );
}

/** Create the views of a template table, after the database's last view, and wait for the server to hold them. */
export async function addTemplateViews(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  rows: Record<string, string>[]
) {
  const world = dashboardWorld(page);
  const state = scenarioState(page);
  const database = fixtureDatabase(page, databaseName);
  const created: { viewId: string; settings: TemplateViewSettings }[] = [];

  await openDatabasePage(page, databaseName, database.views.Grid);
  for (const row of rows) {
    const name = row.view.trim();
    const layoutName = row.layout.trim();
    const settings = parseTemplateViewSettings(page, databaseName, layoutName, row.settings ?? '');
    const viewId = await retryTransient(`Creating the "${name}" view`, () =>
      createDatabaseViewThroughApi(page, request, {
        database: databaseName,
        name,
        folderLayout: LAYOUTS[layoutName].folderLayout,
        prevViewId: state.lastViewIds[databaseName],
      })
    );

    state.lastViewIds[databaseName] = viewId;
    await applyTemplateView(page, database.databaseId, viewId, settings);
    created.push({ viewId, settings });
    state.views[name] = { name, viewId, database: databaseName, layout: layoutName };
    world.viewsByName = { ...world.viewsByName, [name]: { viewId, database: databaseName } };
    if (settings.timeline) templateState(page).timelines[name] = settings.timeline;
    if (settings.calendar) templateState(page).calendars[name] = settings.calendar;
  }

  await waitForViewSync(
    page,
    request,
    databaseName,
    created.map(({ viewId }) => viewId),
    async () => {
      for (const { viewId, settings } of created) await applyTemplateView(page, database.databaseId, viewId, settings);
    }
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const EN_TRANSLATIONS = JSON.parse(
  readFileSync(new URL('../../src/@types/translations/en.json', import.meta.url), 'utf8')
) as { board: { dateCondition: { weekOf: string } } };

function utcFormat(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(
    new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  );
}

/** The chart label of the week (Monday to Sunday) holding `today + offset`: "Week of Mar 9 - Mar 15, 2026". */
export function weekLabel(dayOffset: number): string {
  const day = localDay(dayOffset);
  const monday = new Date(day);

  monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  const sunday = new Date(monday);

  sunday.setDate(monday.getDate() + 6);
  const full = { year: 'numeric', month: 'short', day: 'numeric' } as const;
  const start = utcFormat(
    monday,
    monday.getFullYear() === sunday.getFullYear() ? { month: 'short', day: 'numeric' } : full
  );

  return [start, utcFormat(sunday, full)].reduce(
    (text, value) => text.replace('{}', () => value),
    EN_TRANSLATIONS.board.dateCondition.weekOf
  );
}

/** The chart label of the month holding `today + offset`: "Nov 2026". */
export function monthLabel(dayOffset: number): string {
  return utcFormat(localDay(dayOffset), { year: 'numeric', month: 'short' });
}

/** A chart label as a template writes it: "week of today + 7", "month of today - 40", or the label itself. */
export function resolveChartLabel(label: string): string {
  const match = /^(week|month) of (today(?:\s*[+-]\s*\d+)?)$/.exec(label.trim());

  if (!match) return label.trim();
  const offset = relativeDayOffset(match[2]);

  return match[1] === 'week' ? weekLabel(offset) : monthLabel(offset);
}

/** Category → raw value of any bar, line or donut chart widget, from its hidden data table. */
export async function expectChartValues(page: Page, viewName: string, expected: Record<string, number>) {
  const widget = widgetLocator(page, viewName);

  await expect(widget.locator('.recharts-wrapper')).toBeVisible(WAIT);
  await expect.poll(() => barChartValues(widget), WAIT).toEqual(expected);
}

/** A chart grouped by a person property: one category per person, labelled by name (or email). */
export async function expectChartPeopleValues(
  page: Page,
  request: APIRequestContext,
  viewName: string,
  expected: Partial<Record<PersonName, number>>
) {
  const people = await Promise.all(
    (Object.keys(expected) as PersonName[]).map(async (who) => [who, await templatePerson(page, request, who)] as const)
  );
  const widget = widgetLocator(page, viewName);

  await expect(widget.locator('.recharts-wrapper')).toBeVisible(WAIT);
  await expect
    .poll(async () => {
      const values = await barChartValues(widget);

      return Object.fromEntries(
        Object.entries(values).map(([label, value]) => {
          const person = people.find(([, candidate]) => label === candidate.name || label === candidate.email);

          return [person ? person[0] : label, value];
        })
      );
    }, WAIT)
    .toEqual(expected);
}

/** The property names the open "What to show" page of the chart settings lists (in view order). */
export async function chartFieldNames(page: Page): Promise<string[]> {
  return chartPanel(page)
    .locator('[data-field-name]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-field-name') ?? ''));
}

// ---------------------------------------------------------------------------
// Calendar widgets
// ---------------------------------------------------------------------------

function calendarDayCell(widget: Locator, dayOffset: number): Locator {
  return widget.locator(`.fc-daygrid-day[data-date="${isoLocalDay(dayOffset)}"]`);
}

/** Step a calendar widget's month until it shows the day `today + offset`, and return that day's cell. */
export async function showCalendarDay(page: Page, viewName: string, dayOffset: number): Promise<Locator> {
  const widget = widgetLocator(page, viewName);
  const cell = calendarDayCell(widget, dayOffset);
  const days = widget.locator('.fc-daygrid-day[data-date]');
  const target = isoLocalDay(dayOffset);

  await expect(days.first()).toBeVisible(WAIT);
  for (let step = 0; step < 24 && (await cell.count()) === 0; step += 1) {
    const first = (await days.first().getAttribute('data-date')) ?? '';

    await widget.getByTestId(target < first ? 'calendar-prev-button' : 'calendar-next-button').click();
    await expect(days.first()).not.toHaveAttribute('data-date', first, WAIT);
  }

  await expect(cell, `the "${viewName}" widget never showed ${target}`).toHaveCount(1);
  await cell.scrollIntoViewIfNeeded();
  return cell;
}

function calendarEvent(cell: Locator, title: string): Locator {
  return cell.locator('.fc-event').filter({ hasText: title });
}

export async function expectCalendarEvent(page: Page, viewName: string, title: string, day: string) {
  const cell = await showCalendarDay(page, viewName, relativeDayOffset(day));

  await expect(calendarEvent(cell, title).first()).toBeVisible(WAIT);
}

export async function expectNoCalendarEvent(page: Page, viewName: string, day: string) {
  const cell = await showCalendarDay(page, viewName, relativeDayOffset(day));

  await expect(cell.locator('.fc-event')).toHaveCount(0, WAIT);
}

/**
 * Drag an event to the day `today + to` the way a user does in a month grid
 * (FullCalendar needs a jiggle past its drag threshold, then a stepped move).
 * Both days must be on the grid of the event's month: the next day always is.
 */
export async function dragCalendarEvent(page: Page, viewName: string, title: string, to: number) {
  const from = calendarDayOf(page, viewName, title);
  const source = await showCalendarDay(page, viewName, from);
  const target = calendarDayCell(widgetLocator(page, viewName), to);
  const event = calendarEvent(source, title).first();

  await expect(event).toBeVisible(WAIT);
  await expect(target, `day ${isoLocalDay(to)} is not on the grid that shows ${isoLocalDay(from)}`).toHaveCount(1);
  const eventBox = await event.boundingBox();
  const targetBox = await target.boundingBox();

  if (!eventBox || !targetBox) throw new Error('The event or the target day is not visible');
  const start = { x: eventBox.x + eventBox.width / 2, y: eventBox.y + eventBox.height / 2 };
  const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y + 6, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 25 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect(calendarEvent(target, title).first()).toBeVisible(WAIT);
  rememberCalendarDay(page, viewName, title, to);
}

/** The date property of a calendar view of this scenario. */
function calendarProperty(page: Page, viewName: string): string {
  const property = templateState(page).calendars[viewName];

  if (!property) throw new Error(`"${viewName}" is not a calendar of this scenario`);
  return property;
}

function rememberCalendarDay(page: Page, viewName: string, title: string, dayOffset: number) {
  const offsets = (templateState(page).dayOffsets[databaseForLabel(page, viewName)] ??= {});

  (offsets[title] ??= {})[calendarProperty(page, viewName)] = dayOffset;
}

/** The day a calendar shows `title` on: the seeded (or dragged) date of its date property. */
function calendarDayOf(page: Page, viewName: string, title: string): number {
  const offset =
    templateState(page).dayOffsets[databaseForLabel(page, viewName)]?.[title]?.[calendarProperty(page, viewName)];

  if (offset === undefined) throw new Error(`"${title}" has no date on the "${viewName}" calendar`);
  return offset;
}

/** Open an event's page: its popover, then the popover's "Open event" button (the one before Close). */
export async function openCalendarEvent(page: Page, viewName: string, title: string) {
  const cell = await showCalendarDay(page, viewName, calendarDayOf(page, viewName, title));
  const event = calendarEvent(cell, title).first();

  await expect(event).toBeVisible(WAIT);
  await event.click();
  // The event's popover (a hover tooltip renders in a popper wrapper too): its sticky header holds the buttons.
  const header = page
    .locator('[data-radix-popper-content-wrapper]')
    .filter({ has: page.locator('.event-properties') })
    .last()
    .locator('div.sticky')
    .first();

  await expect(header).toBeVisible(WAIT);
  const buttons = header.locator('button');
  const count = await buttons.count();

  expect(count, 'the event popover offers Open event and Close').toBeGreaterThanOrEqual(2);
  await buttons.nth(count - 2).click();
  await expect(rowPage(page)).toBeVisible(WAIT);
  await expect
    .poll(() =>
      rowPage(page)
        .getByTestId('row-title-input')
        .evaluate((input) => (input as HTMLTextAreaElement).value)
    )
    .toBe(title);
}

// ---------------------------------------------------------------------------
// Dates of rows
// ---------------------------------------------------------------------------

/** A date cell as the Cloud API returns it (`{start, ...}` in RFC 3339, or a timestamp) → an instant. */
function instantOf(value: unknown): Date | null {
  if (value && typeof value === 'object' && typeof (value as { start?: unknown }).start === 'string') {
    return new Date((value as { start: string }).start);
  }

  const number = Number(value);

  if (value === null || value === undefined || value === '' || !Number.isFinite(number)) return null;
  return new Date(number > 1e12 ? number : number * 1000);
}

/** Wait until the server holds `property` of `title` on the day `today + N`. */
export async function expectPersistedDay(
  page: Page,
  request: APIRequestContext,
  databaseName: string,
  title: string,
  property: string,
  day: string
) {
  const world = dashboardWorld(page);
  const database = fixtureDatabase(page, databaseName);
  const rowId = database.rowIds[title];
  const fieldId = fieldIdOf(database, property);

  if (!rowId) throw new Error(`"${databaseName}" has no "${title}" row`);
  await expect
    .poll(
      async () => {
        const details = await apiGet<{ id: string; cells: Record<string, unknown> }[]>(
          request,
          world.owner.accessToken,
          `/api/workspace/${world.workspaceId}/database/${database.databaseId}/row/detail?ids=${rowId}`
        );
        const cells = details[0]?.cells ?? {};
        const instant = instantOf(cells[property] ?? cells[fieldId]);

        return instant ? dayOffsetOf(instant) : null;
      },
      { ...WAIT, message: `waiting for "${property}" of "${title}" to be saved` }
    )
    .toBe(relativeDayOffset(day));
}

/** The day offset of a date cell as the browser's row doc holds it. */
async function browserDayOffset(page: Page, databaseName: string, title: string, property: string) {
  const database = fixtureDatabase(page, databaseName);
  const data = await page.evaluate(
    ({ databaseId, rowId, fieldId }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const contexts = (bridge?.contexts ?? []).filter(
        (ctx: any) =>
          ctx.databaseDoc?.getMap('data')?.get('database')?.get('id') === databaseId ||
          ctx.databaseDoc?.guid === databaseId
      );

      for (const ctx of contexts.reverse()) {
        const cell = ctx.rowMap?.[rowId]?.getMap('data')?.get('data')?.get('cells')?.get(fieldId);

        if (cell) return String(cell.get('data') ?? '');
      }

      return null;
    },
    { databaseId: database.databaseId, rowId: database.rowIds[title], fieldId: fieldIdOf(database, property) }
  );
  const instant = instantOf(data);

  return instant ? dayOffsetOf(instant) : null;
}

// ---------------------------------------------------------------------------
// Timeline widgets
// ---------------------------------------------------------------------------

/**
 * Drag a bar `days` later, grabbing it past its icon and away from its
 * resize handles. A narrow widget may not fit the whole move in its canvas
 * (and the canvas scrolls by itself near its edges), so the move is made in
 * as few drags as fit, each checked against the row's start date.
 */
export async function dragTimelineBar(page: Page, viewName: string, title: string, days: number) {
  const state = templateState(page);
  const fields = state.timelines[viewName];
  const databaseName = databaseForLabel(page, viewName);
  const offsets = state.dayOffsets[databaseName]?.[title];

  if (!fields) throw new Error(`"${viewName}" is not a timeline of this scenario`);
  if (offsets?.[fields.start] === undefined || offsets?.[fields.end] === undefined) {
    throw new Error(`"${title}" has no ${fields.start} and ${fields.end} dates`);
  }

  const widget = widgetLocator(page, viewName);
  const rowId = await rowIdByTitle(page, viewName, title);
  const bar = widget.getByTestId(`timeline-bar-${rowId}`);
  const view = widget.getByTestId('timeline-view');
  const scroller = view.locator('.appflowy-scroller:not([data-testid="timeline-table-scrollbar"])').first();
  const table = view.getByTestId('timeline-table-viewport').first();
  const spanDays = offsets[fields.end] - offsets[fields.start] + 1;
  let moved = 0;

  await expect(bar).toBeAttached(WAIT);
  await bar.scrollIntoViewIfNeeded();
  while (moved < days) {
    const viewport = await scroller.boundingBox();
    const tableBox = (await table.isVisible()) ? await table.boundingBox() : null;
    let barBox = await bar.boundingBox();

    if (!viewport || !barBox) throw new Error(`The "${title}" bar is not on screen`);
    const canvasLeft = tableBox ? tableBox.x + tableBox.width : viewport.x;
    const canvasRight = viewport.x + viewport.width;
    const delta = barBox.x - (canvasLeft + 24);

    // Bring the bar's start just inside the canvas, and wait for the canvas to hold still (it may extend its range).
    if (Math.abs(delta) > 1) {
      await scroller.evaluate((element, by) => {
        element.scrollLeft += by;
      }, delta);
      await expect(async () => {
        const before = await bar.boundingBox({ timeout: 1_000 });

        await page.waitForTimeout(150);
        expect(before).not.toBeNull();
        expect(await bar.boundingBox({ timeout: 1_000 })).toEqual(before);
      }).toPass(WAIT);
      barBox = await bar.boundingBox();
      if (!barBox) throw new Error(`The "${title}" bar is not on screen`);
    }

    const dayWidth = barBox.width / spanDays;
    const visibleLeft = Math.max(barBox.x, canvasLeft);
    const visibleRight = Math.min(barBox.x + barBox.width, canvasRight);

    if (visibleRight - visibleLeft < 16) throw new Error(`The "${title}" bar cannot be brought into the canvas`);
    // Past the bar's icon and its start handle, inside its visible part.
    const grabX = visibleLeft + Math.min(60, (visibleRight - visibleLeft) / 2);
    // Stay clear of the canvas's edge autoscroll.
    const fits = Math.floor((canvasRight - 48 - grabX) / dayWidth);
    const step = Math.max(1, Math.min(days - moved, fits));
    const startBefore = await browserDayOffset(page, databaseName, title, fields.start);

    await dragBy(page, grabX, barBox.y + barBox.height / 2, step * dayWidth);
    await expect
      .poll(() => browserDayOffset(page, databaseName, title, fields.start), WAIT)
      .toBe((startBefore ?? offsets[fields.start] + moved) + step);
    moved += step;
  }

  offsets[fields.start] += days;
  offsets[fields.end] += days;
}

// ---------------------------------------------------------------------------
// Global filters
// ---------------------------------------------------------------------------

/** Database names of the dashboard's widgets, in widget order. */
async function dashboardSources(page: Page): Promise<string[]> {
  const world = dashboardWorld(page);
  const names: string[] = [];

  (await readDashboardSetting(page)).rows.forEach((row) =>
    row.widgets.forEach((widget) => {
      const database = Object.values(world.databases).find((candidate) => candidate.databaseId === widget.database_id);

      if (database && !names.includes(database.name)) names.push(database.name);
    })
  );
  return names;
}

function hasProperty(page: Page, database: string, property: string) {
  return property === 'Name' || Boolean(fixtureDatabase(page, database).fieldIds[property]);
}

/** Pick people in the open person filter: search by email (a workspace's emails are unique), then the one row left. */
async function pickFilterPeople(page: Page, request: APIRequestContext, value: string) {
  const content = DashboardSelectors.globalFilterContent(page);

  for (const who of splitList(value)) {
    const person = await templatePerson(page, request, who);
    const search = content.locator('input').first();

    await search.fill(person.email);
    const option = content.getByTestId('dashboard-global-filter-person');

    await expect(option).toHaveCount(1, WAIT);
    if ((await option.getAttribute('data-checked')) !== 'true') await option.click();
    await expect(option).toHaveAttribute('data-checked', 'true');
    await search.fill('');
  }
}

/** Pick an absolute date (`today - 3`) or range (`today - 14 to today + 14`) in the open date filter. */
async function pickFilterDates(page: Page, value: string) {
  const calendar = page.getByTestId('dashboard-global-filter-date-calendar');
  const shown = page.getByTestId('dashboard-global-filter-date-value');
  const range = /^(.+?) to (.+)$/.exec(value);

  if (!range) {
    await pickCalendarDay(page, relativeDayOffset(value), calendar);
    await expect(shown).not.toHaveText(/Type a value/, WAIT);
    return;
  }

  await pickCalendarDay(page, relativeDayOffset(range[1]), calendar);
  await expect(shown).toHaveText(/–/, WAIT);
  await pickCalendarDay(page, relativeDayOffset(range[2]), calendar);
  await expect(shown).toHaveText(/\S\s+–\s+\S/, WAIT);
}

/** Give the open global filter its value, by the type of the property it filters. */
async function setGlobalFilterValue(page: Page, request: APIRequestContext, type: FieldType, value: string) {
  if (!value) return;
  switch (type) {
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      await pickFilterDates(page, value);
      return;
    case FieldType.RichText:
    case FieldType.URL:
    case FieldType.Number:
      await fillGlobalFilterText(page, value);
      return;
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      for (const option of splitList(value)) await toggleGlobalFilterOptionByName(page, option, true);
      return;
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      await pickFilterPeople(page, request, value);
      return;
    default:
      throw new Error(`A filter of type ${type} takes its value from the condition alone, got "${value}"`);
  }
}

/**
 * Add a dashboard filter the way a writer does (WP08) and give it a condition
 * and a value. It maps every source with `property` (named after it), then
 * the sources `overrides` maps another property of the same type in.
 */
export async function addTemplateGlobalFilter(
  page: Page,
  request: APIRequestContext,
  property: string,
  condition: string,
  value: string,
  overrides: Record<string, string> = {}
) {
  const sources = await dashboardSources(page);
  const unknown = Object.keys(overrides).filter((database) => !sources.includes(database));

  if (unknown.length > 0) throw new Error(`The dashboard shows no widget of ${unknown.join(', ')}`);
  const direct = sources.filter((database) => !overrides[database] && hasProperty(page, database, property));
  const mapped = sources.filter((database) => overrides[database] && hasProperty(page, database, overrides[database]));

  if (direct.length === 0) throw new Error(`No dashboard source has a "${property}" property`);
  const mapping = Object.fromEntries([
    ...direct.map((database) => [database, property]),
    ...mapped.map((database) => [database, overrides[database]]),
  ]);
  const type = templateFieldType(page, direct[0], property);

  await addGlobalFilter(page, type, mapping, page);
  await chooseFilterCondition(page, condition);
  await setGlobalFilterValue(page, request, type, value);
  await finishGlobalFilter(page);
}

/** The open "Filter by…" menu has no row for `property` of `database`, even when searched for. */
export async function expectFilterMenuOmits(page: Page, property: string, databaseName: string) {
  const database = fixtureDatabase(page, databaseName);
  const fieldId = fieldIdOf(database, property);
  const search = DashboardSelectors.globalFilterSearch(page);

  await expect(DashboardSelectors.globalFilterMenu(page)).toBeVisible(WAIT);
  await search.fill(property);
  await expect(search).toHaveValue(property);
  await expect(DashboardSelectors.globalFilterFieldOption(page, database.databaseId, fieldId)).toHaveCount(0);
  await expect(fieldRowsOf(page, database.databaseId).filter({ hasText: exactText(property) })).toHaveCount(0);
  await search.fill('');
  await expect(DashboardSelectors.globalFilterFieldOptions(page).first()).toBeVisible(WAIT);
}

/** Map one more source into the open filter: `···` → Filter multiple sources → Add another → the property → Done. */
export async function addSourceToOpenGlobalFilter(page: Page, property: string, databaseName: string) {
  const database = fixtureDatabase(page, databaseName);

  await expect(DashboardSelectors.globalFilterPillEditor(page)).toBeVisible(WAIT);
  await DashboardSelectors.globalFilterMoreActions(page).click();
  await DashboardSelectors.globalFilterOpenBuilder(page).click();
  await expect(DashboardSelectors.globalFilterBuilder(page)).toBeVisible(WAIT);
  await DashboardSelectors.globalFilterAddAnother(page).click();
  await pickGlobalFilterProperty(page, page, databaseName, property);
  await expect(DashboardSelectors.globalFilterTarget(page, database.databaseId)).toBeVisible(WAIT);
  await DashboardSelectors.globalFilterDone(page).click();
  await expect(DashboardSelectors.globalFilterPillEditor(page)).toBeVisible(WAIT);
}

// ---------------------------------------------------------------------------
// Editing cells
// ---------------------------------------------------------------------------

/** A cell's data as the browser's row doc holds it. */
async function browserCellData(page: Page, databaseId: string, rowId: string, fieldId: string): Promise<string | null> {
  return page.evaluate(
    ({ databaseId, rowId, fieldId }) => {
      const bridge = (window as any).__DASHBOARD_TEST__;
      const contexts = (bridge?.contexts ?? []).filter(
        (ctx: any) =>
          ctx.databaseDoc?.getMap('data')?.get('database')?.get('id') === databaseId ||
          ctx.databaseDoc?.guid === databaseId
      );

      for (const ctx of contexts.reverse()) {
        const cell = ctx.rowMap?.[rowId]?.getMap('data')?.get('data')?.get('cells')?.get(fieldId);

        if (cell) return String(cell.get('data') ?? '');
      }

      return null;
    },
    { databaseId, rowId, fieldId }
  );
}

function personIds(data: string | null): string[] {
  try {
    const ids = JSON.parse(data ?? '[]') as unknown;

    return Array.isArray(ids) ? ids.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Set a cell of a grid widget. A Person cell is set to exactly the people
 * named ("the teammate", "me, the teammate") in its people menu; any other
 * type goes through the use-case `editWidgetCell`.
 */
export async function changeWidgetCell(
  page: Page,
  request: APIRequestContext,
  viewName: string,
  title: string,
  property: string,
  value: string
) {
  const databaseName = databaseForLabel(page, viewName);

  if (templateFieldType(page, databaseName, property) !== FieldType.Person) {
    await editWidgetCell(page, viewName, title, property, value);
    return;
  }

  const database = fixtureDatabase(page, databaseName);
  const rowId = await rowIdByTitle(page, viewName, title);
  const fieldId = fieldIdOf(database, property);
  const wanted = (await Promise.all(splitList(value).map((who) => templatePerson(page, request, who)))).map(
    (person) => person.uuid
  );
  const cell = widgetLocator(page, viewName).getByTestId(`grid-cell-${rowId}-${fieldId}`);
  const menu = page.getByTestId('person-cell-menu');

  await expect(cell).toBeAttached(WAIT);
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  await expect(menu).toBeVisible(WAIT);
  const current = personIds(await browserCellData(page, database.databaseId, rowId, fieldId));
  const toggles = [...wanted.filter((id) => !current.includes(id)), ...current.filter((id) => !wanted.includes(id))];

  for (const id of toggles) {
    const before = personIds(await browserCellData(page, database.databaseId, rowId, fieldId));

    await menu.getByTestId(`person-option-${id}`).click();
    await expect
      .poll(async () => personIds(await browserCellData(page, database.databaseId, rowId, fieldId)).includes(id), WAIT)
      .toBe(!before.includes(id));
  }

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden(WAIT);
  await expect
    .poll(async () => personIds(await browserCellData(page, database.databaseId, rowId, fieldId)).sort(), WAIT)
    .toEqual([...wanted].sort());
}

/** The database of this scenario with a row titled `title` and a `property`. */
function databaseWithRow(page: Page, title: string, property: string): FixtureDatabase {
  const matches = Object.values(dashboardWorld(page).databases).filter(
    (database) => database.rowIds[title] && database.fieldIds[property]
  );

  if (matches.length !== 1) throw new Error(`Expected one database with a "${title}" row and a "${property}" property`);
  return matches[0];
}

/** Edit a cell of the grid the page shows (a database page, not a dashboard widget). */
export async function editOpenGridCell(page: Page, property: string, title: string, value: string) {
  const database = databaseWithRow(page, title, property);
  const type = templateFieldType(page, database.name, property);
  const cell = page
    .getByTestId('database-grid')
    .first()
    .getByTestId(`grid-cell-${database.rowIds[title]}-${fieldIdOf(database, property)}`);

  await expect(cell).toBeVisible(WAIT);
  await cell.click();
  if (type === FieldType.SingleSelect) {
    const menu = page.getByTestId('select-option-menu');

    await expect(menu).toBeVisible(WAIT);
    await menu.getByTestId(`select-option-${templateOptionId(page, database.name, value)}`).click();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(cell).toContainText(value, WAIT);
    return;
  }

  const input = cell.locator('input, textarea, [contenteditable="true"]').first();

  await expect(input).toBeVisible(WAIT);
  await input.fill(value);
  await input.press('Enter');
  await page.keyboard.press('Escape');
}

/**
 * The teammate adds a row in a list widget: the list's "New page" row (or,
 * where the widget hides it, the header's `+ New` tool) opens the new row's
 * page, where the title is typed.
 */
export async function addListRowAsTeammate(page: Page, viewName: string, title: string) {
  const member = memberPage(page);
  const widget = namedWidget(member, page, viewName);
  const database = fixtureDatabase(page, databaseForLabel(page, viewName));
  const inline = widget.getByTestId('dashboard-widget-body').getByTestId('list-new-row');

  await expect(widget).toBeVisible(WAIT);
  if ((await inline.count()) > 0) {
    await inline.scrollIntoViewIfNeeded();
    await inline.click();
  } else {
    await widget.hover();
    await DashboardSelectors.widgetTool(widget, 'new').click();
  }

  const titleInput = rowPage(member).getByTestId('row-title-input');

  await expect(titleInput).toBeVisible(WAIT);
  await titleInput.click();
  await member.keyboard.type(title);
  await expect(titleInput).toHaveValue(title);
  await closeRowDetailWithEscape(member);
  await expect(rowPage(member)).toHaveCount(0, WAIT);
  await expect.poll(() => widgetTitles(widget, database.fieldIds.Name), WAIT).toContain(title);
}

// ---------------------------------------------------------------------------
// The widget picker and nesting
// ---------------------------------------------------------------------------

/** The view id of a scenario view or dashboard named `name`. */
function viewIdByName(page: Page, name: string): string {
  const dashboard = scenarioState(page).dashboards[name];

  return dashboard ? dashboard.viewId : namedView(page, name).viewId;
}

/** The open picker lists no option for the view or dashboard `name`, even when searched for. */
export async function expectPickerOmits(page: Page, name: string) {
  const picker = DashboardSelectors.picker(page);
  const search = DashboardSelectors.pickerSearch(page);
  const viewId = viewIdByName(page, name);

  await expect(picker).toHaveAttribute('data-state', 'ready', WAIT);
  await search.fill(name);
  await expect(search).toHaveValue(name);
  await expect(DashboardSelectors.pickerOption(page, viewId)).toHaveCount(0);
  await expect(DashboardSelectors.pickerOptions(page).filter({ hasText: exactText(name) })).toHaveCount(0);
  await search.fill('');
  // The picker does list views: the absence above is not an empty list.
  await expect(DashboardSelectors.pickerOptions(page).first()).toBeVisible(WAIT);
}

/** Switch a scenario view to the Dashboard layout from its database page (WP05 §1.6). */
export async function turnViewIntoDashboard(page: Page, name: string) {
  const view = namedView(page, name);

  await switchViewToDashboard(page, view.database, view.viewId);
}

// ---------------------------------------------------------------------------
// Dashboard tabs and widgets
// ---------------------------------------------------------------------------

/** Scenario view names by the widget ids of a dashboard's saved layout. */
async function widgetsByViewName(page: Page, dashboardViewId: string): Promise<Record<string, KnownWidget>> {
  const names = new Map(Object.values(scenarioState(page).views).map((view) => [view.viewId, view.name]));
  const widgets: Record<string, KnownWidget> = {};

  allWidgets(await readDashboardSetting(page, dashboardViewId)).forEach((widget) => {
    const name = names.get(widget.view_id);

    if (name && !widgets[name]) {
      widgets[name] = { id: widget.id, viewId: widget.view_id, databaseId: widget.database_id };
    }
  });
  return widgets;
}

/**
 * Duplicate a dashboard from its tab menu. The copy ("<name> (Copy)") opens
 * and becomes the dashboard the next steps talk about; its widgets are found
 * by the views they show.
 */
export async function duplicateDashboardTab(page: Page, name: string) {
  const source = namedDashboard(page, name);
  const host = fixtureDatabase(page, source.host);
  const known = (await readDatabaseViews(page, host.databaseId)).map((view) => view.id);
  const tab = DatabaseViewSelectors.viewTab(page, source.viewId);
  const widgetCount = allWidgets(await readDashboardSetting(page, source.viewId)).length;
  let copyId = '';

  await expect(tab).toBeVisible(WAIT);
  await tab.click({ button: 'right' });
  await expect(DatabaseViewSelectors.tabActionDuplicate(page)).toBeVisible(WAIT);
  await DatabaseViewSelectors.tabActionDuplicate(page).click({ force: true });
  await expect
    .poll(
      async () => {
        copyId =
          (await readDatabaseViews(page, host.databaseId)).find(
            (view) => view.layout === DatabaseViewLayout.Dashboard && !known.includes(view.id)
          )?.id ?? '';
        return copyId;
      },
      { ...WAIT, message: `waiting for the copy of the "${name}" dashboard` }
    )
    .not.toBe('');
  await expect.poll(async () => allWidgets(await readDashboardSetting(page, copyId)).length, WAIT).toBe(widgetCount);
  const copyName = `${name} (Copy)`;

  scenarioState(page).dashboards[copyName] = {
    name: copyName,
    viewId: copyId,
    host: source.host,
    widgets: await widgetsByViewName(page, copyId),
  };
  activateDashboard(page, copyName);
  await expect(DatabaseViewSelectors.viewTab(page, copyId)).toHaveAttribute('data-state', 'active', WAIT);
  await expect(DashboardSelectors.view(page)).toBeVisible(WAIT);
}

/** Rename the active dashboard from its tab menu; the scenario knows it by the new name afterwards. */
export async function renameActiveDashboardTab(page: Page, newName: string) {
  const state = scenarioState(page);
  const viewId = dashboardWorld(page).dashboardViewId;
  const entry = Object.values(state.dashboards).find((dashboard) => dashboard.viewId === viewId);

  if (!entry) throw new Error('The active dashboard is not one of this scenario');
  const tab = DatabaseViewSelectors.viewTab(page, entry.viewId);
  const input = ModalSelectors.renameInput(page);

  await tab.click({ button: 'right' });
  await expect(DatabaseViewSelectors.tabActionRename(page)).toBeVisible(WAIT);
  await DatabaseViewSelectors.tabActionRename(page).click();
  await expect(input).toBeVisible(WAIT);
  await input.fill(newName);
  await ModalSelectors.renameSaveButton(page).click();
  await expect(input).toBeHidden(WAIT);
  await expect(tab).toContainText(newName, WAIT);
  delete state.dashboards[entry.name];
  entry.name = newName;
  state.dashboards[newName] = entry;
  activateDashboard(page, newName);
}

/** Delete a widget from its menu (Edit mode); the scenario stops expecting it on this dashboard. */
export async function deleteNamedWidget(page: Page, viewName: string) {
  const widget = widgetLocator(page, viewName);
  const before = allWidgets(await readDashboardSetting(page)).length;

  await chooseWidgetMenuAction(page, widget, 'delete');
  await expect.poll(async () => allWidgets(await readDashboardSetting(page)).length, WAIT).toBe(before - 1);
  await expect(widget).toHaveCount(0, WAIT);
  delete dashboardWorld(page).widgets[viewName];
}

// ---------------------------------------------------------------------------
// Cold loading (addendum A9)
// ---------------------------------------------------------------------------

/** Open a dashboard with no database cached in this browser (IndexedDB and delta cursors cleared). */
export async function openTemplateDashboardCold(page: Page, name: string) {
  activateDashboard(page, name);
  await clearCachedDatabaseStorage(page);
  await openUseCaseDashboard(page, name);
}

/** The most intervals open at once. */
function maxOverlap(intervals: { start: number; end: number }[]) {
  const edges = intervals
    .flatMap(({ start, end }) => [
      { at: start, delta: 1 },
      { at: end, delta: -1 },
    ])
    // An interval that ends as another starts does not overlap it.
    .sort((a, b) => a.at - b.at || a.delta - b.delta);
  let open = 0;
  let max = 0;

  edges.forEach(({ delta }) => {
    open += delta;
    max = Math.max(max, open);
  });
  return max;
}

/**
 * The dashboard's cold sources took load slots no more than `cap` at a time
 * (`tokens.json` `loading.maxConcurrentSources`), by the app's load counters:
 * every source but the host loaded, and its high-water mark and the slot
 * intervals stay within the cap. The dashboard must have more sources than
 * the cap, or there is nothing to check.
 */
export async function expectTemplateSourceLoadCap(page: Page, cap: number) {
  expect(cap, 'tokens.json loading.maxConcurrentSources').toBe(DASHBOARD_LOADING.maxConcurrentSources);
  const world = dashboardWorld(page);
  const host = fixtureDatabase(page, world.dashboardHost as string).databaseId;
  const sources = [...new Set(allWidgets(await readDashboardSetting(page)).map((widget) => widget.database_id))].filter(
    (id) => id !== host
  );

  expect(sources.length, 'the dashboard reads more source databases than the cap').toBeGreaterThan(cap);
  let stats = await loadStats(page);

  await expect
    .poll(
      async () => {
        stats = await loadStats(page);
        return sources.filter((id) => !stats.sourceLoads.some((load) => load.sourceId === id && load.end !== null));
      },
      { timeout: COLD_LOAD_TIMEOUT_MS, message: 'waiting for every source database to finish loading' }
    )
    .toEqual([]);
  expect(stats.maxConcurrentSourceLoads, 'sources loading at once (the app counter)').toBeLessThanOrEqual(cap);
  expect(
    maxOverlap(stats.sourceLoads.map((load) => ({ start: load.start, end: load.end ?? Date.now() }))),
    'overlapping source load slots'
  ).toBeLessThanOrEqual(cap);
}
