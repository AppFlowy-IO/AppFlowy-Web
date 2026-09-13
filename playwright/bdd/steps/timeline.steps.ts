import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { DatabaseViewLayout } from '../../../src/application/types';
import { FieldType } from '../../../src/application/database-yjs/database.type';
import {
  getCurrentDatabaseInfo,
  setRelationCellDirect,
  waitForDatabaseTestContext,
} from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import {
  CalendarSelectors,
  DatabaseViewSelectors,
  RowDetailSelectors,
  TimelineSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import {
  activeViewRowIds,
  addTimelineView,
  barBox,
  chooseTimelineSettingsOption,
  chooseTimelineZoom,
  clickRowCanvas,
  dragBarBy,
  readBarSamples,
  startBarSampler,
  dragHandleBy,
  expectBarWidth,
  expectBarX,
  injectFieldDirect,
  loginAndCreateCalendarWithRows,
  MONTH_COLUMN_WIDTH,
  readProgressPercent,
  setTextCellDirect,
  TIMELINE_SIDEBAR_WIDTH,
  TimelineLayout,
  type BarBox,
} from '../../support/timeline-test-helpers';

const { Given, When, Then } = createBdd();

const ZOOM_BY_NAME: Record<string, TimelineLayout> = {
  Hours: TimelineLayout.Hours,
  Day: TimelineLayout.Day,
  Week: TimelineLayout.Week,
  'Bi-week': TimelineLayout.BiWeek,
  Month: TimelineLayout.Month,
  Quarter: TimelineLayout.Quarter,
  Year: TimelineLayout.Year,
};

interface TimelineScenario {
  /** Row ids in view order; index 0 is the first Background row. */
  rowIds: string[];
  rowIdByTitle: Map<string, string>;
  /** Bar boxes captured right before the last drag, keyed by title. */
  before: Map<string, BarBox>;
  /** Columns "Design" was dragged in the avoid-weekends scenario. */
  weekendShift?: number;
}

const scenarios = new WeakMap<Page, TimelineScenario>();

function scenario(page: Page): TimelineScenario {
  const state = scenarios.get(page);

  if (!state) throw new Error('Add a Timeline view before using timeline steps');
  return state;
}

function rowId(page: Page, title: string): string {
  const id = scenario(page).rowIdByTitle.get(title);

  if (!id) throw new Error(`Unknown timeline row "${title}"`);
  return id;
}

async function remember(page: Page, ...titles: string[]) {
  const state = scenario(page);

  for (const title of titles) state.before.set(title, await barBox(page, title));
}

function before(page: Page, title: string): BarBox {
  const box = scenario(page).before.get(title);

  if (!box) throw new Error(`No remembered position for "${title}"`);
  return box;
}

async function visibleCanvas(page: Page) {
  const view = await TimelineSelectors.view(page).boundingBox();

  if (!view) throw new Error('Timeline view is not visible');
  return { left: view.x + TIMELINE_SIDEBAR_WIDTH, right: view.x + view.width };
}

Given(
  'a cloud calendar with {string} today and {string} in {int} days',
  async ({ page, request, $testInfo }, first, second, offset) => {
    $testInfo.setTimeout(240_000);
    await loginAndCreateCalendarWithRows(page, request, generateRandomEmail(), [
      { title: first, offsetDays: 0 },
      { title: second, offsetDays: offset },
    ]);
    scenarios.set(page, { rowIds: [], rowIdByTitle: new Map(), before: new Map() });
  }
);

Given('a Timeline view is added from the view menu', async ({ page }) => {
  await addTimelineView(page, 2);
  await waitForDatabaseTestContext(page);
  const state = scenario(page);

  state.rowIds = await activeViewRowIds(page);
  // Background rows were created in order, so they map onto the view order.
  const titles = await TimelineSelectors.sidebarRows(page).allTextContents();

  titles.forEach((title, index) => state.rowIdByTitle.set(title.trim(), state.rowIds[index]));
});

Then('the timeline shows bars for {string} and {string}', async ({ page }, first, second) => {
  await expect(TimelineSelectors.bars(page)).toHaveCount(2);
  await expect(TimelineSelectors.barByTitle(page, first)).toBeVisible();
  await expect(TimelineSelectors.barByTitle(page, second)).toBeVisible();
});

Then('the timeline header marks today and draws the today line', async ({ page }) => {
  await expect(TimelineSelectors.headerToday(page)).toBeVisible();
  await expect(TimelineSelectors.todayLine(page)).toBeVisible();
});

Then('the timeline title shows the current month', async ({ page }) => {
  const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  await expect(TimelineSelectors.title(page)).toHaveText(month);
});

Then('the timeline scale reads {string}', async ({ page }, scale) => {
  await expect(TimelineSelectors.zoomTrigger(page)).toHaveText(new RegExp(scale));
});

Then('the timeline table lists {string} and {string}', async ({ page }, first, second) => {
  await expect(TimelineSelectors.sidebarRows(page)).toHaveCount(2);
  await expect(TimelineSelectors.sidebarRows(page).filter({ hasText: first })).toBeVisible();
  await expect(TimelineSelectors.sidebarRows(page).filter({ hasText: second })).toBeVisible();
});

When('I choose the {string} timeline scale', async ({ page }, scale) => {
  const layout = ZOOM_BY_NAME[scale];

  if (layout === undefined) throw new Error(`Unknown scale "${scale}"`);
  await chooseTimelineZoom(page, layout);
});

Then('the timeline header cells show weekday names', async ({ page }) => {
  // Calendar-style week header: "Mon 15", or "Thu Oct 1" on the first of a month.
  await expect(TimelineSelectors.headerToday(page)).toHaveText(/^[A-Z][a-z]{2} (?:[A-Z][a-z]{2} )?\d{1,2}$/);
});

Then('the timeline still shows {int} bars', async ({ page }, count) => {
  await expect(TimelineSelectors.bars(page)).toHaveCount(count);
});

When('I reload the timeline', async ({ page }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(TimelineSelectors.view(page)).toBeVisible({ timeout: 30_000 });
  await expect(TimelineSelectors.bars(page)).toHaveCount(2, { timeout: 15_000 });
});

When('I step the timeline later {int} times', async ({ page }, times) => {
  for (let i = 0; i < times; i += 1) {
    await TimelineSelectors.stepNext(page).click();
    await page.waitForTimeout(400);
  }
});

When('I step the timeline earlier {int} times', async ({ page }, times) => {
  for (let i = 0; i < times; i += 1) {
    await TimelineSelectors.stepPrevious(page).click();
    await page.waitForTimeout(400);
  }
});

Then('the {string} bar is off screen to the left with a left pill', async ({ page }, title) => {
  const canvas = await visibleCanvas(page);

  await expect
    .poll(async () => (await barBox(page, title)).x + (await barBox(page, title)).width, { timeout: 10_000 })
    .toBeLessThan(canvas.left);
  await expect(
    TimelineSelectors.row(page, rowId(page, title)).locator('[data-testid="timeline-offscreen-left"]')
  ).toBeVisible();
});

Then('the {string} bar is off screen to the right with a right pill', async ({ page }, title) => {
  const canvas = await visibleCanvas(page);

  await expect.poll(async () => (await barBox(page, title)).x, { timeout: 10_000 }).toBeGreaterThan(canvas.right);
  await expect(
    TimelineSelectors.row(page, rowId(page, title)).locator('[data-testid="timeline-offscreen-right"]')
  ).toBeVisible();
});

When('I click the left off-screen pill', async ({ page }) => {
  await TimelineSelectors.offscreenLeft(page).first().click();
});

Then('the {string} bar is visible', async ({ page }, title) => {
  await expect
    .poll(
      async () => {
        const canvas = await visibleCanvas(page);
        const box = await barBox(page, title);

        return box.x >= canvas.left && box.x + box.width <= canvas.right;
      },
      { timeout: 10_000 }
    )
    .toBe(true);
});

When('I click the timeline Today button', async ({ page }) => {
  await TimelineSelectors.today(page).click();
});

When('I drag the {string} bar {int} columns later', async ({ page }, title, columns) => {
  await remember(page, 'Design', 'Build');
  await dragBarBy(page, title, columns * MONTH_COLUMN_WIDTH);
});

When('I drag the {string} bar {int} columns earlier', async ({ page }, title, columns) => {
  await remember(page, 'Design', 'Build');
  await dragBarBy(page, title, -columns * MONTH_COLUMN_WIDTH);
});

Then('the {string} bar moved {int} columns later', async ({ page }, title, columns) => {
  await expectBarX(page, title, before(page, title).x + columns * MONTH_COLUMN_WIDTH);
});

When('I drag the {string} bar {int} columns later while sampling its position', async ({ page }, title, columns) => {
  await remember(page, 'Design', 'Build');
  await startBarSampler(page, title);
  await dragBarBy(page, title, columns * MONTH_COLUMN_WIDTH);
  // Long enough to cover the selectors' 150 ms remote debounce, which is where a snap-back would show.
  await page.waitForTimeout(400);
});

Then(
  'the {string} bar never painted back where it started after landing {int} columns later',
  async ({ page }, title, columns) => {
    const origin = Math.round(before(page, title).x);
    const target = Math.round(origin + columns * MONTH_COLUMN_WIDTH);
    const samples = await readBarSamples(page);
    // Frames before the pointer crossed the drag threshold still show the origin.
    const firstMoved = samples.findIndex((left) => left !== origin);

    expect(firstMoved, `bar never moved: ${samples.join(',')}`).toBeGreaterThanOrEqual(0);
    // Once it moved, no later frame may show the origin again: that would be
    // the bar snapping back while the row data caught up.
    expect(samples.slice(firstMoved), `bar snapped back after the drop: ${samples.join(',')}`).not.toContain(origin);
    await expectBarX(page, title, target);
  }
);

When('I press undo', async ({ page }) => {
  await page.keyboard.press('Control+z');
});

Then('the {string} bar is back where it started', async ({ page }, title) => {
  const box = before(page, title);

  await expectBarX(page, title, box.x);
  await expectBarWidth(page, title, box.width);
});

When('I drag the end handle of {string} {int} columns later', async ({ page }, title, columns) => {
  await remember(page, 'Design', 'Build');
  await dragHandleBy(page, TimelineSelectors.handleEnd(page, rowId(page, title)), columns * MONTH_COLUMN_WIDTH);
});

Then('the {string} bar grew by {int} columns', async ({ page }, title, columns) => {
  await expectBarWidth(page, title, before(page, title).width + columns * MONTH_COLUMN_WIDTH);
});

Then('the header highlights nothing once the drag ends', async ({ page }) => {
  await expect(TimelineSelectors.headerHighlight(page)).toHaveCount(0);
  await expect(TimelineSelectors.dragLabel(page)).toHaveCount(0);
});

When('I start dragging the {string} bar and press Escape', async ({ page }, title) => {
  await remember(page, title);
  const box = before(page, title);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 4; step += 1) await page.mouse.move(x + step * MONTH_COLUMN_WIDTH, y);
  // Mid-drag the header echoes the span and the bar shows its date label.
  await expect(TimelineSelectors.headerHighlight(page)).toBeVisible();
  await expect(TimelineSelectors.dragLabel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

When('I hover the {string} bar', async ({ page }, title) => {
  const box = await barBox(page, title);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
});

Then('the timeline hover card shows {string} with a one day duration', async ({ page }, title) => {
  const card = TimelineSelectors.hoverCard(page);

  await expect(card).toBeVisible({ timeout: 5_000 });
  await expect(card).toContainText(title);
  await expect(card).toContainText('1 day');
});

When('I click the table row {string}', async ({ page }, title) => {
  await TimelineSelectors.sidebarRow(page, rowId(page, title)).click();
});

Then('the {string} row and bar are selected', async ({ page }, title) => {
  const id = rowId(page, title);

  await expect(TimelineSelectors.row(page, id)).toHaveAttribute('data-selected', 'true');
  await expect(TimelineSelectors.bar(page, id)).toHaveAttribute('data-selected', 'true');
});

When('I click the empty canvas of the {string} row', async ({ page }, title) => {
  // Far right of the visible canvas, well clear of any bar.
  const view = await TimelineSelectors.view(page).boundingBox();
  const rowBox = await TimelineSelectors.row(page, rowId(page, title)).boundingBox();

  if (!view || !rowBox) throw new Error('Timeline row is not visible');
  await page.mouse.click(view.x + view.width - 60, rowBox.y + rowBox.height / 2);
});

Then('no timeline row is selected', async ({ page }) => {
  await expect(page.locator('[data-testid^="timeline-row-"][data-selected="true"]')).toHaveCount(0);
});

When('I open the table row {string}', async ({ page }, title) => {
  const id = rowId(page, title);

  await TimelineSelectors.sidebarRow(page, id).hover();
  await TimelineSelectors.openRow(page, id).click();
});

Then('the row detail for {string} opens', async ({ page }, title) => {
  await expect(RowDetailSelectors.titleInput(page)).toBeVisible();
  await expect(RowDetailSelectors.titleInput(page)).toHaveText(title);
  await closeRowDetailWithEscape(page);
});

When('I add a new timeline row', async ({ page }) => {
  await TimelineSelectors.newRow(page).click();
  await expect(TimelineSelectors.sidebarRows(page)).toHaveCount(3, { timeout: 15_000 });
  await closeRowDetailWithEscape(page);
  const state = scenario(page);

  state.rowIds = await activeViewRowIds(page);
});

Then('the timeline table lists {int} rows and the No Date button reads {string}', async ({ page }, count, text) => {
  await expect(TimelineSelectors.sidebarRows(page)).toHaveCount(count);
  await expect(TimelineSelectors.noDateButton(page)).toContainText(text);
});

When("I click the undated row's canvas", async ({ page }) => {
  const emptyRow = TimelineSelectors.emptyRows(page).first();
  const testId = await emptyRow.getAttribute('data-testid');
  const id = testId?.replace('timeline-row-empty-', '');

  if (!id) throw new Error('No undated row to date');
  await clickRowCanvas(page, id);
});

Then('the timeline shows {int} bars and no No Date button', async ({ page }, count) => {
  await expect(TimelineSelectors.bars(page)).toHaveCount(count, { timeout: 10_000 });
  await expect(TimelineSelectors.noDateButton(page)).toHaveCount(0);
});

When('I hide the timeline table', async ({ page }) => {
  await TimelineSelectors.toggleTable(page).click();
});

When('I show the timeline table', async ({ page }) => {
  await TimelineSelectors.toggleTable(page).click();
});

Then('the timeline table is hidden and {int} bars remain', async ({ page }, count) => {
  await expect(TimelineSelectors.sidebarRows(page)).toHaveCount(0);
  await expect(TimelineSelectors.bars(page)).toHaveCount(count);
});

Then('the timeline table lists {int} rows', async ({ page }, count) => {
  await expect(TimelineSelectors.sidebarRows(page)).toHaveCount(count);
});

Given('{string} depends on {string} through a relation field', async ({ page }, dependent, dependency) => {
  const { databaseId } = await getCurrentDatabaseInfo(page);
  const state = scenario(page);
  const dependentIndex = state.rowIds.indexOf(rowId(page, dependent));

  await injectFieldDirect(page, {
    fieldId: 'rel-deps',
    name: 'Blocked by',
    fieldType: FieldType.Relation,
    typeOption: { database_id: databaseId, is_two_way: false, source_limit: 0, target_limit: 0 },
  });
  await setRelationCellDirect(page, 'rel-deps', dependentIndex, [rowId(page, dependency)]);
  await chooseTimelineSettingsOption(page, 'timeline-dependency-field-rel-deps');
});

Given('a relation field is bound as the dependency field', async ({ page }) => {
  const { databaseId } = await getCurrentDatabaseInfo(page);

  await injectFieldDirect(page, {
    fieldId: 'rel-deps',
    name: 'Blocked by',
    fieldType: FieldType.Relation,
    typeOption: { database_id: databaseId, is_two_way: false, source_limit: 0, target_limit: 0 },
  });
  await chooseTimelineSettingsOption(page, 'timeline-dependency-field-rel-deps');
});

const SHIFT_OPTION: Record<string, number> = {
  'Only when dates overlap': 0,
  'Keep the time between items': 1,
  Never: 2,
};

Given('dependents shift with {string}', async ({ page }, option) => {
  await chooseTimelineSettingsOption(page, `timeline-shift-${SHIFT_OPTION[option]}`);
});

Given('dependents avoid weekends', async ({ page }) => {
  await chooseTimelineSettingsOption(page, 'timeline-avoid-weekends');
});

Then('the {string} bar starts {int} columns before the {string} bar', async ({ page }, title, columns, other) => {
  await expectBarX(page, title, (await barBox(page, other)).x - columns * MONTH_COLUMN_WIDTH);
});

/**
 * "Design" is today and "Build" two days later. Move Design so its end lands on
 * a Saturday: the pushed Build would start there, so avoid-weekends must put
 * it on Monday instead. `columns` is at least 2 so Build actually overlaps.
 */
When('I drag the {string} bar so that {string} would land on a Saturday', async ({ page }, title, follower) => {
  await remember(page, 'Design', 'Build');
  const today = new Date().getDay();
  let columns = (12 - today) % 7; // (today + 1 + columns) % 7 === 6

  if (columns < 2) columns += 7;
  scenario(page).weekendShift = columns;
  await dragBarBy(page, title, columns * MONTH_COLUMN_WIDTH);
  await expect(TimelineSelectors.barByTitle(page, follower)).toBeVisible();
});

Then('the {string} bar starts on the following Monday', async ({ page }, title) => {
  const columns = scenario(page).weekendShift ?? 0;

  // Saturday = the day after Design's new last day, Monday two days on; Build began on day 2.
  await expectBarX(page, title, before(page, title).x + (columns + 3 - 2) * MONTH_COLUMN_WIDTH);
});

When('I drag the connector of {string} onto the {string} bar', async ({ page }, source, target) => {
  const sourceBar = TimelineSelectors.barByTitle(page, source);
  const targetBox = await barBox(page, target);

  await sourceBar.hover();
  const handle = sourceBar.locator('[data-testid^="timeline-link-"]');
  const handleBox = await handle.boundingBox();

  if (!handleBox) throw new Error('Link handle is not visible');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await expect(page.getByTestId('timeline-link-preview')).toBeVisible();
  await page.mouse.up();
});

Then('{string} depends on {string}', async ({ page }, dependent, dependency) => {
  const dependentId = rowId(page, dependent);
  const dependencyId = rowId(page, dependency);

  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ dependentId }) => {
            const ctx = (window as unknown as { __TEST_DATABASE_CONTEXT__: any }).__TEST_DATABASE_CONTEXT__;
            const rowDoc = ctx.rowMap?.[dependentId] ?? (await ctx.ensureRow(dependentId));
            const cell = rowDoc.getMap('data').get('data').get('cells').get('rel-deps');
            const data = cell?.get('data');

            return data?.toArray ? data.toArray() : data ?? [];
          },
          { dependentId }
        ),
      { timeout: 10_000 }
    )
    .toContain(dependencyId);
});

Then('the timeline draws {int} dependency arrow', async ({ page }, count) => {
  await expect(TimelineSelectors.arrows(page)).toHaveCount(count, { timeout: 15_000 });
});

Then('the {string} bar starts where the {string} bar starts', async ({ page }, title, other) => {
  await expectBarX(page, title, (await barBox(page, other)).x);
});

Given('{string} has a progress field at {int} percent', async ({ page }, title, percent) => {
  await injectFieldDirect(page, {
    fieldId: 'num-progress',
    name: 'Progress',
    fieldType: FieldType.Number,
    typeOption: { format: 0 },
  });
  await setTextCellDirect(page, rowId(page, title), 'num-progress', FieldType.Number, String(percent));
  await chooseTimelineSettingsOption(page, 'timeline-progress-field-num-progress');
});

Then('the {string} bar shows {int} percent progress', async ({ page }, title, percent) => {
  await expect.poll(() => readProgressPercent(page, rowId(page, title)), { timeout: 15_000 }).toBe(percent);
});

Then('the timeline hover card for {string} mentions {string}', async ({ page }, title, text) => {
  const box = await barBox(page, title);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(TimelineSelectors.hoverCard(page)).toContainText(text, { timeout: 5_000 });
});

When('I drag the progress handle of {string} halfway across the bar', async ({ page }, title) => {
  const box = await barBox(page, title);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await dragHandleBy(page, TimelineSelectors.handleProgress(page, rowId(page, title)), box.width / 2);
});

Then('the {string} bar shows more than {int} percent progress', async ({ page }, title, percent) => {
  await expect.poll(() => readProgressPercent(page, rowId(page, title)), { timeout: 10_000 }).toBeGreaterThan(percent);
});

// ---------------------------------------------------------------------------
// Scales, redo, pills, No Date list, keyboard, settings, layout, empty state
// ---------------------------------------------------------------------------

const LAYOUT_BY_NAME: Record<string, DatabaseViewLayout> = {
  Grid: DatabaseViewLayout.Grid,
  Board: DatabaseViewLayout.Board,
  Calendar: DatabaseViewLayout.Calendar,
  Timeline: DatabaseViewLayout.Timeline,
};

Then('the timeline header has labels', async ({ page }) => {
  // Cell presets label columns; the Year preset labels month segments instead.
  const labelled = TimelineSelectors.header(page).locator('span').filter({ hasText: /\S/ });

  await expect(labelled.first()).toBeVisible();
  expect(await labelled.count()).toBeGreaterThan(0);
});

When('I press redo', async ({ page }) => {
  await page.keyboard.press('Control+Shift+z');
});

When('I click the right off-screen pill', async ({ page }) => {
  await TimelineSelectors.offscreenRight(page).first().click();
});

When('I open the No Date list', async ({ page }) => {
  await TimelineSelectors.noDateButton(page).click();
});

Then('the No Date list shows {int} undated row', async ({ page }, count) => {
  await expect(page.getByTestId('no-date-row')).toHaveCount(count);
});

When('I close the No Date list', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('no-date-row')).toHaveCount(0);
});

When('I focus the {string} bar and press Enter', async ({ page }, title) => {
  await TimelineSelectors.barButton(page, title).focus();
  await page.keyboard.press('Enter');
});

When('I double-click the table row {string}', async ({ page }, title) => {
  await TimelineSelectors.sidebarRow(page, rowId(page, title)).dblclick();
});

Given('{string} also has a {string} field {int} days later', async ({ page }, title, fieldName, days) => {
  const state = scenario(page);

  await injectFieldDirect(page, {
    fieldId: 'date-ship',
    name: fieldName,
    fieldType: FieldType.DateTime,
    typeOption: { date_format: 0, time_format: 0, timezone_id: '' },
  });
  const design = await barBox(page, 'Design');
  const other = rowId(page, title);
  const timestamp = await page.evaluate((offsetDays) => {
    const date = new Date();

    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offsetDays);
    return String(Math.floor(date.getTime() / 1000));
  }, days);

  // Every row needs a value on the new field so the rows stay dated; Design keeps today.
  await setTextCellDirect(
    page,
    rowId(page, 'Design'),
    'date-ship',
    FieldType.DateTime,
    await page.evaluate(() => {
      const date = new Date();

      date.setHours(0, 0, 0, 0);
      return String(Math.floor(date.getTime() / 1000));
    })
  );
  await setTextCellDirect(page, other, 'date-ship', FieldType.DateTime, timestamp);
  state.before.set('Design', design);
});

When('I choose {string} as the timeline date field', async ({ page }, fieldName) => {
  await page.getByTestId('database-actions-settings').click();
  await TimelineSelectors.settingsTrigger(page).click();
  await page.locator('[data-testid^="timeline-date-field-"]').filter({ hasText: fieldName }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

Then('the {string} bar sits {int} days after the {string} bar', async ({ page }, title, days, other) => {
  await expectBarX(page, title, (await barBox(page, other)).x + days * MONTH_COLUMN_WIDTH);
});

When('I toggle the table from the timeline settings', async ({ page }) => {
  await chooseTimelineSettingsOption(page, 'timeline-show-table');
});

When('I choose Monday as the timeline week start', async ({ page }) => {
  await chooseTimelineSettingsOption(page, 'timeline-first-day-1');
});

Then('the timeline quarter labels fall on Mondays', async ({ page }) => {
  // Quarter labels sit on week starts; the first week of each month carries the
  // month name ("Oct 5"), which is enough to resolve the weekday unambiguously.
  const labels = await TimelineSelectors.header(page)
    .locator('span')
    .filter({ hasText: /^[A-Z][a-z]{2} \d{1,2}$/ })
    .allTextContents();
  const year = new Date().getFullYear();

  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    const [monthName, day] = label.trim().split(' ');
    const month = new Date(`${monthName} 1, ${year}`).getMonth();

    expect(new Date(year, month, Number(day)).getDay()).toBe(1);
  }
});

When('I switch to the {string} view tab', async ({ page }, name) => {
  await DatabaseViewSelectors.viewTab(page).filter({ hasText: name }).first().click();
});

When('I change the view layout to {string}', async ({ page }, name) => {
  const layout = LAYOUT_BY_NAME[name];

  if (layout === undefined) throw new Error(`Unknown layout "${name}"`);
  await page.getByTestId('database-actions-settings').click();
  await DatabaseViewSelectors.layoutSettingsTrigger(page).hover();
  await expect(DatabaseViewSelectors.layoutOption(page, layout)).toBeVisible({ timeout: 10_000 });
  await DatabaseViewSelectors.layoutOption(page, layout).click();
  if (layout === DatabaseViewLayout.Timeline) {
    await expect(TimelineSelectors.view(page)).toBeVisible({ timeout: 30_000 });
    await waitForDatabaseTestContext(page);
  }
});

Then('the calendar view is shown', async ({ page }) => {
  await expect(CalendarSelectors.calendarContainer(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(TimelineSelectors.view(page)).toHaveCount(0);
});

When("the timeline's date field is deleted from the database", async ({ page }) => {
  await page.evaluate(() => {
    const ctx = (window as unknown as { __TEST_DATABASE_CONTEXT__: any }).__TEST_DATABASE_CONTEXT__;
    const doc = ctx.databaseDoc;
    const database = doc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    const fieldId = view.get('layout_settings').get('8').get('field_id');

    doc.transact(() => {
      database.get('fields').delete(fieldId);
      database.get('views').forEach((candidate: any) => {
        const orders = candidate.get('field_orders');
        const index = orders.toArray().findIndex((order: { id: string }) => order.id === fieldId);

        if (index >= 0) orders.delete(index, 1);
        candidate.get('field_settings').delete(fieldId);
      });
    });
  });
});

Then('the timeline explains that it has no date property', async ({ page }) => {
  await expect(page.getByTestId('timeline-unsupported')).toBeVisible({ timeout: 15_000 });
});

// --- Table row actions (Notion's hover gutter) -------------------------------

function sidebarCell(page: Page, title: string) {
  return page.locator('[data-testid^="timeline-sidebar-cell-"]').filter({ hasText: title }).first();
}

async function sidebarTitles(page: Page): Promise<string[]> {
  const titles = await TimelineSelectors.sidebarRows(page).allInnerTexts();

  return titles.map((title) => title.trim());
}

When('I click the hover {string} of the table row {string}', async ({ page }, _plus, title) => {
  const cell = sidebarCell(page, title);

  await cell.hover();
  await cell.locator('[data-testid^="list-row-add-below-"]').click();
});

const ROW_MENU_ITEM: Record<string, string> = {
  'Insert above': 'row-menu-insert-above',
  'Insert below': 'row-menu-insert-below',
  Duplicate: 'row-menu-duplicate',
  Delete: 'row-menu-delete',
};

async function chooseRowMenuItem(page: Page, cell: ReturnType<Page['locator']>, action: string) {
  await cell.hover();
  await cell.getByTestId('row-accessory-button').click();
  await page.getByTestId('list-row-action-menu').getByTestId(ROW_MENU_ITEM[action]).click();
  if (action === 'Delete') {
    await page.getByTestId('delete-row-confirm-button').click();
    await expect(page.getByTestId('delete-row-confirm-button')).toHaveCount(0);
  }
}

When('I open the row menu of the table row {string} and choose {string}', async ({ page }, title, action) => {
  await chooseRowMenuItem(page, sidebarCell(page, title), action);
});

When('I open the row menu of the last table row and choose {string}', async ({ page }, action) => {
  await chooseRowMenuItem(page, page.locator('[data-testid^="timeline-sidebar-cell-"]').last(), action);
});

Then('the table lists {string} in that order', async ({ page }, list) => {
  const expected = list.split(',').map((title: string) => title.trim().replace(/^"|"$/g, ''));

  await expect.poll(() => sidebarTitles(page), { timeout: 15_000 }).toEqual(expected);
});

Then('the timeline shows {int} bars', async ({ page }, count) => {
  await expect(TimelineSelectors.bars(page)).toHaveCount(count, { timeout: 15_000 });
});

When('I drag the table row {string} above {string}', async ({ page }, source, target) => {
  const sourceCell = sidebarCell(page, source);
  const targetCell = sidebarCell(page, target);

  await sourceCell.hover();
  const handle = sourceCell.getByTestId('row-accessory-button');
  const handleBox = await handle.boundingBox();
  const targetBox = await targetCell.boundingBox();

  if (!handleBox || !targetBox) throw new Error('Row handle or target is not visible');
  const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  // Aim at the top quarter of the target so the closest edge resolves to "top".
  const end = { x: targetBox.x + 60, y: targetBox.y + Math.min(targetBox.height * 0.15, 5) };

  await page.mouse.move(start.x, start.y, { steps: 10 });
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(start.x + 6, start.y - 4, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.waitForTimeout(200);
  await page.mouse.up();
});
