import { expect, Page, test } from '@playwright/test';

import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { getVisibleDataRowIds, openRowDetailByRowId } from '../../support/row-detail-helpers';
import { RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

/**
 * A row opened as a full page must not reload when the app re-checks its
 * permissions. Returning to the browser tab and a permission notification
 * both re-probe the page; either used to remount the row document (editor
 * replaced by a skeleton), which collapsed the page and scrolled it to the top.
 */

type RowPageState = {
  scrollTop: number;
  sameEditor: boolean;
  events: string[];
};

type ProbeWindow = Window & {
  __rowPageProbe?: { editor: Element; scroller: HTMLElement; events: string[] };
};

type AppEventEmitter = { emit: (event: string, payload?: unknown) => void };

type EmitterWindow = Window & {
  __TEST_DATABASE_CONTEXT__?: { eventEmitter?: AppEventEmitter };
  __appEventEmitter?: AppEventEmitter;
};

async function openLongRowPage(page: Page) {
  await page.addInitScript(() => {
    (window as Window & { Cypress?: boolean }).Cypress = true;
  });
  await signUpAndLoginWithPasswordViaUi(page, page.request, generateRandomEmail());
  await createDatabaseView(page, 'Grid', 6000);
  await waitForGridReady(page);

  // A row page does not expose its database context, so keep the app event
  // emitter from the grid's context to replay server notifications later.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as EmitterWindow;

        w.__appEventEmitter = w.__TEST_DATABASE_CONTEXT__?.eventEmitter;
        return Boolean(w.__appEventEmitter);
      })
    )
    .toBe(true);

  const [rowId] = await getVisibleDataRowIds(page);

  await openRowDetailByRowId(page, rowId);
  await RowDetailSelectors.openFullPageButton(page).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('r') === rowId);

  const editor = page.locator('.row-page-content [data-testid="editor-content"]');

  await expect(editor).toBeVisible();
  await editor.click();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.insertText(`Line ${i} of a long row document`);
    await page.keyboard.press('Enter');
  }

  await expect(editor).toContainText('Line 59');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // Scroll to the end of the row document and remember the mounted editor.
  await page.evaluate(() => {
    const editor = document.querySelector('.row-page-content [data-testid="editor-content"]')!;
    let scroller = editor.parentElement;

    while (scroller) {
      const { overflowY } = getComputedStyle(scroller);

      if (scroller.scrollHeight > scroller.clientHeight + 10 && (overflowY === 'auto' || overflowY === 'scroll')) break;
      scroller = scroller.parentElement;
    }

    if (!scroller) throw new Error('row page has no scroll container');
    const events: string[] = [];
    const t0 = performance.now();
    const log = (s: string) => events.push(`${Math.round(performance.now() - t0)}ms ${s}`);
    const container = scroller;
    let last = container.scrollTop;

    container.addEventListener('scroll', () => {
      if (Math.abs(container.scrollTop - last) > 50) log(`scroll ${Math.round(last)} -> ${Math.round(container.scrollTop)}`);
      last = container.scrollTop;
    });
    const rowPage = document.querySelector('.row-page-content')!;

    new MutationObserver((records) => {
      if (!editor.isConnected && !events.some((e) => e.endsWith('editor removed'))) log('editor removed');
      // Diagnostics only: name row-page sections that leave the page.
      records.forEach((record) => {
        if (!rowPage.contains(record.target)) return;
        record.removedNodes.forEach((node) => {
          if (node instanceof HTMLElement && !node.contains(editor) && node.dataset.testid) {
            log(`removed ${node.dataset.testid}`);
          }
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
    container.scrollTop = container.scrollHeight;
    (window as ProbeWindow).__rowPageProbe = { editor, scroller: container, events };
  });
  await page.waitForTimeout(300);

  const before = await readRowPage(page);

  expect(before.scrollTop).toBeGreaterThan(500);
  return before;
}

async function readRowPage(page: Page): Promise<RowPageState> {
  return page.evaluate(() => {
    const probe = (window as ProbeWindow).__rowPageProbe!;
    const editor = document.querySelector('.row-page-content [data-testid="editor-content"]');

    return {
      scrollTop: Math.round(probe.scroller.scrollTop),
      sameEditor: editor === probe.editor,
      events: [...probe.events],
    };
  });
}

async function expectRowPageKept(page: Page, before: RowPageState, { allowLayoutShift = false } = {}) {
  // Permission probes resolve asynchronously; give a reload time to happen.
  await page.waitForTimeout(3000);
  const after = await readRowPage(page);

  console.log('row page events', JSON.stringify(after.events.slice(before.events.length)));
  if (allowLayoutShift) {
    expect(after.events, 'row document should not reload').not.toContainEqual(expect.stringMatching(/editor removed$/));
  } else {
    expect(after.events, 'row page should not reload or move').toEqual(before.events);
  }

  expect(after.sameEditor).toBe(true);
  expect(after.scrollTop).toBeGreaterThan(before.scrollTop - 50);
  await expect(page.locator('.row-page-content [data-testid="editor-content"]')).toHaveAttribute(
    'contenteditable',
    'true'
  );
}

test.describe('Row page keeps its place while permissions are re-checked', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('returning to the browser tab does not reload or scroll the row page', async ({ page }) => {
    const before = await openLongRowPage(page);

    // Headless Chromium does not change visibility when another page is
    // brought to the front, so replay the events a real tab switch fires.
    await page.evaluate(async () => {
      const setVisibility = (state: 'hidden' | 'visible') => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
      };

      setVisibility('hidden');
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    await expectRowPageKept(page, before);
  });

  test('a permission notification does not reload or scroll the row page', async ({ page }) => {
    const before = await openLongRowPage(page);

    // Space permission edits anywhere in the workspace reach every member as
    // this event. It drops the page's capabilities until the re-probe answers.
    await page.evaluate(() => (window as EmitterWindow).__appEventEmitter!.emit('permission-changed', {}));

    // Write-only controls hide until the re-probe answers, so the page may
    // shift briefly; the document itself must stay mounted and in place.
    await expectRowPageKept(page, before, { allowLayoutShift: true });
  });
});
