import { expect, type Locator, type Page } from '@playwright/test';

import { FieldType } from '../../src/application/database-yjs/database.type';


import { getActiveDatabaseFields, setCellDirect } from './gallery-test-helpers';
import { waitForDatabaseTestContext } from './relation-test-helpers';
import { DatabaseViewSelectors } from './selectors';

import type { YDatabase, YDatabaseRow } from '../../src/application/types';
import type { DatabaseTestWindow } from '../../src/components/database/database-test-context';

export interface TimelineCell {
  start: number | null;
  end: number | null;
  isRange: boolean;
  includeTime: boolean;
  reminder: string;
}

// These helpers read the real row collabs. Only fixture construction writes via
// the test bridge; the When steps use the mounted UI and actual pointer events.
export async function readTimelineCell(page: Page, rowId: string, fieldId: string): Promise<TimelineCell> {
  await waitForDatabaseTestContext(page);
  return page.evaluate(
    async ({ rowId, fieldId }) => {
      const ctx = (window as DatabaseTestWindow).__TEST_DATABASE_CONTEXT__!;
      const doc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow?.(rowId));

      if (!doc) throw new Error(`Row ${rowId} is unavailable`);
      const cell = (doc.getMap('data').get('data') as YDatabaseRow).get('cells').get(fieldId);
      const number = (value: unknown) => (value === undefined || value === null || value === '' ? null : Number(value));

      return {
        start: number(cell?.get('data')),
        end: number(cell?.get('end_timestamp')),
        isRange: Boolean(cell?.get('is_range')),
        includeTime: Boolean(cell?.get('include_time')),
        reminder: String(cell?.get('reminder_id') ?? ''),
      };
    },
    { rowId, fieldId }
  );
}

export async function readTimelineSettings(page: Page) {
  await waitForDatabaseTestContext(page);
  return page.evaluate(() => {
    const ctx = (window as DatabaseTestWindow).__TEST_DATABASE_CONTEXT__!;
    const view = (ctx.databaseDoc.getMap('data').get('database') as YDatabase).get('views').get(ctx.activeViewId);

    return {
      layout: Number(view.get('layout')),
      ...view.get('layout_settings').get('8').toJSON(),
    } as {
      layout: number;
      field_id: string;
      end_field_id: string;
      scale: string;
      show_table: boolean;
      table_width: number;
      table_field_ids: string[];
      bar_field_ids: string[];
    };
  });
}

export async function calendarShift(page: Page, timestamp: number, days: number): Promise<number> {
  // Deliberately independent of Timeline's geometry/snap implementation. This
  // uses browser calendar arithmetic so DST does not silently become 24 hours.
  return page.evaluate(
    ({ timestamp, days }) => {
      const date = new Date(timestamp * 1000);

      date.setDate(date.getDate() + days);
      return date.getTime() / 1000;
    },
    { timestamp, days }
  );
}

export async function todayTimestamp(page: Page): Promise<number> {
  return page.evaluate(() => {
    const date = new Date();

    date.setHours(0, 0, 0, 0);
    return date.getTime() / 1000;
  });
}

export async function seedTimelineDate(
  page: Page,
  rowId: string,
  fieldId: string,
  start: number,
  end: number | null,
  includeTime = false
) {
  await setCellDirect(page, rowId, fieldId, FieldType.DateTime, String(start), {
    end_timestamp: end === null ? '' : String(end),
    is_range: end !== null,
    include_time: includeTime,
    reminder_id: 'timeline-fixture-reminder',
  });
}

export async function addTimelineView(page: Page) {
  await DatabaseViewSelectors.addViewButton(page).click();
  await page.getByTestId('add-timeline-view-option').click();
  await expect(page.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  const settings = await readTimelineSettings(page);

  expect(settings.layout).toBe(8);
  expect((await getActiveDatabaseFields(page)).find((field) => field.id === settings.field_id)?.type).toBe(
    FieldType.DateTime
  );
  return settings;
}

export async function clearTimelineHistory(page: Page) {
  await page.evaluate(() => {
    const win = window as DatabaseTestWindow;

    win.__TEST_DATABASE_HISTORY__!.getOrCreateDatabaseHistoryManager(win.__TEST_DATABASE_CONTEXT__!.databaseDoc).clear();
  });
}

export async function timelineHistoryDepth(page: Page) {
  return page.evaluate(() => {
    const win = window as DatabaseTestWindow;
    const manager = win.__TEST_DATABASE_HISTORY__!.getOrCreateDatabaseHistoryManager(
      win.__TEST_DATABASE_CONTEXT__!.databaseDoc
    );

    return { undo: manager.canUndo(), redo: manager.canRedo() };
  });
}

export async function historyShortcut(page: Page, action: 'undo' | 'redo') {
  await page.keyboard.press(
    `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${action === 'redo' ? 'Shift+' : ''}z`
  );
}

export function timelineBar(page: Page, rowId: string) {
  return page.getByTestId(`timeline-bar-${rowId}`);
}

export async function chooseTimelineScale(page: Page, label: string) {
  await page.getByTestId('timeline-scale-button').click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await expect(page.getByTestId('timeline-scale-button')).toContainText(label);
}

export async function panTimeline(page: Page, pixels: number) {
  const viewport = page.getByTestId('timeline-viewport');
  const before = await viewport.evaluate((el) => el.scrollLeft);
  const box = (await viewport.boundingBox())!;

  await page.mouse.move(box.x + box.width - 100, box.y + 90);
  await page.mouse.wheel(pixels, 0);
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).not.toBe(before);
}

export async function pointerDrag(
  page: Page,
  target: Locator,
  pixels: number,
  finish: 'drop' | 'Escape' | 'pointercancel' | 'hold' = 'drop'
) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + pixels, y, { steps: 12 });
  if (finish === 'hold') return;
  if (finish === 'Escape') await page.keyboard.press('Escape');
  // Browser/OS pointer cancellation cannot be generated by a mouse gesture.
  // Dispatch only that event; the preceding drag uses real browser input.
  if (finish === 'pointercancel') await target.dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  await page.mouse.up();
}

export async function openTimelineSubmenu(page: Page, name: string) {
  await page.getByTestId('database-actions-settings').click();
  const trigger = page.getByRole('menuitem', { name, exact: true });

  await trigger.hover();
  const submenu = page.locator('[data-slot="dropdown-menu-sub-content"]:visible').last();

  await expect(submenu).toBeVisible();
  const box = (await submenu.boundingBox())!;
  const triggerBox = (await trigger.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, triggerBox.y + triggerBox.height / 2, { steps: 12 });
  return submenu;
}

export async function closeTimelineMenus(page: Page) {
  for (let count = 0; count < 3; count++) await page.keyboard.press('Escape');
}
