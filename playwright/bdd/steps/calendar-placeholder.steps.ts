import { expect, type Page, type ElementHandle } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import {
  calendarDraftCards,
  calendarDraftEditor,
  calendarDraftTitle,
  calendarStorageIdentity,
  type CalendarStorageIdentity,
  type CalendarStoredRow,
  clickOutsideCalendarDraft,
  expectCalendarRowsInCloud,
  readCalendarStoredRows,
  switchPlaceholderCalendarView,
} from '../../support/calendar-placeholder-helpers';
import { loginAndCreateCalendar } from '../../support/calendar-test-helpers';
import { CalendarSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const { Given, When, Then } = createBdd();

interface PlaceholderScenario {
  email: string;
  url: string;
  identity: CalendarStorageIdentity;
  baselineCount: number;
  expectedRows: CalendarStoredRow[];
  viewport?: { grid: ElementHandle<Element>; scroller: ElementHandle<Element>; scrollTop: number };
  selected?: { start: string; end: string; includeTime: boolean };
}

const scenarios = new WeakMap<Page, PlaceholderScenario>();

function scenario(page: Page): PlaceholderScenario {
  const state = scenarios.get(page);

  if (!state) throw new Error('Initialize the cloud calendar before creating placeholders');
  return state;
}

async function rememberCalendarViewport(page: Page) {
  const grid = await page.locator('.fc-view').elementHandle();
  const scroller = await page.locator('.database-calendar').filter({ has: page.locator('.fc-view') }).evaluateHandle((element) => {
    let parent = element.parentElement;

    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    return parent ?? document.documentElement;
  });
  const scrollElement = scroller.asElement();

  if (!grid || !scrollElement) throw new Error('Calendar viewport is unavailable');
  scenario(page).viewport = {
    grid,
    scroller: scrollElement,
    scrollTop: await scrollElement.evaluate((node) => node.scrollTop),
  };
}

async function expectCalendarViewportUnchanged(page: Page) {
  const viewport = scenario(page).viewport;

  if (!viewport) throw new Error('Capture the calendar viewport before opening a placeholder');
  expect(await viewport.grid.evaluate((node) => node.isConnected)).toBe(true);
  expect(await viewport.scroller.evaluate((node) => node.isConnected)).toBe(true);
  expect(await viewport.scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(viewport.scrollTop, 0);
}

Given('a new cloud calendar is open for placeholder creation', async ({ page, request, $testInfo }) => {
  $testInfo.setTimeout(240_000);
  const email = generateRandomEmail();

  await loginAndCreateCalendar(page, request, email);
  const identity = await calendarStorageIdentity(page);
  const expectedRows = await readCalendarStoredRows(page, identity);

  scenarios.set(page, { email, url: page.url(), identity, baselineCount: expectedRows.length, expectedRows });
  await expectCalendarRowsInCloud(page, request, identity, expectedRows);
});

When('I click an empty day in the placeholder calendar', async ({ page }) => {
  const selected = await page.evaluate(() => {
    const today = new Date();

    today.setHours(0, 0, 0, 0);
    const end = new Date(today);

    end.setHours(23, 59, 0, 0);
    return {
      date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(
        2,
        '0'
      )}`,
      start: String(today.getTime() / 1000),
      end: String(end.getTime() / 1000),
      includeTime: false,
    };
  });
  const cell = page.locator(`.fc-daygrid-day[data-date="${selected.date}"]`);

  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();

  if (!box) throw new Error('Today has no calendar day cell');
  // The header strip stays empty when previously committed cards occupy the day.
  await rememberCalendarViewport(page);
  await page.mouse.click(box.x + box.width / 2, box.y + 10);
  await expect(calendarDraftEditor(page)).toBeVisible();
  scenario(page).selected = selected;
});

When('I switch the placeholder calendar to {string}', async ({ page }, name: string) => {
  await switchPlaceholderCalendarView(page, name);
});

When('I click the empty placeholder calendar slot at {int} hours', async ({ page }, hour: number) => {
  const selected = await page.evaluate((hour) => {
    const start = new Date();

    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);

    end.setHours(hour + 1);
    return {
      date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(
        2,
        '0'
      )}`,
      start: String(start.getTime() / 1000),
      end: String(end.getTime() / 1000),
      includeTime: true,
    };
  }, hour);
  const slot = page.locator(`.fc-timegrid-slot-lane[data-time="${String(hour).padStart(2, '0')}:00:00"]`);

  await slot.scrollIntoViewIfNeeded();
  const slotBox = await slot.boundingBox();
  const columnBox = await page.locator(`.fc-timegrid-col[data-date="${selected.date}"]`).boundingBox();

  if (!slotBox || !columnBox) throw new Error('The selected calendar time slot is not visible');
  await rememberCalendarViewport(page);
  await page.mouse.click(columnBox.x + columnBox.width / 2, slotBox.y + 3);
  await expect(calendarDraftEditor(page)).toBeVisible();
  scenario(page).selected = selected;
});

When('I name the calendar placeholder {string}', async ({ page }, title: string) => {
  await calendarDraftTitle(page).fill(title);
  await expect(calendarDraftTitle(page)).toHaveValue(title);
  await expect(calendarDraftCards(page)).toContainText(title);
});

Then('the calendar shows one local placeholder and no additional stored rows', async ({ page, request }) => {
  const state = scenario(page);

  await expect(calendarDraftEditor(page)).toBeVisible();
  await expect(calendarDraftCards(page)).toHaveCount(1);
  await expectCalendarViewportUnchanged(page);
  expect(await readCalendarStoredRows(page, state.identity)).toEqual(state.expectedRows);
  await expectCalendarRowsInCloud(page, request, state.identity, state.expectedRows);
});

When('I dismiss the calendar placeholder with Escape', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(calendarDraftEditor(page)).toHaveCount(0);
});

When('I dismiss the calendar placeholder by clicking outside', async ({ page }) => {
  await clickOutsideCalendarDraft(page);
  await expect(calendarDraftEditor(page)).toHaveCount(0);
});

When('I explicitly submit the calendar placeholder', async ({ page }) => {
  await calendarDraftTitle(page).press('Enter');
  await expect(calendarDraftEditor(page)).toHaveCount(0);
});

Then('the calendar has no placeholder and {int} additional stored rows', async ({ page, request }, count: number) => {
  const state = scenario(page);

  await expect(calendarDraftEditor(page)).toHaveCount(0);
  await expect(calendarDraftCards(page)).toHaveCount(0);
  await expectCalendarViewportUnchanged(page);
  expect(state.expectedRows).toHaveLength(state.baselineCount + count);
  await expect.poll(() => readCalendarStoredRows(page, state.identity)).toEqual(state.expectedRows);
  await expectCalendarRowsInCloud(page, request, state.identity, state.expectedRows);
});

Then(
  'the calendar stores exactly one new card named {string} with its selected dates',
  async ({ page }, title: string) => {
    const state = scenario(page);
    const previousIds = new Set(state.expectedRows.map((row) => row.id));

    await expect
      .poll(async () => (await readCalendarStoredRows(page, state.identity)).length)
      .toBe(previousIds.size + 1);
    const rows = await readCalendarStoredRows(page, state.identity);
    const inserted = rows.filter((row) => !previousIds.has(row.id));

    expect(inserted).toHaveLength(1);
    expect(rows.filter((row) => previousIds.has(row.id))).toEqual(state.expectedRows);
    const selected = state.selected;

    if (!selected) throw new Error('No calendar slot was selected before committing');
    expect(inserted[0]).toMatchObject({ title, start: selected.start, includeTime: selected.includeTime });
    if (selected.includeTime) {
      expect(inserted[0]).toMatchObject({ end: selected.end, isRange: true });
    } else {
      expect(inserted[0]).toMatchObject({ end: '', isRange: false });
    }
    await expect(
      CalendarSelectors.event(page)
        .filter({ hasText: title || 'Untitled' })
        .first()
    ).toBeVisible();
    state.expectedRows = rows;
  }
);

Then('only the committed calendar cards return in a fresh cloud browser session', async ({ page, request, browser }) => {
  const state = scenario(page);

  await expectCalendarRowsInCloud(page, request, state.identity, state.expectedRows);
  // A new context has neither the first browser's tokens nor its IndexedDB rows.
  const context = await browser.newContext({
    baseURL: new URL(state.url).origin,
    viewport: { width: 1440, height: 900 },
  });

  try {
    const freshPage = await context.newPage();

    await signInAndWaitForApp(freshPage, request, state.email);
    await freshPage.goto(state.url);
    await expect(CalendarSelectors.calendarContainer(freshPage).first()).toBeVisible({ timeout: 30_000 });
    expect(await calendarStorageIdentity(freshPage)).toEqual(state.identity);
    await expect.poll(() => readCalendarStoredRows(freshPage, state.identity)).toEqual(state.expectedRows);
    await expect(calendarDraftEditor(freshPage)).toHaveCount(0);
    await expect(calendarDraftCards(freshPage)).toHaveCount(0);
    await expect(CalendarSelectors.event(freshPage)).toHaveCount(3);
    await expect(CalendarSelectors.event(freshPage).filter({ hasText: 'Cloud timed card' })).toBeVisible();
    await expect(CalendarSelectors.event(freshPage).filter({ hasText: 'Cloud all-day card' })).toBeVisible();
    await expect(CalendarSelectors.event(freshPage).filter({ hasText: 'Untitled' })).toBeVisible();
  } finally {
    await context.close();
  }
});

When('I clear the calendar placeholder date', async ({ page }) => {
  const state = scenario(page);
  const id = await calendarDraftCards(page).getAttribute('data-event-id');

  await calendarDraftEditor(page).getByTestId(`datetime-cell-${id}-${state.identity.dateFieldId}`).click();
  await page.getByTestId('clear-date-button').click();
  await expect(page.getByTestId('datetime-picker-popover')).toHaveCount(0);
});

Then('the calendar stores exactly one new unscheduled card', async ({ page }) => {
  const state = scenario(page);
  const previousIds = new Set(state.expectedRows.map((row) => row.id));

  await expect.poll(async () => (await readCalendarStoredRows(page, state.identity)).length).toBe(previousIds.size + 1);
  const rows = await readCalendarStoredRows(page, state.identity);
  const inserted = rows.filter((row) => !previousIds.has(row.id));

  expect(inserted).toHaveLength(1);
  expect(inserted[0]).toMatchObject({ title: '', start: '', end: '', isRange: false });
  state.expectedRows = rows;
});
