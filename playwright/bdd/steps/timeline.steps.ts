import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { FieldType } from '../../../src/application/database-yjs/database.type';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import {
  addFilterByFieldName,
  clickFilterChip,
  deleteFilter,
  enterFilterText,
  generateRandomEmail,
  loginAndCreateGrid,
  setupPageErrorHandling,
} from '../../support/filter-test-helpers';
import {
  createFieldDirect,
  getActiveRowIds,
  seedPrimaryTitlesDirect,
  setCellDirect,
} from '../../support/gallery-test-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { HeaderSelectors, RowDetailSelectors } from '../../support/selectors';
import { addSortByFieldName, closeSortMenu, openSortMenu, toggleSortDirection } from '../../support/sort-test-helpers';
import {
  addTimelineView,
  calendarShift,
  chooseTimelineScale,
  clearTimelineHistory,
  closeTimelineMenus,
  historyShortcut,
  openTimelineSubmenu,
  panTimeline,
  pointerDrag,
  readTimelineCell,
  readTimelineSettings,
  seedTimelineDate,
  timelineBar,
  timelineHistoryDepth,
  todayTimestamp,
  type TimelineCell,
} from '../../support/timeline-test-helpers';

import type { YDatabase } from '../../../src/application/types';
import type { DatabaseTestWindow } from '../../../src/components/database/database-test-context';

const { Given, When, Then } = createBdd();

interface TimelineState {
  rowIds: string[];
  fieldId: string;
  phaseId: string;
  before: TimelineCell[];
  expected?: TimelineCell;
  finishId?: string;
  finishBefore?: TimelineCell;
  remote?: Page;
  documentId?: string;
  addedId?: string;
  today: number;
  autoScrollMinimum?: number;
  tableWidth?: number;
}
const states = new WeakMap<Page, TimelineState>();

function state(page: Page) {
  const value = states.get(page);

  if (!value) throw new Error('Timeline fixture has not been initialized');
  return value;
}

const alphaBar = (page: Page) => timelineBar(page, state(page).rowIds[0]);
const alphaButton = (page: Page) => alphaBar(page).locator('button').first();

async function readAll(page: Page) {
  const s = state(page);

  return Promise.all(s.rowIds.map((id) => readTimelineCell(page, id, s.fieldId)));
}

async function expectAlpha(page: Page, expected: TimelineCell) {
  const s = state(page);

  await expect.poll(() => readTimelineCell(page, s.rowIds[0], s.fieldId)).toEqual(expected);
}

async function snapshot(page: Page) {
  state(page).before = await readAll(page);
  await clearTimelineHistory(page);
}

Given('an editable Timeline with Alpha and Beta scheduled and Gamma without dates', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAndCreateGrid(page, request, generateRandomEmail());
  const rowIds = await seedPrimaryTitlesDirect(page, ['Alpha', 'Beta', 'Gamma']);
  const settings = await addTimelineView(page);
  const phaseId = await createFieldDirect(page, {
    name: 'Phase',
    fieldType: FieldType.SingleSelect,
    selectOptions: [{ id: 'ready', name: 'Ready' }],
  });
  const today = await todayTimestamp(page);

  states.set(page, { rowIds, fieldId: settings.field_id, phaseId, before: [], today });
  await seedTimelineDate(page, rowIds[0], settings.field_id, today, await calendarShift(page, today, 2));
  await seedTimelineDate(
    page,
    rowIds[1],
    settings.field_id,
    await calendarShift(page, today, 4),
    await calendarShift(page, today, 6)
  );
  await setCellDirect(page, rowIds[0], phaseId, FieldType.SingleSelect, 'ready');
  await expect(page.locator('[data-testid^="timeline-bar-"]')).toHaveCount(2);
  await expect(alphaBar(page)).toContainText('Alpha');
  // Leave enough visible room on either side for backwards dragging. Wheel
  // input exercises the normal scroll path instead of changing component state.
  await panTimeline(page, -252);
  await snapshot(page);
});

When('I drag the Alpha Timeline bar by {int} calendar days', async ({ page }, days: number) => {
  await pointerDrag(page, alphaButton(page), days * 36);
});
When(
  'I resize the Alpha Timeline {word} handle by {int} calendar days',
  async ({ page }, handle: string, days: number) => {
    await alphaBar(page).hover();
    await pointerDrag(
      page,
      alphaBar(page).getByRole('button', { name: `Resize ${handle} of Alpha`, exact: true }),
      days * 36
    );
  }
);
Then("Alpha's start and end dates both shift by {int} calendar days", async ({ page }, days: number) => {
  const s = state(page);

  s.expected = {
    ...s.before[0],
    start: await calendarShift(page, s.before[0].start!, days),
    end: await calendarShift(page, s.before[0].end!, days),
  };
  await expectAlpha(page, s.expected);
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
});
Then(
  "Alpha's start shifts by {int} days and its end shifts by {int} days",
  async ({ page }, start: number, end: number) => {
    const s = state(page);

    s.expected = {
      ...s.before[0],
      start: await calendarShift(page, s.before[0].start!, start),
      end: await calendarShift(page, s.before[0].end!, end),
    };
    await expectAlpha(page, s.expected);
  }
);
Then('the other Timeline rows and the date reminder are unchanged', async ({ page }) => {
  const s = state(page);
  const cells = await readAll(page);

  expect(cells.slice(1)).toEqual(s.before.slice(1));
  expect(cells[0].reminder).toBe(s.before[0].reminder);
});
Then('one Timeline undo and redo restores both endpoints together', async ({ page }) => {
  const s = state(page);

  s.expected = await readTimelineCell(page, s.rowIds[0], s.fieldId);
  await alphaButton(page).focus();
  await historyShortcut(page, 'undo');
  await expectAlpha(page, s.before[0]);
  expect(await timelineHistoryDepth(page)).toEqual({ undo: false, redo: true });
  await historyShortcut(page, 'redo');
  await expectAlpha(page, s.expected);
});
Then('the Timeline dates survive reload', async ({ page }) => {
  const s = state(page);
  const expected = await readAll(page);
  const ids = await getActiveRowIds(page);
  const added = s.addedId ? await readTimelineCell(page, s.addedId, s.fieldId) : undefined;

  await page.reload();
  await expect(page.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => readAll(page)).toEqual(expected);
  expect(await getActiveRowIds(page)).toEqual(ids);
  if (added) expect(await readTimelineCell(page, s.addedId!, s.fieldId)).toEqual(added);
});

When(
  /^I press (\S+) on the Alpha Timeline (bar|start handle|end handle)$/,
  async ({ page }, shortcut: string, target: string) => {
    const button =
      target === 'bar'
        ? alphaButton(page)
        : alphaBar(page).getByRole('button', {
            name: `Resize ${target.split(' ')[0]} of Alpha`,
            exact: true,
          });

    await button.focus();
    await page.keyboard.press(shortcut);
  }
);
Then('no Timeline row detail is open', async ({ page }) => {
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
});
Given('Alpha has a single all-day date', async ({ page }) => {
  const s = state(page);

  await seedTimelineDate(page, s.rowIds[0], s.fieldId, s.today, null);
  await snapshot(page);
});
Then("Alpha's single date shifts by {int} days and remains a single date", async ({ page }, days: number) => {
  const s = state(page);

  await expectAlpha(page, {
    ...s.before[0],
    start: await calendarShift(page, s.before[0].start!, days),
    end: null,
    isRange: false,
  });
});
Given('Alpha has a timed range from 09:00 to 11:00 today on the Hour scale', async ({ page }) => {
  const s = state(page);
  const start = await page.evaluate((timestamp) => {
    const date = new Date(timestamp * 1000);

    date.setHours(9);
    return date.getTime() / 1000;
  }, s.today);

  await seedTimelineDate(page, s.rowIds[0], s.fieldId, start, start + 7200, true);
  await chooseTimelineScale(page, 'Hours');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await snapshot(page);
});
When('I drag the timed Alpha bar by {int} pixels', async ({ page }, pixels: number) => {
  await pointerDrag(page, alphaButton(page), pixels);
});
Then('both Alpha times move by {int} minutes and time display stays enabled', async ({ page }, minutes: number) => {
  const s = state(page);

  await expectAlpha(page, {
    ...s.before[0],
    start: s.before[0].start! + minutes * 60,
    end: s.before[0].end! + minutes * 60,
    includeTime: true,
  });
});
When('I drag Alpha for three days and cancel with {word}', async ({ page }, event: 'Escape' | 'pointercancel') => {
  await pointerDrag(page, alphaButton(page), 108, event);
});
Then('all Timeline date values remain unchanged with no undo action', async ({ page }) => {
  await expect.poll(() => readAll(page)).toEqual(state(page).before);
  expect(await timelineHistoryDepth(page)).toEqual({ undo: false, redo: false });
});
Then('all Timeline date values remain unchanged', async ({ page }) => {
  await expect.poll(() => readAll(page)).toEqual(state(page).before);
});
Then("Alpha's dates remain unchanged", async ({ page }) => {
  await expectAlpha(page, state(page).before[0]);
});

When('I hold the Alpha bar at the right edge until the Timeline auto-scrolls', async ({ page }) => {
  const s = state(page);
  const viewport = page.getByTestId('timeline-viewport');
  const box = (await viewport.boundingBox())!;
  const bar = (await alphaButton(page).boundingBox())!;
  const before = await viewport.evaluate((el) => el.scrollLeft);
  const startX = bar.x + bar.width / 2;
  const endX = box.x + box.width - 8;

  s.autoScrollMinimum = Math.round((endX - startX) / 36);
  await page.mouse.move(startX, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(endX, bar.y + bar.height / 2, { steps: 12 });
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before + 108);
  await page.mouse.up();
});
Then('the committed Alpha range includes the auto-scrolled days', async ({ page }) => {
  const s = state(page);

  await expect
    .poll(async () => (await readTimelineCell(page, s.rowIds[0], s.fieldId)).start)
    .toBeGreaterThan(await calendarShift(page, s.before[0].start!, s.autoScrollMinimum!));
  const after = await readTimelineCell(page, s.rowIds[0], s.fieldId);

  expect(after.end).toBe(await calendarShift(page, after.start!, 2));
  expect(after.includeTime).toBe(false);
  const hours = await page.evaluate((start) => new Date(start! * 1000).getHours(), after.start);

  expect(hours).toBe(0);
});

When('I open Alpha from its Timeline {word}', async ({ page }, target: string) => {
  if (target === 'bar') await alphaButton(page).click();
  else
    await page
      .getByTestId(`timeline-row-${state(page).rowIds[0]}`)
      .getByRole('button', { name: 'Alpha', exact: true })
      .click();
});
Then('the row detail shows Alpha and can rename it to Alpha revised', async ({ page }) => {
  const title = RowDetailSelectors.titleInput(page).last();

  await expect(title).toHaveValue('Alpha');
  await title.fill('Alpha revised');
  await title.press('Tab');
  await closeRowDetailWithEscape(page);
  await expect(alphaBar(page)).toContainText('Alpha revised');
});

When('I search the Timeline no-date list for Gamma and schedule it', async ({ page }) => {
  await page.getByTestId('timeline-no-date-button').click();
  await page.getByRole('searchbox', { name: 'Search unscheduled rows' }).fill('Gamma');
  await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await closeTimelineMenus(page);
});
Then('Gamma has a three-day all-day range and leaves the no-date list', async ({ page }) => {
  const s = state(page);

  await expect(timelineBar(page, s.rowIds[2])).toBeVisible();
  await expect(page.getByTestId('timeline-no-date-button')).toHaveCount(0);
  const cell = await readTimelineCell(page, s.rowIds[2], s.fieldId);

  expect(cell.end).toBe(await calendarShift(page, cell.start!, 2));
  expect(cell).toMatchObject({ isRange: true, includeTime: false });
});
Then('scheduling Gamma can be undone and redone', async ({ page }) => {
  const s = state(page);
  const expected = await readTimelineCell(page, s.rowIds[2], s.fieldId);

  await timelineBar(page, s.rowIds[2]).locator('button').first().focus();
  await historyShortcut(page, 'undo');
  await expect.poll(() => readTimelineCell(page, s.rowIds[2], s.fieldId)).toEqual(s.before[2]);
  await expect(page.getByTestId('timeline-no-date-button')).toContainText('1');
  // Undo removes the focused bar; focus the surviving table row to keep the
  // database's normal keyboard scope active before redo.
  await page.getByTestId(`timeline-row-${s.rowIds[2]}`).getByRole('button', { name: 'Gamma', exact: true }).focus();
  await historyShortcut(page, 'redo');
  await expect.poll(() => readTimelineCell(page, s.rowIds[2], s.fieldId)).toEqual(expected);
});
When("I double-click Gamma's empty Timeline track five days after today", async ({ page }) => {
  const s = state(page);
  const alpha = (await alphaBar(page).boundingBox())!;
  const gamma = (await page.getByTestId(`timeline-row-${s.rowIds[2]}`).boundingBox())!;

  await page.mouse.dblclick(alpha.x + 5 * 36 + 8, gamma.y + gamma.height / 2);
});
Then('Gamma is scheduled five days after today with a three-day inclusive range', async ({ page }) => {
  const s = state(page);

  await expect
    .poll(() => readTimelineCell(page, s.rowIds[2], s.fieldId))
    .toMatchObject({
      start: await calendarShift(page, s.today, 5),
      end: await calendarShift(page, s.today, 7),
      isRange: true,
      includeTime: false,
    });
});
When('I create a Timeline row named Delta with the New button', async ({ page }) => {
  const s = state(page);

  await page.getByTestId('timeline-new-row').click();
  const title = RowDetailSelectors.titleInput(page).last();

  await expect(title).toBeVisible();
  await title.fill('Delta');
  await title.press('Tab');
  await closeRowDetailWithEscape(page);
  await expect.poll(() => getActiveRowIds(page)).toHaveLength(4);
  s.addedId = (await getActiveRowIds(page)).find((id) => !s.rowIds.includes(id));
});
Then('Delta exists once in the database with a three-day inclusive date range', async ({ page }) => {
  const s = state(page);

  await expect(timelineBar(page, s.addedId!)).toContainText('Delta');
  expect((await getActiveRowIds(page)).filter((id) => id === s.addedId)).toHaveLength(1);
  const cell = await readTimelineCell(page, s.addedId!, s.fieldId);

  expect(cell.end).toBe(await calendarShift(page, cell.start!, 2));
  expect(cell.isRange).toBe(true);
});

When('I drag the Gamma table row before Alpha', async ({ page }) => {
  const s = state(page);
  const gamma = page.getByRole('button', { name: 'Reorder Gamma', exact: true });
  const alpha = (await page.getByTestId(`timeline-row-${s.rowIds[0]}`).boundingBox())!;

  await gamma.hover();
  const box = (await gamma.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 - 6, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2 + 30, alpha.y + 3, { steps: 20 });
  await page.mouse.up();
});
Then('the Timeline row order is Gamma Alpha Beta and the dates are unchanged', async ({ page }) => {
  const s = state(page);

  await expect.poll(() => getActiveRowIds(page)).toEqual([s.rowIds[2], s.rowIds[0], s.rowIds[1]]);
  await expect.poll(() => readAll(page)).toEqual(s.before);
});
Then('the reordered Timeline rows survive reload', async ({ page }) => {
  const s = state(page);

  await page.reload();
  await expect(page.getByTestId('timeline-viewport')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => getActiveRowIds(page)).toEqual([s.rowIds[2], s.rowIds[0], s.rowIds[1]]);
});

When('I visit every Timeline zoom level and navigate previous next and Today', async ({ page }) => {
  for (const label of ['Hours', 'Day', 'Week', '2 weeks', 'Month', 'Quarter', 'Year']) {
    await chooseTimelineScale(page, label);
    expect((await readTimelineSettings(page)).scale).toBe(
      { Hours: 'hour', Day: 'day', Week: 'week', '2 weeks': 'biweek', Month: 'month', Quarter: 'quarter', Year: 'year' }[
        label
      ]
    );
    // Each navigation must change the rendered period and return Today to the
    // visible viewport. Date values are checked separately below.
    const before = await page.getByTestId('timeline-visible-period').textContent();

    await page.getByRole('button', { name: 'Next period', exact: true }).click();
    if (['Month', 'Quarter', 'Year'].includes(label))
      await expect(page.getByTestId('timeline-visible-period')).not.toHaveText(before!);
    await page.getByRole('button', { name: 'Previous period', exact: true }).click();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    const marker = page.getByTestId('timeline-today-marker');
    const viewport = page.getByTestId('timeline-viewport');

    await expect(marker).toBeAttached();
    const markerBox = (await marker.boundingBox())!;
    const viewportBox = (await viewport.boundingBox())!;

    expect(markerBox.x).toBeGreaterThanOrEqual(viewportBox.x);
    expect(markerBox.x).toBeLessThan(viewportBox.x + viewportBox.width);
  }
});
Then('the selected Timeline zoom survives reload', async ({ page }) => {
  await page.reload();
  await expect(page.getByTestId('timeline-scale-button')).toHaveText(/Year/, { timeout: 30_000 });
  expect((await readTimelineSettings(page)).scale).toBe('year');
});
When('I show the Date table property and the Phase bar property', async ({ page }) => {
  await openTimelineSubmenu(page, 'Table properties');
  await page.getByRole('menuitemcheckbox', { name: 'Date', exact: true }).click();
  await closeTimelineMenus(page);
  await openTimelineSubmenu(page, 'Properties on bars');
  await page.getByRole('menuitemcheckbox', { name: 'Phase', exact: true }).click();
  await closeTimelineMenus(page);
});
When('I widen the Timeline title column by {int} pixels', async ({ page }, pixels: number) => {
  const s = state(page);

  const separator = page.getByRole('separator', { name: 'Resize name column' });

  s.tableWidth = Number(await separator.getAttribute('aria-valuenow')) + pixels;
  await pointerDrag(page, separator, pixels);
});
Then('the Timeline shows those properties in their chosen locations', async ({ page }) => {
  const s = state(page);
  const settings = await readTimelineSettings(page);

  expect(settings.table_field_ids).toEqual([s.fieldId]);
  expect(settings.bar_field_ids).toEqual([s.phaseId]);
  expect(Number(settings.table_width)).toBe(s.tableWidth);
  await expect(alphaBar(page)).toContainText('Ready');
  await expect(page.getByTestId(`timeline-table-cell-${s.rowIds[0]}-${s.fieldId}`)).not.toBeEmpty();
  await expect(page.getByTestId(`timeline-table-cell-${s.rowIds[0]}-${s.phaseId}`)).toHaveCount(0);
});
Then('the Timeline table settings survive reload and hiding the table', async ({ page }) => {
  const before = await readTimelineSettings(page);

  await page.reload();
  await expect(page.getByTestId('timeline-viewport')).toBeVisible({ timeout: 30_000 });
  expect(await readTimelineSettings(page)).toEqual(before);
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('separator', { name: 'Resize name column' })).toHaveCount(0);
  await expect(alphaBar(page)).toContainText('Ready');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-pressed', 'false', {
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('separator', { name: 'Resize name column' })).toHaveAttribute(
    'aria-valuenow',
    String(state(page).tableWidth)
  );
});

When('I group the Timeline by Phase', async ({ page }) => {
  await page.getByTestId('database-actions-settings').click();
  await page.getByTestId('timeline-group-settings-trigger').hover();
  await page.getByTestId(`timeline-group-by-field-${state(page).phaseId}`).click();
  await closeTimelineMenus(page);
});
Then('the Ready and No Phase groups contain the correct rows', async ({ page }) => {
  const viewport = page.getByTestId('timeline-viewport');

  await expect(viewport.getByRole('button', { expanded: true }).filter({ hasText: 'Ready' })).toContainText('1');
  await expect(viewport.getByRole('button', { expanded: true }).filter({ hasText: 'No Phase' })).toContainText('2');
  await expect(alphaBar(page)).toBeVisible();
});
Then('grouped Timeline rows cannot be manually reordered', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^Reorder / })).toHaveCount(0);
});
When('I collapse and reopen the Ready Timeline group', async ({ page }) => {
  const group = page
    .getByTestId('timeline-viewport')
    .getByRole('button')
    .filter({ hasText: /^.*Ready.*1$/ });

  await group.click();
  await expect(alphaBar(page)).toHaveCount(0);
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await group.click();
  await expect(alphaBar(page)).toBeVisible();
});
When('I search the Timeline for Beta', async ({ page }) => {
  await page.getByTestId('database-actions-search').click();
  await page.getByTestId('database-actions-search-input').fill('Beta');
});
Then('only Beta is visible in the Timeline', async ({ page }) => {
  const s = state(page);

  await expect(page.locator('[data-testid^="timeline-row-"]')).toHaveCount(1);
  await expect(timelineBar(page, s.rowIds[1])).toContainText('Beta');
});
When('I clear the Timeline search', async ({ page }) => {
  await page.getByTestId('database-actions-search-clear').click();
});
Then('Alpha Beta and Gamma are visible with unchanged dates', async ({ page }) => {
  await expect(page.locator('[data-testid^="timeline-row-"]')).toHaveCount(3);
  await expect.poll(() => readAll(page)).toEqual(state(page).before);
});

Given('the Timeline uses separate Start and Finish date properties', async ({ page }) => {
  const s = state(page);
  const startId = await createFieldDirect(page, { name: 'Start', fieldType: FieldType.DateTime });

  s.finishId = await createFieldDirect(page, { name: 'Finish', fieldType: FieldType.DateTime });
  await seedTimelineDate(page, s.rowIds[0], startId, s.today, null);
  await seedTimelineDate(page, s.rowIds[0], s.finishId, await calendarShift(page, s.today, 2), null);
  await openTimelineSubmenu(page, 'Timeline by');
  await page.getByRole('menuitem', { name: 'Start', exact: true }).click();
  await closeTimelineMenus(page);
  await openTimelineSubmenu(page, 'End date');
  await page.getByRole('menuitem', { name: 'Finish', exact: true }).click();
  await closeTimelineMenus(page);
  s.fieldId = startId;
  s.finishBefore = await readTimelineCell(page, s.rowIds[0], s.finishId);
  await snapshot(page);
});
Then('both separate date fields shift by two days in one undo action', async ({ page }) => {
  const s = state(page);
  const startAfter = { ...s.before[0], start: await calendarShift(page, s.before[0].start!, 2) };
  const endAfter = { ...s.finishBefore!, start: await calendarShift(page, s.finishBefore!.start!, 2) };

  await expectAlpha(page, startAfter);
  await expect.poll(() => readTimelineCell(page, s.rowIds[0], s.finishId!)).toEqual(endAfter);
  await alphaButton(page).focus();
  await historyShortcut(page, 'undo');
  await expectAlpha(page, s.before[0]);
  expect(await readTimelineCell(page, s.rowIds[0], s.finishId!)).toEqual(s.finishBefore);
  expect(await timelineHistoryDepth(page)).toEqual({ undo: false, redo: true });
  await historyShortcut(page, 'redo');
  await expectAlpha(page, startAfter);
  expect(await readTimelineCell(page, s.rowIds[0], s.finishId!)).toEqual(endAfter);
});
Then('the separate Timeline date configuration survives reload', async ({ page }) => {
  const s = state(page);
  const start = await readTimelineCell(page, s.rowIds[0], s.fieldId);
  const end = await readTimelineCell(page, s.rowIds[0], s.finishId!);

  await page.reload();
  await expect(page.getByTestId('timeline-viewport')).toBeVisible({ timeout: 30_000 });
  expect(await readTimelineSettings(page)).toMatchObject({ field_id: s.fieldId, end_field_id: s.finishId });
  await expectAlpha(page, start);
  expect(await readTimelineCell(page, s.rowIds[0], s.finishId!)).toEqual(end);
});
Given("Alpha's end date is before its start date", async ({ page }) => {
  const s = state(page);

  await seedTimelineDate(page, s.rowIds[0], s.fieldId, s.today, await calendarShift(page, s.today, -2));
  await snapshot(page);
});
Then('Alpha shows an invalid-range message instead of a draggable bar', async ({ page }) => {
  await expect(alphaBar(page)).toHaveCount(0);
  await expect(page.getByTestId(`timeline-row-${state(page).rowIds[0]}`)).toContainText('End date is before start date');
});
Then('Alpha cannot be scheduled from the no-date list until its dates are repaired', async ({ page }) => {
  await page.getByTestId('timeline-no-date-button').click();
  await page.getByRole('searchbox', { name: 'Search unscheduled rows' }).fill('Alpha');
  await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(0);
  await closeTimelineMenus(page);
});
Given('Alpha is scheduled {int} days from today', async ({ page }, days: number) => {
  const s = state(page);

  await seedTimelineDate(
    page,
    s.rowIds[0],
    s.fieldId,
    await calendarShift(page, s.today, days),
    await calendarShift(page, s.today, days + 2)
  );
  await snapshot(page);
});
When("I use Alpha's Jump to dates control", async ({ page }) => {
  await page
    .getByTestId(`timeline-row-${state(page).rowIds[0]}`)
    .getByRole('button', { name: 'Jump to dates', exact: true })
    .click();
});
Then('the Alpha bar is inside the visible Timeline calendar', async ({ page }) => {
  await expect(alphaBar(page)).toBeInViewport({ ratio: 0.9 });
  await expect(
    page.getByTestId(`timeline-row-${state(page).rowIds[0]}`).getByRole('button', { name: 'Jump to dates', exact: true })
  ).toHaveCount(0);
});
When('I filter the Timeline Name to contain Beta', async ({ page }) => {
  await addFilterByFieldName(page, 'Name');
  await clickFilterChip(page);
  await enterFilterText(page, 'Beta');
  await closeTimelineMenus(page);
});
When('I remove the Timeline filter and sort Name descending', async ({ page }) => {
  await deleteFilter(page);
  await closeTimelineMenus(page);
  await addSortByFieldName(page, 'Name');
  await openSortMenu(page);
  await toggleSortDirection(page);
  await closeSortMenu(page);
});
Then('the visible Timeline order is Gamma Beta Alpha with no reorder handles', async ({ page }) => {
  const s = state(page);

  await expect
    .poll(() =>
      page
        .locator('[data-testid^="timeline-row-"]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')))
    )
    .toEqual([s.rowIds[2], s.rowIds[1], s.rowIds[0]].map((id) => `timeline-row-${id}`));
  await expect(page.getByRole('button', { name: /^Reorder / })).toHaveCount(0);
});
When('I choose Created time as the Timeline date property', async ({ page }) => {
  const created = await createFieldDirect(page, { name: 'Created time', fieldType: FieldType.CreatedTime });

  await openTimelineSubmenu(page, 'Timeline by');
  await page.getByRole('menuitem', { name: 'Created time', exact: true }).click();
  await closeTimelineMenus(page);
  expect((await readTimelineSettings(page)).field_id).toBe(created);
  await clearTimelineHistory(page);
});
Then('generated Timeline dates have no resize or scheduling controls', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^Resize (start|end) of / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(0);
});
Then('dragging or using edit shortcuts cannot change generated dates', async ({ page }) => {
  await pointerDrag(page, alphaButton(page), 72);
  await alphaButton(page).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => readAll(page)).toEqual(state(page).before);
  expect(await timelineHistoryDepth(page)).toEqual({ undo: false, redo: false });
});
Given('the selected Timeline date property is removed', async ({ page }) => {
  // Fixture represents a concurrent schema change; recovery itself uses the UI.
  await page.evaluate((fieldId) => {
    const ctx = (window as DatabaseTestWindow).__TEST_DATABASE_CONTEXT__!;

    (ctx.databaseDoc.getMap('data').get('database') as YDatabase).get('fields').delete(fieldId);
  }, state(page).fieldId);
  await expect(page.getByText('Choose a date property to display this timeline.')).toBeVisible();
});
When('I add a replacement date property from the Timeline empty state', async ({ page }) => {
  await page.getByRole('button', { name: 'Timeline by', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add date property', exact: true }).click();
});
Then('the Timeline has a valid editable date property again', async ({ page }) => {
  await expect(page.getByTestId('timeline-viewport')).toBeVisible();
  expect((await readTimelineSettings(page)).field_id).not.toBe(state(page).fieldId);
  await expect(page.getByTestId('timeline-no-date-button')).toContainText('3');
});

Given('the same Timeline is open in a second browser tab', async ({ page, context }) => {
  const s = state(page);

  s.remote = await context.newPage();
  await s.remote.goto(page.url());
  await expect(s.remote.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => readTimelineCell(s.remote!, s.rowIds[0], s.fieldId)).toEqual(s.before[0]);
});
Then('the second Timeline receives the exact committed dates', async ({ page }) => {
  const s = state(page);
  const expected = {
    ...s.before[0],
    start: await calendarShift(page, s.before[0].start!, 2),
    end: await calendarShift(page, s.before[0].end!, 2),
  };

  await expect.poll(() => readTimelineCell(s.remote!, s.rowIds[0], s.fieldId)).toEqual(expected);
  await expect(timelineBar(s.remote!, s.rowIds[0]).locator('button').first()).toHaveAttribute(
    'aria-label',
    (await alphaButton(page).getAttribute('aria-label'))!
  );
});
When("I move Alpha one more day using the second Timeline's keyboard", async ({ page }) => {
  const s = state(page);

  await timelineBar(s.remote!, s.rowIds[0]).locator('button').first().focus();
  await s.remote!.keyboard.press('Alt+ArrowRight');
});
Then("the first Timeline receives the second tab's dates", async ({ page }) => {
  const s = state(page);

  await expectAlpha(page, {
    ...s.before[0],
    start: await calendarShift(page, s.before[0].start!, 3),
    end: await calendarShift(page, s.before[0].end!, 3),
  });
});
When('a collaborator moves Alpha while my three-day drag is in progress', async ({ page }) => {
  const s = state(page);

  await pointerDrag(page, alphaButton(page), 108, 'hold');
  await timelineBar(s.remote!, s.rowIds[0]).locator('button').first().focus();
  await s.remote!.keyboard.press('Alt+ArrowRight');
  s.expected = {
    ...s.before[0],
    start: await calendarShift(page, s.before[0].start!, 1),
    end: await calendarShift(page, s.before[0].end!, 1),
  };
  await expectAlpha(page, s.expected);
  await page.mouse.up();
});
Then("my stale drop is rejected and both tabs keep the collaborator's dates", async ({ page }) => {
  const s = state(page);

  await expect(page.getByText('These dates changed while you were editing. Please try again.')).toBeVisible();
  await expectAlpha(page, s.expected!);
  expect(await readTimelineCell(s.remote!, s.rowIds[0], s.fieldId)).toEqual(s.expected);
});

Given('I create a standalone Timeline from the sidebar', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Timeline');
  await expect(page.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
});
Given('I insert an inline Timeline in a document', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAndWaitForApp(page, request, generateRandomEmail());
  const documentId = await createDocumentPageAndNavigate(page);
  const editor = page.locator(`#editor-${documentId}`);

  await editor.click({ position: { x: 200, y: 100 }, force: true });
  await page.keyboard.type('/timeline');
  await page.getByTestId('slash-menu-timeline').click();
  // New database creation can open its page modal; close it to inspect the
  // actual inline instance and inherit the enclosing document's lock status.
  await expect(page.getByTestId('view-modal-close')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('view-modal-close').click();
  await expect(editor.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  const settings = await readTimelineSettings(page);

  states.set(page, {
    documentId,
    rowIds: [],
    fieldId: settings.field_id,
    phaseId: '',
    before: [],
    today: await todayTimestamp(page),
  });
});
Then('it has the native Timeline layout and an editable date property', async ({ page }) => {
  const settings = await readTimelineSettings(page);

  expect(settings.layout).toBe(8);
  expect(settings.field_id).not.toBe('');
  await expect(page.getByTestId('timeline-new-row')).toBeVisible();
});
Then('reopening the page renders the Timeline', async ({ page }) => {
  await page.reload();
  await expect(page.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  expect((await readTimelineSettings(page)).layout).toBe(8);
});
Then('reopening the document renders its inline Timeline', async ({ page }) => {
  const documentId = state(page).documentId;

  await page.reload();
  await expect(page.locator(`#editor-${documentId}`).getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`#editor-${documentId}`).getByText('No rows match this view.', { exact: true })).toBeInViewport();
});
Given('that inline Timeline contains a scheduled row named Protected', async ({ page }) => {
  const s = state(page);

  await page.getByTestId('timeline-new-row').click();
  await RowDetailSelectors.titleInput(page).last().fill('Protected');
  await RowDetailSelectors.titleInput(page).last().press('Tab');
  await closeRowDetailWithEscape(page);
  s.rowIds = await getActiveRowIds(page);
  await snapshot(page);
});
Given('that inline Timeline is grouped by Phase', async ({ page }) => {
  const s = state(page);

  s.phaseId = await createFieldDirect(page, {
    name: 'Phase',
    fieldType: FieldType.SingleSelect,
    selectOptions: [{ id: 'ready', name: 'Ready' }],
  });
  await setCellDirect(page, s.rowIds[0], s.phaseId, FieldType.SingleSelect, 'ready');
  await page.getByTestId('database-actions-settings').click();
  await page.getByTestId('timeline-group-settings-trigger').hover();
  await page.getByTestId(`timeline-group-by-field-${s.phaseId}`).click();
  await closeTimelineMenus(page);
});
Then('expanding a read-only Timeline group changes no saved settings', async ({ page }) => {
  const readGroups = () =>
    page.evaluate(() => {
      const ctx = (window as DatabaseTestWindow).__TEST_DATABASE_CONTEXT__!;

      return (ctx.databaseDoc.getMap('data').get('database') as YDatabase)
        .get('views')
        .get(ctx.activeViewId)
        .get('groups')
        .toJSON();
    });
  const saved = await readGroups();
  const group = page
    .getByTestId('timeline-viewport')
    .getByRole('button', { expanded: true })
    .filter({ hasText: 'Ready' });

  await group.click();
  await expect(alphaBar(page)).toHaveCount(0);
  await page
    .getByTestId('timeline-viewport')
    .getByRole('button', { expanded: false })
    .filter({ hasText: 'Ready' })
    .click();
  await expect(alphaBar(page)).toBeVisible();
  expect(await readGroups()).toEqual(saved);
});
When('I lock the document containing the Timeline', async ({ page }) => {
  await HeaderSelectors.moreActionsButton(page).click();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().endsWith(`/page-view/${state(page).documentId}`)
  );

  await page.getByTestId('more-page-lock').click();
  const result = await (await saved).json();

  expect(result.code, result.message).toBe(0);
  await expect(page.getByTestId('page-locked-badge')).toBeVisible();
  await closeTimelineMenus(page);
});
Then('Timeline creation settings resize and reorder controls are unavailable', async ({ page }) => {
  await expect(page.getByTestId('timeline-new-row')).toHaveCount(0);
  await expect(page.getByTestId('database-actions-settings')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Resize (start|end) of / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Reorder / })).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Resize name column' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveCount(0);
});
Then('pointer and keyboard date edits leave the protected dates unchanged', async ({ page }) => {
  await pointerDrag(page, alphaButton(page), 72);
  // A read-only click may open the row; close it before the keyboard check.
  if (await RowDetailSelectors.modal(page).count()) await closeRowDetailWithEscape(page);
  await alphaButton(page).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+Shift+ArrowRight');
  await expect.poll(() => readAll(page)).toEqual(state(page).before);
});
Then('I can navigate zoom and open the protected row in read-only mode', async ({ page }) => {
  const savedScale = (await readTimelineSettings(page)).scale;

  await chooseTimelineScale(page, 'Week');
  expect((await readTimelineSettings(page)).scale).toBe(savedScale);
  await page.getByRole('button', { name: 'Next period', exact: true }).click();
  await page.getByRole('button', { name: 'Previous period', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await alphaButton(page).click();
  await expect(RowDetailSelectors.modal(page)).toContainText('Protected');
  await closeRowDetailWithEscape(page);
});
Then('the locked Timeline remains protected after reload', async ({ page }) => {
  await page.reload();
  await expect(page.getByTestId('page-locked-badge')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('database-timeline')).toBeVisible();
  await expect(page.getByTestId('timeline-new-row')).toHaveCount(0);
  await expect.poll(() => readAll(page)).toEqual(state(page).before);
});
