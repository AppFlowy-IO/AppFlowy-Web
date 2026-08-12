import { BrowserContext, expect, Locator, Page, Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { AddPageSelectors } from '../../support/selectors';
import { setupPageErrorHandling } from '../../support/test-config';

// Reused steps defined elsewhere:
// - 'I am signed in with a new account' (favorite-page.steps.ts)
// - 'I have created a grid page named {string}' (row-page-lifecycle.steps.ts)
// - 'I set the first grid cell to {string}' (row-page-lifecycle.steps.ts)
// - 'I open the grid row named {string} as a full row page' (row-page-lifecycle.steps.ts)
// - 'I type {string} into the row document' (row-page-lifecycle.steps.ts)

const { Given, When, Then, Before, After } = createBdd();

const PAUSED_COMMENT_ROUTE = '**/api/workspace/**/inline-comment*';

interface PausedCommentLoad {
  handler: (route: Route) => Promise<void>;
  release: () => void;
}

interface RemoteVerificationPage {
  context: BrowserContext;
  page: Page;
}

const pausedCommentLoads = new WeakMap<Page, PausedCommentLoad>();
const remoteVerificationPages = new WeakMap<Page, RemoteVerificationPage>();

const activePage = (page: Page) => remoteVerificationPages.get(page)?.page ?? page;

const FILTER_TEST_IDS: Record<string, string> = {
  Open: 'inline-comment-filter-open',
  Resolved: 'inline-comment-filter-resolved',
  All: 'inline-comment-filter-all',
};

const EMPTY_STATE_TEXT: Record<string, string> = {
  Open: 'No open comments',
  Resolved: 'No resolved comments',
  All: 'No comments',
};

const documentEditor = (page: Page) => activePage(page).locator('[data-slate-editor="true"]').first();

const pageModal = (page: Page) => activePage(page).locator('[role="dialog"]').last();

const modalEditor = (page: Page) => pageModal(page).locator('[data-slate-editor="true"]').first();

/**
 * The page behind an open modal keeps its own selection toolbar mounted, so the
 * comment action has to be resolved against the surface that owns the selection.
 */
async function commentToolbarAction(page: Page): Promise<Locator> {
  const surface = activePage(page);
  const modalOpen = await pageModal(page)
    .isVisible()
    .catch(() => false);

  return modalOpen
    ? pageModal(page).getByTestId('inline-comment-toolbar-action')
    : surface.getByTestId('inline-comment-toolbar-action');
}

const sidebar = (page: Page) => activePage(page).getByTestId('inline-comment-sidebar');

const threadByContent = (page: Page, content: string) =>
  sidebar(page).getByTestId('inline-comment-thread').filter({ hasText: content }).first();

/**
 * The card actions only accept pointer events while the entry is hovered, the
 * same way the desktop card reveals them on hover. Hover the thread before
 * every action click.
 */
async function clickThreadAction(page: Page, content: string, testId: string): Promise<void> {
  const thread = threadByContent(page, content);

  await expect(thread).toBeVisible({ timeout: 15000 });
  await thread.scrollIntoViewIfNeeded();
  await thread.hover();

  const action = thread.getByTestId(testId);

  await expect(action).toBeVisible({ timeout: 10000 });
  await action.click();
}

async function openCommentsPanel(page: Page): Promise<void> {
  if (await sidebar(page).isVisible().catch(() => false)) return;

  const toggle = page.getByTestId('inline-comment-toggle');

  await expect(toggle).toBeVisible({ timeout: 30000 });
  await toggle.click();
  await expect(sidebar(page)).toBeVisible({ timeout: 15000 });
}

async function typeInEditor(page: Page, editor: Locator, text: string): Promise<void> {
  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.click({ force: true });
  await page.keyboard.type(text, { delay: 30 });
  await expect(editor).toContainText(text, { timeout: 10000 });
  // The comment anchor is written into the Yjs doc, so let the typed delta
  // settle before a selection is turned into a comment.
  await page.waitForTimeout(1000);
}

Before({ tags: '@inline-comment' }, async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

After({ tags: '@inline-comment' }, async ({ page }) => {
  const paused = pausedCommentLoads.get(page);

  paused?.release();
  pausedCommentLoads.delete(page);

  const verification = remoteVerificationPages.get(page);

  remoteVerificationPages.delete(page);
  await verification?.context.close();
});

Given('inline comment loading is paused', async ({ page }) => {
  let release = () => undefined;
  const resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === 'GET' && pathname.endsWith('/inline-comment')) {
      await resumed;
    }

    await route.continue();
  };

  pausedCommentLoads.set(page, { handler, release });
  await page.route(PAUSED_COMMENT_ROUTE, handler);
});

Given('I have created and opened a document for inline comments', async ({ page }) => {
  await createDocumentPageAndNavigate(page);
  await expect(documentEditor(page)).toBeVisible({ timeout: 15000 });
});

Given('I have created a document that stays open in the page modal', async ({ page }) => {
  await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  await page.waitForTimeout(1000);
  await AddPageSelectors.addDocumentButton(page).click({ force: true });
  await page.waitForTimeout(1000);

  // Unlike createDocumentPageAndNavigate, the modal is left as-is: this is the
  // surface a freshly created page lands on.
  await expect(pageModal(page)).toBeVisible({ timeout: 15000 });
  await expect(modalEditor(page)).toBeVisible({ timeout: 15000 });
});

When('I type {string} in the document', async ({ page }, text: string) => {
  await typeInEditor(page, documentEditor(page), text);
});

When('I type {string} in the page modal document', async ({ page }, text: string) => {
  await typeInEditor(page, modalEditor(page), text);
});

Then('the inline comment action is visible in the selection toolbar', async ({ page }) => {
  await expect(await commentToolbarAction(page)).toBeVisible({ timeout: 15000 });
});

Then('the commented text is highlighted in the page modal document', async ({ page }) => {
  await expect(modalEditor(page).locator('[data-inline-comment-ids]').first()).toBeVisible({ timeout: 15000 });
});

When('I select the first {int} characters in the document', async ({ page }, count: number) => {
  const readSelection = () => page.evaluate(() => window.getSelection()?.toString() ?? '');
  let selected = '';

  // A row page keeps syncing its document meta right after the first edit and
  // can swallow key presses while it re-renders, so verify and retry.
  for (let attempt = 0; attempt < 3 && selected.length !== count; attempt++) {
    if (attempt > 0) {
      await documentEditor(page).click({ force: true });
      await page.waitForTimeout(500);
    }

    await page.keyboard.press('Home');
    for (let index = 0; index < count; index++) {
      await page.keyboard.press('Shift+ArrowRight');
      await page.waitForTimeout(30);
    }

    await page.waitForTimeout(500);
    selected = await readSelection();
  }

  expect(selected).toHaveLength(count);
});

When('I lock the current page', async ({ page }) => {
  await page.getByTestId('page-more-actions').first().click();
  await page.getByTestId('more-page-lock').click();
  await expect(page.getByTestId('page-locked-badge')).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
});

Then('the document editor is read-only', async ({ page }) => {
  await expect(documentEditor(page)).toHaveAttribute('contenteditable', 'false', { timeout: 15000 });
});

When('I double-click the first word in the document', async ({ page }) => {
  const editor = documentEditor(page);

  await expect(editor).toBeVisible({ timeout: 15000 });
  // A read-only editor has no caret, so the selection has to come from a real
  // double click on the first word.
  await editor.locator('[data-slate-string="true"]').first().dblclick({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(500);

  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');

  expect(selected.trim().length).toBeGreaterThan(0);
});

Then('the read-only inline comment trigger is available', async ({ page }) => {
  await expect(page.getByTestId('inline-comment-readonly-trigger')).toBeVisible({ timeout: 15000 });
});

When('I open the inline comment composer from the read-only trigger', async ({ page }) => {
  await page.getByTestId('inline-comment-readonly-trigger').locator('button').first().click();
});

When('I open the inline comment composer', async ({ page }) => {
  const action = await commentToolbarAction(page);

  await expect(action).toBeVisible({ timeout: 10000 });
  await action.click();
});

Then('the inline comment composer is visible', async ({ page }) => {
  await expect(page.getByTestId('inline-comment-composer')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('inline-comment-input')).toBeVisible({ timeout: 10000 });
});

When('I enter {string} in the inline comment composer', async ({ page }, content: string) => {
  const input = page.getByTestId('inline-comment-input');

  await input.fill(content);
  await expect(input).toHaveValue(content);
});

When('I submit the inline comment composer', async ({ page }) => {
  await page.getByTestId('inline-comment-submit').click();
  // Create + list round-trip, then the anchor write into the document.
  await expect(page.getByTestId('inline-comment-composer')).toHaveCount(0, { timeout: 30000 });
});

Then('the inline comment sidebar is visible', async ({ page }) => {
  await expect(sidebar(page)).toBeVisible({ timeout: 30000 });
});

Then('the inline comment {string} is visible in the sidebar', async ({ page }, content: string) => {
  await expect(threadByContent(page, content)).toBeVisible({ timeout: 30000 });
});

Then('the inline comment {string} is not visible in the sidebar', async ({ page }, content: string) => {
  await expect(sidebar(page).getByTestId('inline-comment-thread').filter({ hasText: content })).toHaveCount(0, {
    timeout: 30000,
  });
});

Then('the inline comment {string} quotes {string}', async ({ page }, content: string, quote: string) => {
  await expect(threadByContent(page, content)).toContainText(quote, { timeout: 15000 });
});

Then('the commented text is highlighted in the document', async ({ page }) => {
  const anchored = documentEditor(page).locator('[data-inline-comment-ids]');

  await expect(anchored.first()).toBeVisible({ timeout: 15000 });
});

Then('the commented text is no longer highlighted in the document', async ({ page }) => {
  await expect(documentEditor(page).locator('[data-inline-comment-ids]')).toHaveCount(0, { timeout: 30000 });
});

When(
  'I reply to the inline comment {string} with {string}',
  async ({ page }, content: string, reply: string) => {
    await clickThreadAction(page, content, 'inline-comment-reply-button');

    const thread = threadByContent(page, content);
    const input = thread.getByTestId('inline-comment-reply-input');

    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(reply);
    await input.press('Enter');
    await expect(input).toHaveCount(0, { timeout: 30000 });
  }
);

Then('the inline comment reply {string} is visible', async ({ page }, reply: string) => {
  const replyEntry = sidebar(page).getByTestId('inline-comment-reply-entry').filter({ hasText: reply });

  // Desktop expands the thread as soon as a reply lands; fall back to the
  // show-replies toggle when the thread was collapsed again in between.
  if (!(await replyEntry.first().isVisible().catch(() => false))) {
    const toggle = sidebar(page).getByTestId('inline-comment-replies-toggle').first();

    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
    }
  }

  await expect(replyEntry.first()).toBeVisible({ timeout: 30000 });
});

When('I resolve the inline comment {string}', async ({ page }, content: string) => {
  await clickThreadAction(page, content, 'inline-comment-resolve-button');
  await page.waitForTimeout(1500);
});

When('I reopen the inline comment {string}', async ({ page }, content: string) => {
  await clickThreadAction(page, content, 'inline-comment-resolve-button');
  await page.waitForTimeout(1500);
});

When('I delete the inline comment {string}', async ({ page }, content: string) => {
  await clickThreadAction(page, content, 'inline-comment-action-menu-button');

  const deleteButton = threadByContent(page, content).getByTestId('inline-comment-delete-button');

  await expect(deleteButton).toBeVisible({ timeout: 10000 });
  await deleteButton.click();

  const confirmButton = page.getByTestId('inline-comment-delete-confirm-button');

  await expect(confirmButton).toBeVisible({ timeout: 10000 });
  await confirmButton.click();
  await page.waitForTimeout(1500);
});

When(
  'I add the {string} reaction to the inline comment {string}',
  async ({ page }, emoji: string, content: string) => {
    await clickThreadAction(page, content, 'inline-comment-add-reaction-button');

    const picker = page.locator('[data-slot="popover-content"]').filter({ visible: true }).first();

    await expect(picker).toBeVisible({ timeout: 15000 });

    const searchInput = picker.locator('input').first();

    await expect(searchInput).toBeVisible({ timeout: 15000 });

    const emojiButton = picker.locator('button').filter({ hasText: emoji }).first();

    // The picker mounts its virtualized grid asynchronously, so re-apply the
    // search until the target emoji is rendered. Clear between attempts:
    // re-filling the same value is a no-op that never re-triggers the search.
    const query = emoji === '👍' ? 'thumbs up' : emoji;

    for (let attempt = 0; attempt < 4; attempt++) {
      await searchInput.fill('');
      await page.waitForTimeout(200);
      await searchInput.fill(query);
      await page.waitForTimeout(1000);

      if (await emojiButton.isVisible().catch(() => false)) break;
    }

    await expect(emojiButton).toBeVisible({ timeout: 15000 });
    await emojiButton.click();
    await page.waitForTimeout(1500);
  }
);

Then(
  'the inline comment {string} shows the {string} reaction with count {int}',
  async ({ page }, content: string, emoji: string, count: number) => {
    const chip = threadByContent(page, content).getByTestId(`inline-comment-reaction-${emoji}`);

    await expect(chip).toBeVisible({ timeout: 30000 });
    await expect(chip).toContainText(String(count));
  }
);

When(
  'I remove the {string} reaction from the inline comment {string}',
  async ({ page }, emoji: string, content: string) => {
    const thread = threadByContent(page, content);

    await thread.hover();
    await thread.getByTestId(`inline-comment-reaction-${emoji}`).click();
    await page.waitForTimeout(1500);
  }
);

Then('the inline comment {string} shows no reactions', async ({ page }, content: string) => {
  await expect(threadByContent(page, content).locator('[data-testid^="inline-comment-reaction-"]')).toHaveCount(0, {
    timeout: 30000,
  });
});

When('I click the commented text in the document', async ({ page }) => {
  const anchored = documentEditor(page).locator('[data-inline-comment-ids]').first();

  await expect(anchored).toBeVisible({ timeout: 15000 });
  await anchored.click();
  await page.waitForTimeout(1000);
});

Then('the inline comment {string} is focused', async ({ page }, content: string) => {
  await expect(threadByContent(page, content)).toHaveAttribute('data-focused', 'true', { timeout: 15000 });
});

When('I select the {string} inline comment filter', async ({ page }, filter: string) => {
  const testId = FILTER_TEST_IDS[filter];

  expect(testId, `Unknown inline comment filter "${filter}"`).toBeTruthy();
  await sidebar(page).getByTestId(testId).click();
  await page.waitForTimeout(500);
});

Then('the comments panel shows the {string} empty state', async ({ page }, filter: string) => {
  const emptyState = sidebar(page).getByTestId('inline-comment-empty');

  await expect(emptyState).toBeVisible({ timeout: 30000 });
  await expect(emptyState).toContainText(EMPTY_STATE_TEXT[filter]);
});

Then('the comments panel is closed', async ({ page }) => {
  await expect(sidebar(page)).toHaveCount(0, { timeout: 15000 });
});

When('I open the comments panel from the page header', async ({ page }) => {
  await openCommentsPanel(page);
});

When('I close the comments panel', async ({ page }) => {
  await sidebar(page).getByTestId('inline-comment-sidebar-close').click();
});

When('I close the page modal', async ({ page }) => {
  await pageModal(page).getByTestId('view-modal-close').click();
  await expect(pageModal(page)).toHaveCount(0, { timeout: 15000 });
});

Then('inline commenting remains active for the routed document', async ({ page }) => {
  await expect(page.getByTestId('inline-comment-toggle')).toBeVisible({ timeout: 15000 });
});

Then('no record not found error is shown', async ({ page }) => {
  const surface = activePage(page);
  const assertNoError = async () => {
    await expect(surface.getByText('Page not found')).toHaveCount(0);
    await expect(surface.getByText('Something went wrong')).toHaveCount(0);
    await expect(surface.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
  };

  await assertNoError();
  // Preserve the desktop regression's observation window: a late async
  // failure is just as important as an error rendered on the first frame.
  await surface.waitForTimeout(2000);
  await assertNoError();
});

Then('the comments panel remains loading', async ({ page }) => {
  await expect(sidebar(page).getByTestId('inline-comment-loading')).toBeVisible({ timeout: 15000 });
});

When('I resume inline comment loading', async ({ page }) => {
  const paused = pausedCommentLoads.get(page);

  expect(paused, 'inline comment loading was not paused').toBeDefined();
  paused!.release();
  await expect(sidebar(page).getByTestId('inline-comment-loading')).toHaveCount(0, { timeout: 30000 });
  // Keep the handler registered until the paused request has actually resumed.
  // Removing it while route.continue() is still pending lets Playwright dispose
  // the interception first and produces "Route is already handled".
  await page.unroute(PAUSED_COMMENT_ROUTE, paused!.handler);
  pausedCommentLoads.delete(page);
});

When('I open the page in a clean browser context and open the comments panel', async ({ browser, page }) => {
  const flushed = await page.evaluate(async () => {
    const flush = (window as typeof window & { __TEST_FLUSH_ALL_SYNC__?: () => Promise<boolean> })
      .__TEST_FLUSH_ALL_SYNC__;

    if (!flush) throw new Error('The E2E sync flush hook is unavailable');
    return flush();
  });

  expect(flushed, 'the source browser still had unsent collaboration updates').toBe(true);

  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 1440, height: 900 },
  });
  const cleanPage = await context.newPage();

  setupPageErrorHandling(cleanPage);
  await cleanPage.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await expect(documentEditor(cleanPage)).toBeVisible({ timeout: 30000 });
  await openCommentsPanel(cleanPage);
  remoteVerificationPages.set(page, { context, page: cleanPage });
});
