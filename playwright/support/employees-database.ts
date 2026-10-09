/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
/**
 * The "5000 employees" large-database fixture.
 *
 * `playwright/fixtures/database/afdb/employees_v3.afdb.gz` is a gzipped copy of
 * the desktop fixture `rust-lib/flowy-database2/tests/assets/workspaces/database/employees_v3.afdb`
 * (AppFlowy Premium), which was checked cell by cell against the shared
 * `Big Database / 5000_employees` grid. It is an AppFlowy CSV META export:
 * the header row holds the 20 field definitions (ids, types, type options) and
 * each of the 5000 rows holds typed cells with their timestamps.
 *
 * `seedEmployeesDatabase` rebuilds that database inside the grid a test just
 * created, keeping field ids, option ids, cell data and row timestamps, so the
 * large-database suite runs against a fresh account on any server.
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import * as Y from 'yjs';

import { Types } from '../../src/application/types';

import { signInAndWaitForApp } from './auth-flow-helpers';
import { loginAndCreateGrid } from './field-type-helpers';
import { DatabaseGridSelectors } from './selectors';
import { generateRandomEmail, TestConfig } from './test-config';

export const EMPLOYEES_FIXTURE_URL = new URL('../fixtures/database/afdb/employees_v3.afdb.gz', import.meta.url);
/** SHA-256 of the uncompressed export; the same value the desktop oracle pins. */
export const EMPLOYEES_FIXTURE_SHA256 = '508e6bd408be6258ca380bfe307826cadb81298db0c0b3f51dd612526e252ebd';
export const EMPLOYEES_ROW_COUNT = 5000;
/** Time the server gets to confirm one batch of new rows. */
const SERVER_CONFIRM_TIMEOUT_MS = 120000;

/** Field ids of the fixture, by display name. */
export const EMPLOYEE_FIELDS = {
  Name: 'emNam1',
  Department: 'emDep1',
  Salary: 'emSal1',
  Email: 'emEml1',
  Active: 'emAct1',
  Skills: 'emSkl1',
  Onboarding: 'emOnb1',
  'Join Date': 'emJDt1',
  'Last modified': 'emLMd1',
  'Created at': 'emCAt1',
  'Job Title': 'emJTl1',
  Manager: 'emMgr1',
  Office: 'emOfc1',
  Performance: 'emPRt1',
  Bonus: 'emBns1',
  'Years of Experience': 'emYrs1',
  Phone: 'emPhn1',
  LinkedIn: 'emLin1',
  Languages: 'emLng1',
  Remote: 'emRmt1',
} as const;

export interface EmployeesFieldDef {
  id: string;
  name: string;
  field_type: number;
  type_options: Record<string, Record<string, unknown>>;
  is_primary: boolean;
}

export interface EmployeesCellDef {
  data: string;
  field_type: number;
  created_at?: number;
  last_modified?: number;
  is_range?: boolean;
  include_time?: boolean;
  end_timestamp?: string;
  reminder_id?: string;
}

export interface EmployeesFixture {
  fields: EmployeesFieldDef[];
  /** One entry per row, cells in field order. */
  rows: EmployeesCellDef[][];
}

/** RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }

      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

let cachedFixture: EmployeesFixture | undefined;

/** Reads, verifies and parses the pinned export (cached per worker). */
export function loadEmployeesFixture(): EmployeesFixture {
  if (cachedFixture) return cachedFixture;
  const bytes = gunzipSync(readFileSync(EMPLOYEES_FIXTURE_URL));
  const digest = createHash('sha256').update(bytes).digest('hex');

  if (digest !== EMPLOYEES_FIXTURE_SHA256) {
    throw new Error(`employees_v3.afdb changed: sha256 ${digest}, expected ${EMPLOYEES_FIXTURE_SHA256}`);
  }

  const [header, ...records] = parseCsv(bytes.toString('utf8'));
  const fields = header.map((column) => JSON.parse(column) as EmployeesFieldDef);
  const rows = records
    .filter((record) => record.length === fields.length)
    .map((record) => record.map((cell) => JSON.parse(cell) as EmployeesCellDef));

  if (rows.length !== EMPLOYEES_ROW_COUNT) {
    throw new Error(`employees_v3.afdb has ${rows.length} rows, expected ${EMPLOYEES_ROW_COUNT}`);
  }

  cachedFixture = { fields, rows };
  return cachedFixture;
}

/** Row values of the fixture keyed by field name, for assertions. */
export function employeeRecords(): Array<Record<string, EmployeesCellDef>> {
  const { fields, rows } = loadEmployeesFixture();

  return rows.map((cells) => Object.fromEntries(fields.map((field, index) => [field.name, cells[index]])));
}

export interface SeedEmployeesOptions {
  /** Seed only the first N rows (quick local runs). Defaults to all 5000. */
  rowLimit?: number;
  /** Rows written per browser round trip. */
  batchSize?: number;
  onProgress?: (seeded: number, total: number) => void;
}

/**
 * Replaces the fields and rows of the grid currently open (a fresh grid made by
 * `loginAndCreateGrid`) with the employees fixture. Returns the new row ids in
 * fixture order.
 */
export async function seedEmployeesDatabase(page: Page, options: SeedEmployeesOptions = {}): Promise<string[]> {
  const fixture = loadEmployeesFixture();
  const total = Math.min(options.rowLimit ?? fixture.rows.length, fixture.rows.length);
  const batchSize = options.batchSize ?? 100;

  await page.waitForFunction(() => Boolean((window as any).__TEST_DATABASE_CONTEXT__), null, { timeout: 60000 });

  // 1. Schema: drop the default fields and rows, insert the fixture fields.
  await page.evaluate((fields) => {
    const win = window as any;
    const ctx = win.__TEST_DATABASE_CONTEXT__;
    const Y = win.Y;
    const doc = ctx.databaseDoc;
    const database = doc.getMap('data').get('database');
    const yFields = database.get('fields');
    const views = database.get('views');
    const now = String(Math.floor(Date.now() / 1000));

    doc.transact(() => {
      Array.from(yFields.keys()).forEach((id) => yFields.delete(id as string));
      fields.forEach((def) => {
        const field = new Y.Map();
        const typeOptions = new Y.Map();

        field.set('id', def.id);
        field.set('name', def.name);
        field.set('ty', def.field_type);
        field.set('is_primary', def.is_primary);
        field.set('created_at', now);
        field.set('last_modified', now);
        Object.entries(def.type_options).forEach(([type, option]) => {
          const yOption = new Y.Map();

          Object.entries(option).forEach(([key, value]) => yOption.set(key, value));
          typeOptions.set(type, yOption);
        });
        field.set('type_option', typeOptions);
        yFields.set(def.id, field);
      });

      views.forEach((view: any) => {
        const fieldOrders = view.get('field_orders');
        const rowOrders = view.get('row_orders');
        let settings = view.get('field_settings');

        fieldOrders.delete(0, fieldOrders.length);
        fieldOrders.push(fields.map((def) => ({ id: def.id })));
        rowOrders.delete(0, rowOrders.length);
        if (!settings) {
          settings = new Y.Map();
          view.set('field_settings', settings);
        }

        Array.from(settings.keys()).forEach((id) => settings.delete(id as string));
        fields.forEach((def) => {
          const setting = new Y.Map();

          setting.set('visibility', 0);
          setting.set('wrap', true);
          settings.set(def.id, setting);
        });
      });
    });
  }, fixture.fields);

  // 2. Rows: create each row doc, then list the batch in every view.
  const rowIds: string[] = [];
  const fieldTypes = fixture.fields.map((field) => ({ id: field.id, type: field.field_type }));

  for (let start = 0; start < total; start += batchSize) {
    const batch = fixture.rows.slice(start, Math.min(start + batchSize, total));
    const ids: string[] = await page.evaluate(
      async ({ batch, fieldTypes }) => {
        const win = window as any;
        const ctx = win.__TEST_DATABASE_CONTEXT__;
        const Y = win.Y;
        const doc = ctx.databaseDoc;
        const database = doc.getMap('data').get('database');
        const databaseId = database.get('id') || doc.guid;
        const created: string[] = [];

        const docs = await Promise.all(
          batch.map(async (cells) => {
            const rowId = crypto.randomUUID();

            created.push(rowId);
            return { rowId, cells, rowDoc: await ctx.createRow(`${doc.guid}_rows_${rowId}`) };
          })
        );

        docs.forEach(({ rowId, cells, rowDoc }) => {
          // Created/Last edited time live on the row itself, not in a cell.
          const createdAt = cells.find((_cell: unknown, index: number) => fieldTypes[index].type === 9)?.data;
          const lastModified = cells.find((_cell: unknown, index: number) => fieldTypes[index].type === 8)?.data;

          rowDoc.transact(() => {
            const root = rowDoc.getMap('data');
            const row = new Y.Map();
            const yCells = new Y.Map();

            row.set('id', rowId);
            row.set('database_id', databaseId);
            row.set('height', 36);
            row.set('visibility', true);
            row.set('created_at', String(createdAt));
            row.set('last_modified', String(lastModified));
            row.set('cells', yCells);
            cells.forEach((cell: any, index: number) => {
              const { id, type } = fieldTypes[index];

              if (type === 8 || type === 9) return;
              const yCell = new Y.Map();

              yCell.set('field_type', cell.field_type);
              yCell.set('data', cell.data);
              yCell.set('created_at', String(cell.created_at ?? createdAt));
              yCell.set('last_modified', String(cell.last_modified ?? lastModified));
              if (cell.is_range !== undefined) yCell.set('is_range', cell.is_range);
              if (cell.include_time !== undefined) yCell.set('include_time', cell.include_time);
              if (cell.end_timestamp !== undefined) yCell.set('end_timestamp', cell.end_timestamp);
              if (cell.reminder_id !== undefined) yCell.set('reminder_id', cell.reminder_id);
              yCells.set(id, yCell);
            });
            root.set('data', row);
          });
        });

        doc.transact(() => {
          database.get('views').forEach((view: any) => {
            view.get('row_orders').push(created.map((id) => ({ id, height: 36 })));
          });
        });

        return created;
      },
      { batch, fieldTypes }
    );

    // Creating thousands of rows at once overwhelms the realtime connection
    // (it reconnects and some rows never reach the server), so let the server
    // confirm each batch before creating the next one.
    await expectRowsOnServer(page, ids, SERVER_CONFIRM_TIMEOUT_MS);
    rowIds.push(...ids);
    options.onProgress?.(rowIds.length, total);
  }

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
          const view = ctx.databaseDoc.getMap('data').get('database').get('views').get(ctx.activeViewId);

          return view.get('row_orders').length;
        }),
      { timeout: 60000 }
    )
    .toBe(total);
  await expect(DatabaseGridSelectors.dataRows(page).first()).toBeVisible({ timeout: 60000 });
  return rowIds;
}

/** Workspace, database and token of the database open in `page`. */
async function serverHandles(page: Page) {
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    let token = '';

    try {
      token = JSON.parse(localStorage.getItem('token') ?? '{}').access_token ?? '';
    } catch {
      token = '';
    }

    return {
      workspaceId: ctx.workspaceId as string,
      databaseId: String(database.get('id') || ctx.databaseDoc.guid),
      token: token || localStorage.getItem('af_auth_token') || '',
    };
  });
}

/** Waits until the server returns every row in `rowIds` with its cells. */
async function expectRowsOnServer(page: Page, rowIds: string[], timeoutMs: number): Promise<void> {
  const { workspaceId, databaseId, token } = await serverHandles(page);

  if (!token) throw new Error('No auth token in the page');

  for (let start = 0; start < rowIds.length; start += 100) {
    const chunk = rowIds.slice(start, start + 100);
    const url = new URL(`/api/workspace/${workspaceId}/database/${databaseId}/row/detail`, TestConfig.apiUrl);

    url.searchParams.set('ids', chunk.join(','));
    await expect
      .poll(
        async () => {
          const response = await page.request.get(url.toString(), { headers: { Authorization: `Bearer ${token}` } });

          if (!response.ok()) return -1;
          const body = (await response.json()) as { data?: Array<{ cells?: Record<string, unknown> }> };

          return (body.data ?? []).filter((row) => Object.keys(row.cells ?? {}).length > 0).length;
        },
        { timeout: timeoutMs, intervals: [250, 500, 1000], message: 'seeded rows on the server' }
      )
      .toBe(chunk.length);
  }
}

/** Reads a sample of the seeded rows back from the server. */
export async function expectEmployeesOnServer(page: Page, rowIds: string[], sampleSize = 200): Promise<void> {
  const step = Math.max(1, Math.floor(rowIds.length / sampleSize));
  const sample = rowIds.filter((_id, index) => index % step === 0 || index === rowIds.length - 1);

  await expectRowsOnServer(page, sample, SERVER_CONFIRM_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// The seeded database, shared by the scenarios of one worker
// ---------------------------------------------------------------------------

export interface SeededEmployeesDatabase {
  apiUrl: string;
  baseUrl: string;
  email: string;
  url: string;
  /** Row ids in fixture order. */
  rowIds: string[];
}

let seededEmployees: SeededEmployeesDatabase | undefined;

interface EditedEmployeeCell {
  databaseId: string;
  rowId: string;
  fieldId: string;
  original: Record<string, unknown>;
}

const editedCells = new WeakMap<Page, EditedEmployeeCell[]>();

/** Save the original before an input commits, so a failing scenario can restore its shared cache. */
export async function rememberEmployeeCell(page: Page, databaseId: string, rowId: string, fieldId: string) {
  const remembered = editedCells.get(page) ?? [];

  if (remembered.some((cell) => cell.rowId === rowId && cell.fieldId === fieldId)) return;
  const original = await page.evaluate(
    async ({ databaseId, rowId, fieldId }) => {
      const ctx = (window as any).__DASHBOARD_TEST__?.byDatabase(databaseId);
      const rowDoc = ctx?.rowMap?.[rowId] ?? (await ctx?.ensureRow?.(rowId));
      const cell = rowDoc?.getMap('data').get('data')?.get('cells')?.get(fieldId);

      if (!cell) throw new Error(`Cannot remember employees cell ${rowId}/${fieldId}`);
      return cell.toJSON() as Record<string, unknown>;
    },
    { databaseId, rowId, fieldId }
  );

  remembered.push({ databaseId, rowId, fieldId, original });
  editedCells.set(page, remembered);
}

/** Restore only cells this scenario edited, then confirm their exact values in the server row docs. */
export async function restoreEmployeeCells(page: Page) {
  const remembered = editedCells.get(page);

  if (!remembered?.length) return;
  await page.goto(seededEmployeesDatabase().url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).__TEST_DATABASE_CONTEXT__), null, { timeout: 120_000 });
  const access = await serverHandles(page);

  await page.evaluate(async (cells) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

    for (const { databaseId, rowId, fieldId, original } of cells) {
      const actualId = ctx.databaseDoc.getMap('data').get('database').get('id') || ctx.databaseDoc.guid;

      if (actualId !== databaseId) throw new Error('Employees cleanup opened the wrong database');
      const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow(rowId));
      const cell = rowDoc?.getMap('data').get('data')?.get('cells')?.get(fieldId);

      if (!cell) throw new Error(`Cannot restore employees cell ${rowId}/${fieldId}`);
      rowDoc.transact(() => {
        for (const key of Array.from<string>(cell.keys())) if (!(key in original)) cell.delete(key);
        for (const [key, value] of Object.entries(original)) cell.set(key, value);
      });
    }
  }, remembered);

  for (const cell of remembered) {
    await expect
      .poll(
        async () => {
          const url = new URL(`/api/workspace/v1/${access.workspaceId}/collab/${cell.rowId}`, TestConfig.apiUrl);

          url.searchParams.set('collab_type', String(Types.DatabaseRow));
          const response = await page.request.get(url.toString(), {
            headers: { Authorization: `Bearer ${access.token}` },
          });
          const body = await response.json();

          if (!response.ok() || body.code !== 0 || !body.data?.doc_state) return null;
          const doc = new Y.Doc();

          try {
            Y.applyUpdate(doc, new Uint8Array(body.data.doc_state));
            return (doc.getMap('data').get('data') as any)?.get('cells')?.get(cell.fieldId)?.toJSON();
          } finally {
            doc.destroy();
          }
        },
        {
          timeout: SERVER_CONFIRM_TIMEOUT_MS,
          message: `restored employees cell ${cell.rowId}/${cell.fieldId} persisted`,
        }
      )
      .toEqual(cell.original);
  }

  editedCells.delete(page);
}

/** `EMPLOYEES_ROW_LIMIT`: seed only the first N rows (quick local runs). */
export function employeesRowLimit(): number | undefined {
  const limit = Number(process.env.EMPLOYEES_ROW_LIMIT);

  return Number.isFinite(limit) && limit > 0 ? limit : undefined;
}

function appBaseUrl(): string {
  return process.env.BASE_URL || 'http://localhost:3000';
}

/** A seeded account from `LARGE_DATABASE_CACHE`, when it was seeded on this server with the same row count. */
function readCachedEmployeesDatabase(): SeededEmployeesDatabase | undefined {
  const file = process.env.LARGE_DATABASE_CACHE;

  if (!file || !existsSync(file)) return undefined;
  const cached = JSON.parse(readFileSync(file, 'utf8')) as SeededEmployeesDatabase;
  const expectedRows = employeesRowLimit() ?? loadEmployeesFixture().rows.length;

  if (cached.apiUrl !== TestConfig.apiUrl || cached.baseUrl !== appBaseUrl() || cached.rowIds.length !== expectedRows) {
    return undefined;
  }

  return cached;
}

/**
 * Sign in to the worker's employees database and open its grid, seeding a
 * fresh account the first time (`EMPLOYEES_ROW_LIMIT` rows, kept in
 * `LARGE_DATABASE_CACHE` when that is set).
 */
export async function openSeededEmployeesDatabase(
  page: Page,
  request: APIRequestContext
): Promise<SeededEmployeesDatabase> {
  seededEmployees ??= readCachedEmployeesDatabase();

  if (seededEmployees) {
    await signInAndWaitForApp(page, page.request, seededEmployees.email);
    await page.goto(seededEmployees.url);
    await page.waitForFunction(() => Boolean((window as any).__TEST_DATABASE_CONTEXT__), null, { timeout: 120000 });
    await expect(page.getByTestId('database-grid')).toBeVisible({ timeout: 120000 });
    return seededEmployees;
  }

  const email = generateRandomEmail();

  await loginAndCreateGrid(page, request, email);
  const rowIds = await seedEmployeesDatabase(page, { rowLimit: employeesRowLimit() });

  await expectEmployeesOnServer(page, rowIds);
  seededEmployees = { apiUrl: TestConfig.apiUrl, baseUrl: appBaseUrl(), email, url: page.url(), rowIds };
  if (process.env.LARGE_DATABASE_CACHE) {
    writeFileSync(process.env.LARGE_DATABASE_CACHE, JSON.stringify(seededEmployees));
  }

  return seededEmployees;
}

/** The employees database this worker opened last. */
export function seededEmployeesDatabase(): SeededEmployeesDatabase {
  if (!seededEmployees) throw new Error('The employees database is not seeded');
  return seededEmployees;
}

/** Removes the properties, filters, sorts and calculations a scenario may have added, in every view. */
export async function resetEmployeesDatabaseSettings(page: Page) {
  await page.evaluate(
    (fieldIds) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const fields = database.get('fields');
      const keep = new Set(fieldIds);

      doc.transact(() => {
        Array.from(fields.keys() as Iterable<string>)
          .filter((id) => !keep.has(id))
          .forEach((id) => fields.delete(id));
        database.get('views').forEach((view: any) => {
          const orders = view.get('field_orders');

          for (let index = orders.length - 1; index >= 0; index -= 1) {
            if (!keep.has(orders.get(index).id)) orders.delete(index, 1);
          }

          const settings = view.get('field_settings');

          Array.from((settings?.keys() ?? []) as Iterable<string>)
            .filter((id) => !keep.has(id))
            .forEach((id) => settings.delete(id));
          ['filters', 'sorts', 'calculations'].forEach((key) => {
            const list = view.get(key);

            if (list?.length) list.delete(0, list.length);
          });
        });
      });
    },
    loadEmployeesFixture().fields.map((field) => field.id)
  );
}
