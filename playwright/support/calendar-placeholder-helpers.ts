import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { switchCalendarView } from './calendar-test-helpers';
import { getCurrentDatabaseInfo, waitForDatabaseTestContext } from './relation-test-helpers';
import { CalendarSelectors } from './selectors';
import { TestConfig } from './test-config';

export interface CalendarStoredRow {
  id: string;
  title: string;
  start: string;
  end: string;
  includeTime: boolean;
  isRange: boolean;
}

export interface CalendarStorageIdentity {
  workspaceId: string;
  databaseId: string;
  viewId: string;
  primaryFieldId: string;
  dateFieldId: string;
}

export const calendarDraftEditor = (page: Page) => page.getByTestId('calendar-event-draft-editor');
export const calendarDraftTitle = (page: Page) => calendarDraftEditor(page).getByTestId('calendar-event-title-input');
export const calendarDraftCards = (page: Page) => page.getByTestId('calendar-draft-event');

export async function calendarStorageIdentity(page: Page): Promise<CalendarStorageIdentity> {
  const info = await getCurrentDatabaseInfo(page);
  const workspaceId = new URL(page.url()).pathname.split('/')[2];
  const dateFieldId = await page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');

    return database.get('views').get(ctx.activeViewId).get('layout_settings').get('2').get('field_id') as string;
  });

  if (!workspaceId || !dateFieldId) throw new Error('Calendar cloud identity is incomplete');
  return {
    workspaceId,
    databaseId: info.databaseId,
    viewId: info.viewId,
    primaryFieldId: info.primaryFieldId,
    dateFieldId,
  };
}

/** Read real rows, rather than counting the rendered cards (which include drafts). */
export async function readCalendarStoredRows(
  page: Page,
  identity: CalendarStorageIdentity
): Promise<CalendarStoredRow[]> {
  await waitForDatabaseTestContext(page);
  return page.evaluate(async ({ viewId, primaryFieldId, dateFieldId }) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const orders = database.get('views').get(viewId).get('row_orders').toArray() as Array<{
      id: string;
      is_deleted?: boolean;
    }>;
    const rows: CalendarStoredRow[] = [];

    for (const { id } of orders.filter((order) => !order.is_deleted)) {
      const doc = ctx.rowMap?.[id] ?? (await ctx.ensureRow(id));

      if (!doc) throw new Error(`Calendar row ${id} has not loaded`);
      const cells = doc.getMap('data').get('data').get('cells');
      const date = cells.get(dateFieldId);

      rows.push({
        id,
        title: String(cells.get(primaryFieldId)?.get('data') ?? ''),
        start: String(date?.get('data') ?? ''),
        end: String(date?.get('end_timestamp') ?? ''),
        includeTime: Boolean(date?.get('include_time')),
        isRange: Boolean(date?.get('is_range')),
      });
    }

    return rows.sort((left, right) => left.id.localeCompare(right.id));
  }, identity);
}

type CloudCollab = Record<string, any>;

async function readCloudCollab(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  objectId: string,
  collabType: number
): Promise<CloudCollab> {
  const response = await request.get(`${TestConfig.apiUrl}/api/workspace/v1/${workspaceId}/collab/${objectId}/json`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { collab_type: String(collabType) },
    failOnStatusCode: false,
  });

  if (!response.ok()) throw new Error(`Cloud calendar snapshot failed: HTTP ${response.status()}`);
  const envelope = await response.json();

  if (envelope.code !== 0 || !envelope.data?.collab) {
    throw new Error(`Cloud calendar snapshot failed: API code ${envelope.code}`);
  }

  return envelope.data.collab;
}

/** Authenticate against the real cloud snapshots; no request interception or injected rows. */
export async function expectCalendarRowsInCloud(
  page: Page,
  request: APIRequestContext,
  identity: CalendarStorageIdentity,
  expected: CalendarStoredRow[]
): Promise<void> {
  const token = await page.evaluate(() => localStorage.getItem('af_auth_token'));

  if (!token) throw new Error('Calendar placeholder tests require an authenticated cloud account');
  await expect(async () => {
    const { workspaceId, databaseId, viewId, primaryFieldId, dateFieldId } = identity;
    const snapshot = await readCloudCollab(request, token, workspaceId, databaseId, 1);
    const orders = snapshot.database?.views?.[viewId]?.row_orders as
      | Array<{ id: string; is_deleted?: boolean }>
      | undefined;

    expect(orders, 'Cloud snapshot must contain the tested calendar view').toBeDefined();
    const ids = orders!
      .filter((row) => !row.is_deleted)
      .map((row) => row.id)
      .sort();

    expect(ids, 'Cloud membership includes only intentional calendar rows').toEqual(
      expected.map((row) => row.id).sort()
    );
    const rows = await Promise.all(
      ids.map(async (id): Promise<CalendarStoredRow> => {
        const rowSnapshot = await readCloudCollab(request, token, workspaceId, id, 4);
        const row = rowSnapshot.data;

        expect(row?.id).toBe(id);
        expect(row?.database_id).toBe(databaseId);
        const date = row.cells?.[dateFieldId];

        return {
          id,
          title: String(row.cells?.[primaryFieldId]?.data ?? ''),
          start: String(date?.data ?? ''),
          end: String(date?.end_timestamp ?? ''),
          includeTime: Boolean(date?.include_time),
          isRange: Boolean(date?.is_range),
        };
      })
    );

    expect(rows).toEqual(expected);
  }).toPass({ timeout: 45_000, intervals: [300, 500, 1000] });
}

export async function switchPlaceholderCalendarView(page: Page, name: string): Promise<void> {
  if (name !== 'Month' && name !== 'Week') throw new Error(`Unsupported calendar view ${name}`);
  await switchCalendarView(page, name);
}

export async function clickOutsideCalendarDraft(page: Page): Promise<void> {
  const title = CalendarSelectors.title(page).filter({ visible: true }).first();
  const box = await title.boundingBox();

  if (!box) throw new Error('Calendar toolbar title is not visible');
  // A modal popover owns the pointer barrier, so exercise the real outside click.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
