import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { TimelineLayout } from '../../src/application/database-yjs/database.type';

import { calendarDraftEditor, calendarDraftTitle } from './calendar-placeholder-helpers';
import { loginAndCreateCalendar } from './calendar-test-helpers';
import { DatabaseViewSelectors, TimelineSelectors } from './selectors';

/** Column width of the Month preset (`TIMELINE_SCALE_PRESETS[Month].columnWidth`). */
export const MONTH_COLUMN_WIDTH = 36;
/** Docked table width (`TIMELINE_SIDEBAR_WIDTH`). */
export const TIMELINE_SIDEBAR_WIDTH = 280;

export { TimelineLayout };

export interface BarBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isoDate(offsetDays: number) {
  const date = new Date();

  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(
    2,
    '0'
  )}`;
}

/** Create an all-day row through the calendar's placeholder editor. */
export async function createCalendarEvent(page: Page, offsetDays: number, title: string) {
  const cell = page.locator(`.fc-daygrid-day[data-date="${isoDate(offsetDays)}"]`);

  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();

  if (!box) throw new Error(`No calendar day cell for offset ${offsetDays}`);
  await page.mouse.click(box.x + box.width / 2, box.y + 10);
  await expect(calendarDraftEditor(page)).toBeVisible();
  await calendarDraftTitle(page).fill(title);
  await calendarDraftTitle(page).press('Enter');
  await expect(calendarDraftEditor(page)).toHaveCount(0);
}

/** Sign in, create a calendar database, and add the given all-day rows. */
export async function loginAndCreateCalendarWithRows(
  page: Page,
  request: APIRequestContext,
  email: string,
  rows: { title: string; offsetDays: number }[]
) {
  await loginAndCreateCalendar(page, request, email);
  for (const row of rows) {
    await createCalendarEvent(page, row.offsetDays, row.title);
  }

  await page.waitForTimeout(1500);
}

/** Add a Timeline view from the view tabs' + menu and wait for it to render. */
export async function addTimelineView(page: Page, expectedBars: number) {
  await DatabaseViewSelectors.addViewButton(page).click();
  await TimelineSelectors.addViewOption(page).click();
  await expect(TimelineSelectors.view(page)).toBeVisible({ timeout: 30_000 });
  await expect(TimelineSelectors.bars(page)).toHaveCount(expectedBars, { timeout: 15_000 });
}

export async function barBox(page: Page, title: string): Promise<BarBox> {
  const box = await TimelineSelectors.barButton(page, title).boundingBox();

  if (!box) throw new Error(`Bar "${title}" is not visible`);
  return box;
}

/** Press, travel `dx` pixels in small steps (crossing the drag threshold), release. */
export async function dragBy(page: Page, x: number, y: number, dx: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(x + (dx * step) / 6, y);
  }

  await page.mouse.up();
}

/**
 * Record the left edge of a bar on every animation frame until `readBarSamples`
 * is called, so a test can prove a dropped bar never paints at its old dates
 * while the row data catches up.
 */
export async function startBarSampler(page: Page, title: string) {
  await page.evaluate((title) => {
    const win = window as unknown as { __TIMELINE_BAR_SAMPLES__?: number[]; __TIMELINE_BAR_SAMPLER__?: number };
    const samples: number[] = [];
    const sample = () => {
      const bar = Array.from(document.querySelectorAll('[data-testid^="timeline-bar-"]')).find((element) =>
        element.textContent?.includes(title)
      );

      if (bar) samples.push(Math.round(bar.getBoundingClientRect().left));
      win.__TIMELINE_BAR_SAMPLER__ = requestAnimationFrame(sample);
    };

    win.__TIMELINE_BAR_SAMPLES__ = samples;
    win.__TIMELINE_BAR_SAMPLER__ = requestAnimationFrame(sample);
  }, title);
}

export async function readBarSamples(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const win = window as unknown as { __TIMELINE_BAR_SAMPLES__?: number[]; __TIMELINE_BAR_SAMPLER__?: number };

    if (win.__TIMELINE_BAR_SAMPLER__) cancelAnimationFrame(win.__TIMELINE_BAR_SAMPLER__);
    return win.__TIMELINE_BAR_SAMPLES__ ?? [];
  });
}

export async function dragBarBy(page: Page, title: string, dx: number) {
  const box = await barBox(page, title);

  await dragBy(page, box.x + box.width / 2, box.y + box.height / 2, dx);
}

export async function dragHandleBy(page: Page, handle: ReturnType<Page['getByTestId']>, dx: number) {
  const box = await handle.boundingBox();

  if (!box) throw new Error('Handle is not visible');
  await dragBy(page, box.x + box.width / 2, box.y + box.height / 2, dx);
}

export async function expectBarX(page: Page, title: string, x: number) {
  await expect.poll(async () => (await barBox(page, title)).x, { timeout: 10_000 }).toBeCloseTo(x, 0);
}

export async function expectBarWidth(page: Page, title: string, width: number) {
  await expect.poll(async () => (await barBox(page, title)).width, { timeout: 10_000 }).toBeCloseTo(width, 0);
}

/** Row ids of the active view, in view order. */
export async function activeViewRowIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ctx = (window as unknown as { __TEST_DATABASE_CONTEXT__: any }).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');

    return database
      .get('views')
      .get(ctx.activeViewId)
      .get('row_orders')
      .toArray()
      .map((row: { id: string }) => row.id);
  });
}

/** Test-only: inject a field straight into the database doc (no UI). */
export async function injectFieldDirect(
  page: Page,
  options: { fieldId: string; name: string; fieldType: number; typeOption?: Record<string, unknown> }
) {
  await page.evaluate((options) => {
    const win = window as unknown as { __TEST_DATABASE_CONTEXT__: any; Y: any };
    const ctx = win.__TEST_DATABASE_CONTEXT__;
    const Y = win.Y;
    const doc = ctx.databaseDoc;
    const database = doc.getMap('data').get('database');
    const now = String(Math.floor(Date.now() / 1000));
    const field = new Y.Map();
    const typeOptionMap = new Y.Map();
    const typeOption = new Y.Map();

    field.set('name', options.name);
    field.set('id', options.fieldId);
    field.set('ty', options.fieldType);
    field.set('created_at', now);
    field.set('last_modified', now);
    field.set('is_primary', false);
    field.set('icon', '');
    Object.entries(options.typeOption ?? {}).forEach(([key, value]) => typeOption.set(key, value));
    typeOptionMap.set(String(options.fieldType), typeOption);
    field.set('type_option', typeOptionMap);

    doc.transact(() => {
      database.get('fields').set(options.fieldId, field);
      database.get('views').forEach((view: any) => {
        const fieldOrders = view.get('field_orders');

        if (!fieldOrders.toArray().some((order: { id: string }) => order.id === options.fieldId)) {
          fieldOrders.push([{ id: options.fieldId }]);
        }

        const fieldSettings = view.get('field_settings');

        if (!fieldSettings.get(options.fieldId)) {
          const setting = new Y.Map();

          setting.set('visibility', 0);
          fieldSettings.set(options.fieldId, setting);
        }
      });
    });
  }, options);
}

/** Test-only: write a plain-text cell (e.g. a Number) straight into a row doc. */
export async function setTextCellDirect(page: Page, rowId: string, fieldId: string, fieldType: number, data: string) {
  await page.evaluate(
    async ({ rowId, fieldId, fieldType, data }) => {
      const win = window as unknown as { __TEST_DATABASE_CONTEXT__: any; Y: any };
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const Y = win.Y;
      const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow(rowId));
      const now = String(Math.floor(Date.now() / 1000));

      rowDoc.transact(() => {
        const row = rowDoc.getMap('data').get('data');
        const cells = row.get('cells');
        let cell = cells.get(fieldId);

        if (!cell) {
          cell = new Y.Map();
          cells.set(fieldId, cell);
        }

        cell.set('created_at', cell.get('created_at') || now);
        cell.set('last_modified', now);
        cell.set('field_type', fieldType);
        cell.set('data', data);
        row.set('last_modified', now);
      });
    },
    { rowId, fieldId, fieldType, data }
  );
}

/** Open ⚙ → Timeline settings → pick one option, then close the menus. */
export async function chooseTimelineSettingsOption(page: Page, optionTestId: string) {
  await page.getByTestId('database-actions-settings').click();
  await TimelineSelectors.settingsTrigger(page).click();
  await page.getByTestId(optionTestId).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

export async function chooseTimelineZoom(page: Page, layout: TimelineLayout) {
  await TimelineSelectors.zoomTrigger(page).click();
  await TimelineSelectors.zoomOption(page, layout).click();
}

/** Progress percentage rendered by the bar's fill, or -1 when absent. */
export async function readProgressPercent(page: Page, rowId: string): Promise<number> {
  const style = (await TimelineSelectors.progressFill(page, rowId).getAttribute('style')) ?? '';
  const match = /width:\s*(\d+)%/.exec(style);

  return match ? Number(match[1]) : -1;
}

/** Click inside the visible canvas of a row, `offset` px right of the docked table. */
export async function clickRowCanvas(page: Page, rowId: string, offset = 120) {
  const rowBox = await TimelineSelectors.row(page, rowId).boundingBox();
  const viewBox = await TimelineSelectors.view(page).boundingBox();

  if (!rowBox || !viewBox) throw new Error('Timeline row is not visible');
  await page.mouse.click(viewBox.x + TIMELINE_SIDEBAR_WIDTH + offset, rowBox.y + rowBox.height / 2);
}

/** Count Yjs updates applied to the given row docs from now on (see `readRowWrites`). */
export async function startCountingRowWrites(page: Page, rowIds: string[]) {
  await page.evaluate(async (rowIds) => {
    const win = window as unknown as { __TEST_DATABASE_CONTEXT__: any; __ROW_WRITES__?: Record<string, number> };
    const ctx = win.__TEST_DATABASE_CONTEXT__;
    const counts: Record<string, number> = {};

    for (const rowId of rowIds) {
      const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow(rowId));

      counts[rowId] = 0;
      rowDoc.on('update', () => {
        counts[rowId] += 1;
      });
    }

    win.__ROW_WRITES__ = counts;
  }, rowIds);
}

export async function readRowWrites(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => (window as unknown as { __ROW_WRITES__?: Record<string, number> }).__ROW_WRITES__ ?? {});
}

/** Press a bar and travel `dx` pixels in steps, leaving the pointer down. */
export async function pressAndMoveBar(page: Page, title: string, dx: number) {
  const box = await barBox(page, title);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(x + (dx * step) / 6, y);
  }
}
