import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { BlobRequestKind, classifyBlobRequest } from '../../support/dashboard-loading-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import { SortSelectors } from '../../support/selectors';
import { addSortByFieldName } from '../../support/sort-test-helpers';
import { setupPageErrorHandling } from '../../support/test-config';

// Reused steps defined elsewhere:
// - 'I am signed in with a new account' (favorite-page.steps.ts)
// - 'I have created a grid page named {string}' (row-page-lifecycle.steps.ts)
// - 'I set the first grid cell to {string}' (row-page-lifecycle.steps.ts)
// - 'I open the grid row named {string} as a full row page' (row-page-lifecycle.steps.ts)
// - 'the current page is a full row page' (row-page-lifecycle.steps.ts)

const { When, Then, Before } = createBdd();

const RECORDING = process.env.PLAYWRIGHT_VIDEO === 'on';
const BLOB_DIFF_PATH = /\/api\/workspace\/[^/]+\/database\/[^/]+\/blob\/diff$/;
/** A walk is over once no blob/diff request has started or finished for this long. */
const ROW_SYNC_QUIET_MS = 1500;
const ROW_SYNC_SETTLE_TIMEOUT_MS = 30000;

interface RowSyncState {
  gridUrl?: string;
  /** blob/diff requests in flight, whatever the step. */
  pending: number;
  lastActivity: number;
  /** blob/diff requests recorded since the last reload a step started. */
  recorded: BlobRequestKind[];
}

const stateByPage = new WeakMap<Page, RowSyncState>();

function getState(page: Page): RowSyncState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('The row sync recorder is not attached; tag the scenario @row-page-row-sync');
  return state;
}

/**
 * Recorded runs (PLAYWRIGHT_VIDEO=on) show what each step checks, because the
 * blob/diff requests it counts never appear on screen.
 */
async function caption(page: Page, text: string): Promise<void> {
  if (!RECORDING) return;
  await page.evaluate((value) => {
    let el = document.getElementById('bdd-caption');

    if (!el) {
      el = document.createElement('div');
      el.id = 'bdd-caption';
      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        maxWidth: '80%',
        padding: '10px 16px',
        borderRadius: '8px',
        background: 'rgba(17, 24, 39, 0.9)',
        color: '#fff',
        font: '600 15px/1.45 system-ui, sans-serif',
        whiteSpace: 'pre-line',
        textAlign: 'center',
        pointerEvents: 'none',
      });
      document.body.appendChild(el);
    }

    el.textContent = value;
  }, text);
  await page.waitForTimeout(2000);
}

function describeRequests(kinds: BlobRequestKind[]): string {
  const counts = kinds.reduce<Record<string, number>>((acc, kind) => ({ ...acc, [kind]: (acc[kind] ?? 0) + 1 }), {});

  return Object.entries(counts)
    .map(([kind, count]) => `${kind} ×${count}`)
    .join(', ');
}

/** Waits until every blob/diff walk the app started has finished. */
async function waitForRowSyncToSettle(page: Page): Promise<void> {
  const state = getState(page);

  await expect
    .poll(() => state.pending === 0 && Date.now() - state.lastActivity >= ROW_SYNC_QUIET_MS, {
      timeout: ROW_SYNC_SETTLE_TIMEOUT_MS,
      intervals: [250],
      message: 'blob/diff requests kept running',
    })
    .toBe(true);
}

/** Reloads the page and records the blob/diff requests the reloaded page sends. */
async function reloadAndRecordRowSync(page: Page, url?: string): Promise<void> {
  const state = getState(page);

  // Requests of the previous page must not count toward the reloaded one.
  await waitForRowSyncToSettle(page);
  state.recorded = [];
  if (url) await page.goto(url);
  else await page.reload();
}

Before({ tags: '@row-page-row-sync' }, async ({ page }) => {
  const state: RowSyncState = { pending: 0, lastActivity: Date.now(), recorded: [] };

  stateByPage.set(page, state);
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const isBlobDiff = (url: string) => BLOB_DIFF_PATH.test(new URL(url).pathname);
  const settle = (url: string) => {
    if (!isBlobDiff(url)) return;
    state.pending = Math.max(0, state.pending - 1);
    state.lastActivity = Date.now();
  };

  page.on('request', (request) => {
    if (request.method() !== 'POST' || !isBlobDiff(request.url())) return;
    state.pending += 1;
    state.lastActivity = Date.now();
    state.recorded.push(classifyBlobRequest(request.postDataBuffer()));
  });
  page.on('requestfinished', (request) => settle(request.url()));
  page.on('requestfailed', (request) => settle(request.url()));
});

When('I sort the grid by its {string} field', async ({ page }, field: string) => {
  const url = new URL(page.url());

  getState(page).gridUrl = `${url.origin}${url.pathname}`;
  await addSortByFieldName(page, field);
  await expect(SortSelectors.sortCondition(page).first()).toBeVisible({ timeout: 10000 });
  // The sort makes the grid read every row; let that walk finish before the row opens.
  await waitForRowSyncToSettle(page);
  await caption(page, `The grid is sorted by "${field}", so the grid itself reads every row`);
});

When('I reload the row page', async ({ page }) => {
  await caption(page, 'Reload the full row page');
  await reloadAndRecordRowSync(page);
  await expect(page.locator('[data-testid="editor-content"]').first()).toBeVisible({ timeout: 15000 });
  await waitForRowSyncToSettle(page);
});

When('I reopen the sorted grid', async ({ page }) => {
  const { gridUrl } = getState(page);

  if (!gridUrl) throw new Error('The grid URL was not captured; sort the grid first');
  await reloadAndRecordRowSync(page, gridUrl);
  await waitForGridReady(page);
  await waitForRowSyncToSettle(page);
});

Then('reopening the row page asked only for rows changed since its last sync', async ({ page }) => {
  const { recorded } = getState(page);

  // `full` walks every row of the database from the start; `delta` names the
  // newest row this device holds and receives only what changed after it.
  await caption(
    page,
    `Row page blob/diff requests: ${describeRequests(recorded) || 'none'}\n` +
      'Expected: delta only (rows changed since the last sync), no full download'
  );
  expect(recorded.length, 'the row page sent no blob/diff request').toBeGreaterThan(0);
  expect(recorded, 'the row page downloaded every row of its database').toEqual(recorded.map(() => 'delta'));
});

Then('the sorted grid asked for every row of its database', async ({ page }) => {
  const { recorded } = getState(page);

  await caption(
    page,
    `Sorted grid blob/diff requests: ${describeRequests(recorded) || 'none'}\nThe sort still reads every row`
  );
  expect(recorded).toContain('full');
});
