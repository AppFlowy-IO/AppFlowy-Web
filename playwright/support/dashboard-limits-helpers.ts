/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs values read inside page.evaluate are untyped. */
/**
 * Helpers of the shared `dashboard-limits` feature: the announcements a
 * refusal makes, layouts another client saved over the limit, rendered versus
 * saved widget counts, row heights at their bounds, and a collaborator that
 * edits the same dashboard. Desktop runs the same Gherkin
 * (`dashboard_limits.feature`) with its own test ops.
 *
 * "Saved" is the stored layout value as every client reads it (the browser's
 * host database doc, and the server's copy once it synced), hidden widgets
 * beyond the limit included. "Shown" is what the dashboard renders.
 */
import { APIRequestContext, BrowserContext, expect, Page } from '@playwright/test';

import { rowsOfCounts, seedDashboardRows } from './dashboard-arrange-helpers';
import { useMobileViewport as showOnPhone } from './dashboard-mobile-helpers';
import { ensureFixtureDatabase } from './dashboard-platform-helpers';
import { WIDGET_TIMEOUT, WIDGET_TIMEOUT_MS } from './dashboard-shared-helpers';
import {
  addDashboardView,
  allWidgets,
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_LAYOUT_KEY,
  DASHBOARD_MAX_WIDGETS,
  DashboardSelectors,
  dashboardViewId,
  dashboardWorld,
  enterEditMode,
  expectRowHeight,
  hostDatabase,
  leaveEditMode,
  PersistedRow,
  prepareDashboardFixture,
  readDashboardSetting,
  readDatabaseViews,
  readServerDashboardSetting,
  renderedRows,
  viewIdForLabel,
  writeDashboardSetting,
} from './dashboard-test-helpers';

/** Where the recorder keeps what Atlaskit's live region (a `role="status"` node on `<body>`) announced. */
const ANNOUNCEMENTS_KEY = '__DASHBOARD_ANNOUNCEMENTS__';
/** The texts only a limit refusal announces or a banner would show. */
const LIMIT_TEXT = /Dashboard is full|Delete a view to add a new one|A row holds up to/;
/** Time a refused press or drop gets to render or announce anything before an absence check. */
const SETTLE_MS = 1_200;

/** Two animation frames and then `ms`: a write, a render and Atlaskit's announce delay land meanwhile. */
export async function settle(page: Page, ms = SETTLE_MS) {
  await page.evaluate(
    (wait) =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, wait)))
      ),
    ms
  );
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

/**
 * Record every message the dashboard announces: Atlaskit's live region is a
 * visually hidden `role="status"` child of `<body>` whose text is replaced
 * per announcement. Installed on the browser context before the app loads.
 */
export async function installAnnouncementRecorder(context: BrowserContext) {
  await context.addInitScript((key: string) => {
    const win = window as unknown as Record<string, unknown>;

    if (win[key]) return;
    const log: string[] = [];

    win[key] = log;
    const isRegion = (node: Node | null): node is HTMLElement =>
      node instanceof HTMLElement && node.getAttribute('role') === 'status' && node.parentElement === document.body;
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const target = mutation.target.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target;

        if (!isRegion(target)) return;
        if (mutation.type === 'childList' && mutation.addedNodes.length === 0) return;
        const text = target.textContent?.trim();

        if (text) log.push(text);
      });
    });
    const start = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }, ANNOUNCEMENTS_KEY);
}

async function readAnnouncements(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const log = (window as unknown as Record<string, string[] | undefined>)[key];

    if (!log) throw new Error('The announcement recorder is not installed on this page');
    return [...log];
  }, ANNOUNCEMENTS_KEY);
}

/** Drop the first `count` recorded announcements (they have been checked). */
async function consumeAnnouncements(page: Page, count: number) {
  await page.evaluate(
    ({ key, n }) => {
      (window as unknown as Record<string, string[]>)[key].splice(0, n);
    },
    { key: ANNOUNCEMENTS_KEY, n: count }
  );
}

/**
 * `text` was announced since the last check, and it is the only limit
 * refusal announced meanwhile. The checked announcements are consumed, so
 * the next refusal must be announced afresh.
 */
export async function expectRefusalAnnounced(page: Page, text: string) {
  await expect
    .poll(async () => (await readAnnouncements(page)).includes(text), {
      ...WIDGET_TIMEOUT,
      message: `waiting for the announcement "${text}"`,
    })
    .toBe(true);
  const log = await readAnnouncements(page);
  const index = log.indexOf(text);
  const refusals = log.slice(0, index + 1).filter((message) => LIMIT_TEXT.test(message));

  expect(
    refusals.filter((message) => message !== text),
    'another limit refusal was announced since the last check'
  ).toEqual([]);
  await consumeAnnouncements(page, index + 1);
}

/** No limit refusal has been announced since the last check (after a settle). */
export async function expectNoRefusalAnnounced(page: Page) {
  await settle(page);
  const log = await readAnnouncements(page);

  expect(log.filter((message) => LIMIT_TEXT.test(message))).toEqual([]);
  await consumeAnnouncements(page, log.length);
}

/**
 * `text` is what the live region says now. For pages without the recorder
 * (it is installed for `@dashboard-limits` only): Atlaskit writes a message a
 * second after it is announced and keeps it until the next one.
 */
export async function expectAnnounced(page: Page, text: string) {
  await expect(page.locator('body > [role="status"]').filter({ hasText: text })).toHaveCount(1, WIDGET_TIMEOUT);
}

// ---------------------------------------------------------------------------
// Banners and created views
// ---------------------------------------------------------------------------

/**
 * A refusal shows nothing but the full tooltip: after a settle, no picker or
 * pending widget is open and no visible element outside a tooltip and the
 * live region holds a limit text (a banner of any shape would).
 */
export async function expectNoLimitBanner(page: Page) {
  await settle(page);
  await expect(DashboardSelectors.picker(page)).toHaveCount(0);
  await expect(DashboardSelectors.pendingWidget(page)).toHaveCount(0);
  const shown = await page.evaluate((source) => {
    const pattern = new RegExp(source);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found: string[] = [];

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      const element = node.parentElement;

      if (!element || !pattern.test(text)) continue;
      // The live region, and the tooltip of a refused control, may say it.
      if (element.closest('[role="tooltip"], [data-radix-popper-content-wrapper]')) continue;
      if (element.closest('body > [role="status"]')) continue;
      const style = window.getComputedStyle(element);

      if (element.getClientRects().length === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      found.push(text.trim());
    }

    return found;
  }, LIMIT_TEXT.source);

  expect(shown, 'a limit text is shown outside the tooltip and the live region').toEqual([]);
}

/**
 * The refused adds created nothing: after a settle the dashboard owns no view
 * of its database, and every view of it is a fixture view, the dashboard
 * itself or a view a widget shows.
 */
export async function expectNoViewCreatedByDashboard(page: Page) {
  await settle(page);
  const host = hostDatabase(page);
  const dashboardId = dashboardViewId(page);
  const known = new Set([...Object.values(host.views), dashboardId]);
  const shown = new Set(allWidgets(await readDashboardSetting(page)).map((widget) => widget.view_id));
  const views = await readDatabaseViews(page, host.databaseId);
  const owned = await page.evaluate(
    ({ databaseId, owner }) => {
      const views = (window as any).__DASHBOARD_TEST__
        ?.byDatabase(databaseId)
        ?.databaseDoc.getMap('data')
        .get('database')
        ?.get('views');
      const result: string[] = [];

      views?.forEach((view: any, viewId: string) => {
        if (view.get('dashboard_owner') === owner) result.push(viewId);
      });
      return result;
    },
    { databaseId: host.databaseId, owner: dashboardId }
  );

  expect(owned, 'views the dashboard created').toEqual([]);
  expect(views.filter((view) => !view.inline && !known.has(view.id) && !shown.has(view.id)).map((view) => view.name)).toEqual(
    []
  );
}

// ---------------------------------------------------------------------------
// Layouts written by another client
// ---------------------------------------------------------------------------

/** `count` widths summing to 12, as another client might store a row of any size. */
export function storedRowWidths(count: number): number[] {
  const base = Math.max(1, Math.floor(DASHBOARD_GRID_COLUMNS / count));
  let rest = Math.max(0, DASHBOARD_GRID_COLUMNS - base * count);

  return Array.from({ length: count }, () => {
    const extra = rest > 0 ? 1 : 0;

    rest -= extra;
    return base + extra;
  });
}

/** `'4, 4, 4, 2'` → the widget count of each row; any count, as another client may have saved it. */
export function storedRowCounts(text: string): number[] {
  return text.split(',').map((part) => {
    const count = Number(part.trim());

    if (!Number.isInteger(count) || count < 1) throw new Error(`Bad widget count "${part}" in "${text}"`);
    return count;
  });
}

/**
 * Save rows of these widget counts as another client would, without the
 * limits this client applies: ids `r:1…` and `w:1…` in reading order, every
 * widget on the host Grid view.
 */
export async function saveRawDashboardRows(page: Page, counts: number[]) {
  const world = dashboardWorld(page);
  const host = hostDatabase(page);
  const viewId = viewIdForLabel(page, `${host.name} Grid`);
  let next = 0;
  const rows: PersistedRow[] = counts.map((count, rowIndex) => ({
    id: `r:${rowIndex + 1}`,
    height: DASHBOARD_DEFAULT_ROW_HEIGHT,
    widgets: storedRowWidths(count).map((width) => {
      next += 1;
      const id = `w:${next}`;

      world.widgets[id] = { id, viewId, databaseId: host.databaseId };
      return { id, view_id: viewId, database_id: host.databaseId, width };
    }),
  }));

  await writeDashboardSetting(page, { rows });
  return next;
}

/**
 * A Projects dashboard whose saved layout another client wrote with these row
 * counts, open in Edit mode once every widget it shows has rendered.
 */
export async function openDashboardSavedWithRows(page: Page, request: APIRequestContext, counts: number[]) {
  await prepareDashboardFixture(page, request, ['Projects']);
  await addDashboardView(page, 'Projects');
  const total = await saveRawDashboardRows(page, counts);

  await expect(DashboardSelectors.widgets(page)).toHaveCount(Math.min(total, DASHBOARD_MAX_WIDGETS), WIDGET_TIMEOUT);
  await enterEditMode(page);
}

/** Save `height` for the shown row `oneBasedIndex` as another client would (no snap, no clamp). */
export async function saveRowHeightAsAnotherClient(page: Page, oneBasedIndex: number, height: number) {
  const { rows } = await readDashboardSetting(page);

  if (!rows[oneBasedIndex - 1]) throw new Error(`The dashboard has no row ${oneBasedIndex}`);
  await writeDashboardSetting(page, {
    rows: rows.map((row, index) => (index === oneBasedIndex - 1 ? { ...row, height } : row)),
  });
  await expectRowHeight(page, oneBasedIndex, height, { renderedTolerance: 2 });
}

// ---------------------------------------------------------------------------
// Shown and saved
// ---------------------------------------------------------------------------

export async function shownRowCounts(page: Page): Promise<number[]> {
  return (await renderedRows(page)).map((row) => row.length);
}

/** The id of the shown row `oneBasedIndex` (a split row has an id the stored layout does not). */
export async function shownRowId(page: Page, oneBasedIndex: number): Promise<string> {
  const row = DashboardSelectors.rows(page).nth(oneBasedIndex - 1);

  await expect(row).toBeVisible(WIDGET_TIMEOUT);
  const id = await row.getAttribute('data-row-id');

  if (!id) throw new Error(`The dashboard shows no row ${oneBasedIndex}`);
  return id;
}

async function savedWidgetCount(page: Page) {
  return allWidgets(await readDashboardSetting(page)).length;
}

async function serverWidgetCount(page: Page, request: APIRequestContext) {
  const setting = await readServerDashboardSetting(page, request).catch(() => null);

  return setting ? allWidgets(setting).length : null;
}

/** The saved layout holds exactly `count` widgets, in the browser and, once synced, on the server. */
export async function expectSavedWidgetCount(page: Page, request: APIRequestContext, count: number) {
  await expect.poll(() => savedWidgetCount(page), WIDGET_TIMEOUT).toBe(count);
  await expect
    .poll(() => serverWidgetCount(page, request), {
      timeout: WIDGET_TIMEOUT_MS * 2,
      message: 'waiting for the server copy of the dashboard layout',
    })
    .toBe(count);
}

async function savedWidgetIds(page: Page) {
  return allWidgets(await readDashboardSetting(page)).map((widget) => widget.id);
}

/**
 * The saved layout holds at most `count` widgets, in the browser and on the
 * server. The server copy is read once it holds the browser's widgets, so a
 * copy from before the last write cannot pass for it.
 */
export async function expectSavedWidgetCountAtMost(page: Page, request: APIRequestContext, count: number) {
  await settle(page);
  const local = await savedWidgetIds(page);

  expect(local.length).toBeLessThanOrEqual(count);
  await expect
    .poll(
      async () => {
        const setting = await readServerDashboardSetting(page, request).catch(() => null);

        return setting ? allWidgets(setting).map((widget) => widget.id) : null;
      },
      { timeout: WIDGET_TIMEOUT_MS * 2, message: 'waiting for the server copy of the dashboard layout' }
    )
    .toEqual(local);
  expect(await savedWidgetIds(page), 'the browser layout changed while the server caught up').toEqual(local);
}

/** The saved rows hold these widget counts, in the browser and, once synced, on the server. */
export async function expectSavedRowCounts(page: Page, request: APIRequestContext, counts: number[]) {
  await expect
    .poll(async () => (await readDashboardSetting(page)).rows.map((row) => row.widgets.length), WIDGET_TIMEOUT)
    .toEqual(counts);
  await expect
    .poll(
      async () => {
        const setting = await readServerDashboardSetting(page, request).catch(() => null);

        return setting?.rows.map((row) => row.widgets.length) ?? null;
      },
      { timeout: WIDGET_TIMEOUT_MS * 2, message: 'waiting for the server copy of the dashboard layout' }
    )
    .toEqual(counts);
}

// ---------------------------------------------------------------------------
// Row heights
// ---------------------------------------------------------------------------

/**
 * Drag the height handle of row `oneBasedIndex` by `pixels` in one press. The
 * page grows for the drag when the pointer would leave it (a pointer outside
 * the viewport gets no moves), then gets its size back.
 */
export async function dragHeightHandleBy(page: Page, oneBasedIndex: number, pixels: number) {
  const handle = DashboardSelectors.heightHandle(page, await shownRowId(page, oneBasedIndex));
  const viewport = page.viewportSize();

  await expect(handle).toBeVisible(WIDGET_TIMEOUT);
  await handle.scrollIntoViewIfNeeded();
  let box = await handle.boundingBox();

  if (!box || !viewport) throw new Error('The height handle is not visible');
  const needed = Math.ceil(box.y + box.height / 2 + pixels + 40);
  const grown = needed > viewport.height;

  if (pixels < 0 && box.y + box.height / 2 + pixels < 2) {
    throw new Error(`An upward drag of ${-pixels}px from y=${box.y} would leave the page`);
  }

  if (grown) {
    await page.setViewportSize({ width: viewport.width, height: needed });
    box = await handle.boundingBox();
    if (!box) throw new Error('The height handle is not visible');
  }

  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) await page.mouse.move(from.x, from.y + (pixels * step) / 20);
  await page.mouse.up();
  if (grown) await page.setViewportSize(viewport);
}

export async function focusHeightHandle(page: Page, oneBasedIndex: number) {
  const handle = DashboardSelectors.heightHandle(page, await shownRowId(page, oneBasedIndex));

  await handle.scrollIntoViewIfNeeded();
  await handle.focus();
  await expect(handle).toBeFocused();
}

// ---------------------------------------------------------------------------
// A collaborator on the same dashboard
// ---------------------------------------------------------------------------

/**
 * Open the dashboard in a second editor: a replica of the host database doc
 * with its own Yjs client, in the page. It edits its copy and exchanges
 * updates with the browser's doc as the sync server would.
 */
export async function openCollaboratorReplica(page: Page) {
  await page.evaluate((databaseId) => {
    const win = window as any;
    const Yjs = win.Y;
    const host = win.__DASHBOARD_TEST__.byDatabase(databaseId)?.databaseDoc;

    if (!Yjs || !host) throw new Error('The host database doc or Yjs is not exposed');
    const replica = new Yjs.Doc({ guid: host.guid });

    Yjs.applyUpdate(replica, Yjs.encodeStateAsUpdate(host));
    win.__DASHBOARD_COLLABORATOR__ = replica;
  }, hostDatabase(page).databaseId);
}

/** The collaborator appends one full-width widget on the host Grid view in a new row of its copy. */
export async function collaboratorAddsWidgetInNewRow(page: Page) {
  const host = hostDatabase(page);
  const widgetId = `w:collaborator-${Date.now().toString(36)}`;

  await page.evaluate(
    ({ viewId, layoutKey, widget, rowId }) => {
      const win = window as any;
      const replica = win.__DASHBOARD_COLLABORATOR__;

      if (!replica) throw new Error('No collaborator has the dashboard open');
      const view = replica.getMap('data').get('database').get('views').get(viewId);
      const setting = view.get('layout_settings').get(layoutKey);
      const rows = setting.get('rows');
      const plain = rows && typeof rows.toJSON === 'function' ? rows.toJSON() : rows ?? [];

      replica.transact(() => {
        setting.set('rows', [...plain, { id: rowId, height: 360, widgets: [widget] }]);
      });
    },
    {
      viewId: dashboardViewId(page),
      layoutKey: DASHBOARD_LAYOUT_KEY,
      rowId: `r:collaborator-${Date.now().toString(36)}`,
      widget: {
        id: widgetId,
        view_id: viewIdForLabel(page, `${host.name} Grid`),
        database_id: host.databaseId,
        width: DASHBOARD_GRID_COLUMNS,
      },
    }
  );
  return widgetId;
}

/**
 * The origin the collaborator's updates reach the browser's doc with. Not
 * `'remote'`: the sync outbox never sends a `'remote'` update, so the server
 * would never hold what the collaborator wrote, as it does when the
 * collaborator's own connection delivers it. The update is still not local
 * (`Y.applyUpdate`) and no undo stack tracks this origin.
 */
const COLLABORATOR_ORIGIN = 'dashboard-test-collaborator';

/**
 * The browser's doc and the collaborator's copy exchange what each lacks; what
 * the collaborator wrote also reaches the server, through the browser's outbox.
 */
export async function syncCollaboratorReplica(page: Page) {
  await page.evaluate(
    ({ databaseId, origin }) => {
      const win = window as any;
      const Yjs = win.Y;
      const host = win.__DASHBOARD_TEST__.byDatabase(databaseId)?.databaseDoc;
      const replica = win.__DASHBOARD_COLLABORATOR__;

      if (!host || !replica) throw new Error('No collaborator has the dashboard open');
      const toHost = Yjs.encodeStateAsUpdate(replica, Yjs.encodeStateVector(host));

      Yjs.applyUpdate(host, toHost, origin);
      Yjs.applyUpdate(replica, Yjs.encodeStateAsUpdate(host, Yjs.encodeStateVector(replica)), 'remote');
    },
    { databaseId: hostDatabase(page).databaseId, origin: COLLABORATOR_ORIGIN }
  );
}

/** The stored rows of the browser's doc and of the collaborator's copy. */
export async function readBothLayouts(page: Page): Promise<{ user: unknown; collaborator: unknown }> {
  return page.evaluate(
    ({ databaseId, viewId, layoutKey }) => {
      const win = window as any;
      const plainRows = (doc: any) => {
        const rows = doc.getMap('data').get('database').get('views').get(viewId).get('layout_settings').get(layoutKey).get('rows');

        return JSON.parse(
          JSON.stringify(rows && typeof rows.toJSON === 'function' ? rows.toJSON() : rows ?? null, (_key, value) =>
            typeof value === 'bigint' ? Number(value) : value
          )
        );
      };

      return {
        user: plainRows(win.__DASHBOARD_TEST__.byDatabase(databaseId).databaseDoc),
        collaborator: plainRows(win.__DASHBOARD_COLLABORATOR__),
      };
    },
    { databaseId: hostDatabase(page).databaseId, viewId: dashboardViewId(page), layoutKey: DASHBOARD_LAYOUT_KEY }
  );
}

// ---------------------------------------------------------------------------
// A phone
// ---------------------------------------------------------------------------

/**
 * A dashboard of `database` with rows of these widget counts (every widget on
 * its Grid view), set up at desktop width and left in View mode, then shown
 * on a phone.
 */
export async function openPhoneDashboardWithRows(
  page: Page,
  request: APIRequestContext,
  database: string,
  counts: number[]
) {
  await ensureFixtureDatabase(page, request, database);
  await addDashboardView(page, database);
  await seedDashboardRows(
    page,
    rowsOfCounts(counts.join(',')).map((widths) => ({ widths }))
  );
  await leaveEditMode(page);
  await showOnPhone(page);
}

/** Every widget sits on a line of its own and takes the whole width of its row. */
export async function expectWidgetsOnePerLineAtFullWidth(page: Page, count: number) {
  await expect(DashboardSelectors.widgets(page)).toHaveCount(count, WIDGET_TIMEOUT);
  await expect
    .poll(
      () =>
        DashboardSelectors.rows(page).evaluateAll((rows) => {
          const problems: string[] = [];
          let lastBottom = Number.NEGATIVE_INFINITY;

          rows.forEach((row) => {
            const track = row.querySelector('[data-testid="dashboard-row-track"]') ?? row;
            const trackWidth = track.getBoundingClientRect().width;

            row.querySelectorAll('[data-testid="dashboard-widget"]').forEach((widget) => {
              const rect = widget.getBoundingClientRect();
              const id = widget.getAttribute('data-widget-id');

              if (Math.abs(rect.width - trackWidth) > 1) problems.push(`${id} is ${rect.width}px of ${trackWidth}px`);
              if (rect.top < lastBottom - 1) problems.push(`${id} shares a line`);
              lastBottom = rect.bottom;
            });
          });
          return problems;
        }),
      WIDGET_TIMEOUT
    )
    .toEqual([]);
}
