import { test, expect, Page } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { DropdownSelectors, EditorSelectors, HeaderSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Find & Replace Tests
 *
 * Covers the in-document find/replace panel migrated from the desktop app:
 * the header "…" menu item, Cmd/Ctrl+F, match highlighting/navigation,
 * match-case, and replace / replace-all.
 *
 * Uses a unique search token ("zqxmatch") so counts are deterministic even if
 * the default landing document already contains other text.
 */

const TOKEN_LINE = 'Zqxmatch zqxmatch ZQXMATCH tail';

// --- panel selectors (data-testids added in FindReplacePanel.tsx) ---
const panel = (page: Page) => page.getByTestId('find-and-replace-panel');
const findInput = (page: Page) => page.getByTestId('find-and-replace-find-input');
const replaceInput = (page: Page) => page.getByTestId('find-and-replace-replace-input');
const nextBtn = (page: Page) => page.getByTestId('find-and-replace-next');
const prevBtn = (page: Page) => page.getByTestId('find-and-replace-previous');
const caseBtn = (page: Page) => page.getByTestId('find-and-replace-case-sensitive');
const closeBtn = (page: Page) => page.getByTestId('find-and-replace-close');
const replaceToggle = (page: Page) => page.getByTestId('find-and-replace-toggle');
const replaceBtn = (page: Page) => page.getByTestId('find-and-replace-replace');
const replaceAllBtn = (page: Page) => page.getByTestId('find-and-replace-replace-all');

const highlights = (page: Page) => page.locator('.search-match-highlight');
const currentHighlight = (page: Page) => page.locator('.search-match-highlight-current');

async function setup(page: Page, request: import('@playwright/test').APIRequestContext, email: string) {
  page.on('pageerror', (err) => {
    if (err.message.includes('No workspace or service found')) return;
  });
  await signInAndWaitForApp(page, request, email);
  await expect(page).toHaveURL(/\/app/);
  await page.waitForTimeout(3000);
  await expect(EditorSelectors.slateEditor(page)).toBeVisible({ timeout: 20000 });
}

/** Type a known line of content into the open document's editor. */
async function typeContent(page: Page, text: string) {
  await EditorSelectors.firstEditor(page).click({ force: true });
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
  await page.waitForTimeout(800);
}

async function openFindReplaceFromMenu(page: Page) {
  await HeaderSelectors.moreActionsButton(page).click();
  await expect(DropdownSelectors.content(page)).toBeVisible();
  await page.getByTestId('more-page-find-and-replace').click();
  await expect(panel(page)).toBeVisible();
}

/** Type into the find field and wait for the debounced search (200ms) to settle. */
async function search(page: Page, query: string) {
  await findInput(page).fill(query);
  await page.waitForTimeout(500);
}

test.describe('Find & Replace', () => {
  let testEmail: string;

  test.beforeEach(() => {
    testEmail = generateRandomEmail();
  });

  test.describe('Entry points & lifecycle', () => {
    test('header menu shows "Find and replace" and "Version history" labels', async ({ page, request }) => {
      await setup(page, request, testEmail);

      await HeaderSelectors.moreActionsButton(page).click();
      const dropdown = DropdownSelectors.content(page);

      await expect(dropdown).toBeVisible();
      // Find & replace migrated item + the renamed "Version history" (was "Page History")
      await expect(dropdown.getByText('Find and replace')).toBeVisible();
      await expect(dropdown.getByText('Version history')).toBeVisible();
      await expect(dropdown.getByText('Page History')).toHaveCount(0);
    });

    test('menu item opens the panel with the replace row visible', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await openFindReplaceFromMenu(page);

      await expect(findInput(page)).toBeVisible();
      await expect(replaceInput(page)).toBeVisible();
    });

    test('Cmd/Ctrl+F opens the panel in find-only mode', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await typeContent(page, TOKEN_LINE);

      await EditorSelectors.firstEditor(page).click({ force: true });
      await page.keyboard.press('ControlOrMeta+f');

      await expect(panel(page)).toBeVisible();
      // Find-only: the replace row should not be shown until the toggle is used.
      await expect(replaceInput(page)).toHaveCount(0);
    });

    test('Escape and the close button both dismiss the panel', async ({ page, request }) => {
      await setup(page, request, testEmail);

      await openFindReplaceFromMenu(page);
      await findInput(page).press('Escape');
      await expect(panel(page)).toBeHidden();

      await openFindReplaceFromMenu(page);
      await closeBtn(page).click();
      await expect(panel(page)).toBeHidden();
    });
  });

  test.describe('Find behavior', () => {
    test('highlights all matches and shows the n/total count', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await typeContent(page, TOKEN_LINE);
      await openFindReplaceFromMenu(page);

      await search(page, 'zqxmatch');

      await expect(panel(page)).toContainText('1/3');
      await expect(highlights(page)).toHaveCount(3);
      await expect(currentHighlight(page)).toHaveCount(1);
    });

    test('shows "No results" for a query with no matches', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await typeContent(page, TOKEN_LINE);
      await openFindReplaceFromMenu(page);

      await search(page, 'no-such-token-xyz');

      await expect(panel(page)).toContainText('No results');
      await expect(highlights(page)).toHaveCount(0);
    });

    test('Next / Enter advances and wraps around', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await typeContent(page, TOKEN_LINE);
      await openFindReplaceFromMenu(page);
      await search(page, 'zqxmatch');

      await expect(panel(page)).toContainText('1/3');
      await nextBtn(page).click();
      await expect(panel(page)).toContainText('2/3');
      // Enter inside the find field also advances.
      await findInput(page).press('Enter');
      await expect(panel(page)).toContainText('3/3');
      // Wrap back to the first match.
      await nextBtn(page).click();
      await expect(panel(page)).toContainText('1/3');
    });

    test('Previous / Shift+Enter goes backward and wraps', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await typeContent(page, TOKEN_LINE);
      await openFindReplaceFromMenu(page);
      await search(page, 'zqxmatch');

      await expect(panel(page)).toContainText('1/3');
      // From the first match, previous wraps to the last.
      await prevBtn(page).click();
      await expect(panel(page)).toContainText('3/3');
      await findInput(page).press('Shift+Enter');
      await expect(panel(page)).toContainText('2/3');
    });

    test('match-case toggle filters to exact-case matches', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await typeContent(page, TOKEN_LINE);
      await openFindReplaceFromMenu(page);

      await search(page, 'zqxmatch');
      await expect(panel(page)).toContainText('1/3');

      // Enable case sensitivity → only the exact lowercase "zqxmatch" matches.
      await caseBtn(page).click();
      await page.waitForTimeout(500);
      await expect(panel(page)).toContainText('1/1');
      await expect(highlights(page)).toHaveCount(1);
    });
  });

  test.describe('Replace behavior', () => {
    test('Replace swaps the current match and re-searches', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await typeContent(page, TOKEN_LINE);
      await openFindReplaceFromMenu(page);
      await search(page, 'zqxmatch');
      await expect(panel(page)).toContainText('1/3');

      await replaceInput(page).fill('replacedword');
      await replaceBtn(page).click();
      await page.waitForTimeout(600);

      // One occurrence replaced → two left.
      await expect(panel(page)).toContainText('1/2');
      await expect(EditorSelectors.firstEditor(page)).toContainText('replacedword');
    });

    test('Replace All replaces every match and reports the count', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await typeContent(page, TOKEN_LINE);
      await openFindReplaceFromMenu(page);
      await search(page, 'zqxmatch');
      await expect(panel(page)).toContainText('1/3');

      await replaceInput(page).fill('omegaword');
      await replaceAllBtn(page).click();

      // Success toast (sonner) + the panel now finds nothing.
      await expect(page.getByText(/Replaced\s+\d+\s+match/i)).toBeVisible({ timeout: 5000 });
      await expect(panel(page)).toContainText('No results');
      await expect(EditorSelectors.firstEditor(page)).not.toContainText('zqxmatch', { ignoreCase: true });
    });

    test('Replace and Replace All are disabled when there are no matches', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await typeContent(page, TOKEN_LINE);
      await openFindReplaceFromMenu(page);

      await search(page, 'no-such-token-xyz');
      await expect(replaceBtn(page)).toBeDisabled();
      await expect(replaceAllBtn(page)).toBeDisabled();
    });
  });

  test.describe('Selection pre-fill', () => {
    test('opening find with a selection pre-fills the query', async ({ page, request }) => {
      await setup(page, request, testEmail);
      await typeContent(page, 'preselected token here');

      // Drive Slate's selection directly via the editor exposed by
      // CollaborativeEditor in test mode (window.Cypress is set during sign-in).
      await page.evaluate((needle) => {
        const ed = (window as { __TEST_EDITOR__?: unknown }).__TEST_EDITOR__ as
          | (Record<string, unknown> & { children: unknown[]; select: (range: unknown) => void })
          | undefined;

        if (!ed) throw new Error('__TEST_EDITOR__ not exposed by the editor');

        type N = { text?: string; children?: N[] };
        const find = (node: N, path: number[]): { path: number[]; offset: number } | null => {
          if (typeof node.text === 'string') {
            const i = node.text.indexOf(needle);

            return i >= 0 ? { path, offset: i } : null;
          }
          if (Array.isArray(node.children)) {
            for (let k = 0; k < node.children.length; k++) {
              const r = find(node.children[k], [...path, k]);

              if (r) return r;
            }
          }
          return null;
        };

        for (let i = 0; i < ed.children.length; i++) {
          const hit = find(ed.children[i] as N, [i]);

          if (hit) {
            ed.select({
              anchor: { path: hit.path, offset: hit.offset },
              focus: { path: hit.path, offset: hit.offset + needle.length },
            });
            return;
          }
        }
        throw new Error(`Text "${needle}" not found in editor`);
      }, 'preselected');

      await page.keyboard.press('ControlOrMeta+f');

      await expect(panel(page)).toBeVisible();
      await expect(findInput(page)).toHaveValue('preselected');
    });
  });
});
