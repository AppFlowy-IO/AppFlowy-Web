import { expect, type BrowserContext, type ElementHandle, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { calendarStorageIdentity, type CalendarStorageIdentity } from '../../support/calendar-placeholder-helpers';
import { loginAndCreateCalendar, switchCalendarView } from '../../support/calendar-test-helpers';
import { CalendarSelectors } from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();

interface SharedLayoutScenario {
  email: string;
  url: string;
  identity: CalendarStorageIdentity;
  peerContext: BrowserContext;
  peer: Page;
  calendars: ElementHandle<Element>[];
}

const scenarios = new WeakMap<Page, SharedLayoutScenario>();

function scenario(page: Page): SharedLayoutScenario {
  const state = scenarios.get(page);

  if (!state) throw new Error('Open both cloud calendar sessions first');
  return state;
}

async function storedSettings(page: Page) {
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const settings = database.get('views').get(ctx.activeViewId).get('layout_settings').get('2');

    return Object.fromEntries(
      [...settings.entries()].map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])
    );
  });
}

async function expectLayout(page: Page, label: string) {
  const layout = {
    Month: { mode: 0, count: null, view: 'dayGridMonth' },
    Week: { mode: 1, count: 7, view: 'timeGridWeek' },
    Day: { mode: 2, count: 1, view: 'timeGridDay' },
    '3 days': { mode: 1, count: 3, view: 'timeGrid3Days' },
    '8 days': { mode: 1, count: 8, view: 'timeGrid8Days' },
  }[label];

  if (!layout) throw new Error(`Unsupported expected calendar layout: ${label}`);
  await expect(CalendarSelectors.viewSelect(page).filter({ visible: true }).last()).toHaveText(label);
  await expect(page.locator(`.fc-${layout.view}-view`)).toBeVisible();
  if (layout.count !== null) {
    await expect(page.locator('.fc-view .fc-timegrid-col[data-date]')).toHaveCount(layout.count);
  }
  await expect
    .poll(async () => {
      const settings = await storedSettings(page);

      return { mode: settings.layout_ty, count: settings.day_count ?? null };
    })
    .toEqual({ mode: layout.mode, count: layout.count });
}

Given('two cloud browser sessions open the same shared calendar', async ({ page, request, browser, $testInfo }) => {
  $testInfo.setTimeout(240_000);
  const email = generateRandomEmail();

  await loginAndCreateCalendar(page, request, email);
  const identity = await calendarStorageIdentity(page);
  const url = page.url();
  const peerContext = await browser.newContext({ baseURL: new URL(url).origin, viewport: { width: 1440, height: 900 } });
  const peer = await peerContext.newPage();
  const state: SharedLayoutScenario = { email, url, identity, peerContext, peer, calendars: [] };

  scenarios.set(page, state);
  await signInAndWaitForApp(peer, request, email);
  await peer.goto(url);
  await expect(CalendarSelectors.calendarContainer(peer).first()).toBeVisible({ timeout: 30_000 });
  expect(await calendarStorageIdentity(peer)).toEqual(identity);
  for (const client of [page, peer]) {
    const calendar = await client.locator('.database-calendar:not(.sticky-header-wrapper) .fc').first().elementHandle();

    if (!calendar) throw new Error('The FullCalendar root is unavailable');
    state.calendars.push(calendar);
  }
});

After({ tags: '@calendar_shared_layout' }, async ({ page }) => {
  await scenarios.get(page)?.peerContext.close();
  scenarios.delete(page);
});

When('the first calendar session chooses Week', async ({ page }) => {
  await switchCalendarView(page, 'Week');
});

When('the first calendar session chooses Month', async ({ page }) => {
  await switchCalendarView(page, 'Month');
});

When('the second calendar session chooses eight days', async ({ page }) => {
  await switchCalendarView(scenario(page).peer, 8);
});

// Write the shared schema directly to exercise externally authored settings.
// Native Yrs binary interoperability is covered by the Rust/Jest fixtures.
async function applySharedSettings(page: Page, mode: number, count: number) {
  await page.evaluate(
    ({ mode, count }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const database = ctx.databaseDoc.getMap('data').get('database');
      const settings = database.get('views').get(ctx.activeViewId).get('layout_settings').get('2');

      ctx.databaseDoc.transact(() => {
        settings.set('layout_ty', mode);
        settings.set('day_count', count);
        settings.set('first_day_of_week_v2', 1);
      });
    },
    { mode, count }
  );
}

When('the second session applies shared Day settings directly', async ({ page }) => {
  await applySharedSettings(scenario(page).peer, 2, 1);
});

When('the second session applies shared three-day settings directly', async ({ page }) => {
  await applySharedSettings(scenario(page).peer, 1, 3);
});

Then('both calendar sessions show {string} from the shared settings', async ({ page }, label: string) => {
  const state = scenario(page);

  for (const client of [page, state.peer]) await expectLayout(client, label);
  for (const calendar of state.calendars) {
    expect(await calendar.evaluate((element) => element.isConnected), 'Mode changes must retain the calendar root').toBe(
      true
    );
  }
});

Then('the calendar keeps its date field and Monday week start', async ({ page }) => {
  const state = scenario(page);

  for (const client of [page, state.peer]) {
    expect(await storedSettings(client)).toMatchObject({
      field_id: state.identity.dateFieldId,
      first_day_of_week_v2: 1,
    });
    await expect(
      client
        .locator('.sticky-header-wrapper .fc-col-header-cell:not(.fc-timegrid-axis-cell)')
        .filter({ visible: true })
        .first()
    ).toContainText('Mon');
  }
});

Then('a fresh cloud session restores the shared eight-day layout', async ({ page, browser, request }) => {
  const state = scenario(page);
  const token = await page.evaluate(() => localStorage.getItem('af_auth_token'));

  if (!token) throw new Error('The shared calendar requires a cloud account');
  // Wait for the durable server snapshot, so a reload cannot pass by merely
  // replaying either browser's local IndexedDB state.
  await expect(async () => {
    const { workspaceId, databaseId, viewId, dateFieldId } = state.identity;
    const response = await request.get(
      `${TestConfig.apiUrl}/api/workspace/v1/${workspaceId}/collab/${databaseId}/json`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { collab_type: '1' },
      }
    );

    expect(response.ok()).toBe(true);
    const snapshot = await response.json();

    expect(snapshot.code).toBe(0);
    expect(snapshot.data.collab.database.views[viewId].layout_settings['2']).toMatchObject({
      layout_ty: 1,
      day_count: 8,
      first_day_of_week_v2: 1,
      field_id: dateFieldId,
    });
  }).toPass({ timeout: 45_000, intervals: [300, 500, 1000] });

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
    await expectLayout(freshPage, '8 days');
  } finally {
    await context.close();
  }
});
