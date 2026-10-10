import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { insertLinkedGridViaSlash } from '../../support/duplicate-test-helpers';
import { currentViewIdFromUrl } from '../../support/page-utils';
import { BlockSelectors, DatabaseGridSelectors } from '../../support/selectors';
import {
  activeSidePeekPage,
  expectPeekOpen,
  peek,
  peekNavigationButton,
  peekPropertyValue,
  peekTitle,
  PEEK_SHORTCUTS,
  type PeekDirection,
  type PeekNavigationVia,
} from '../../support/side-peek-helpers';

const { Given, Then, When } = createBdd();

// Builds on the shared side peek library (side-peek.steps.ts). These steps
// cover what that library leaves out on purpose: drafts left focused, attempts
// the peek may refuse, and a document whose two linked grids compete for the
// one side slot. The shared grid helpers resolve `database-grid` strictly, so
// the two-grid steps locate rows by title across every grid on the page.

/** grid.row.textTooLong: the toast for a draft over the 10,000 byte text limit. */
const TEXT_TOO_LONG_MESSAGE = 'This text is too long to save';
const DATA_ROW_SELECTOR = '[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])';

function assertOneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} must be one of ${allowed.join(', ')}, got "${value}"`);
  return value as T;
}

/** "x" is one UTF-8 byte, so the length is the byte size the limit counts. */
function titleOfLength(length: number): string {
  return 'x'.repeat(length);
}

/** A row of any grid on the page by its primary cell text; titles are unique across grids. */
function linkedGridRow(page: Page, title: string): Locator {
  return DatabaseGridSelectors.dataRows(page).filter({ has: page.getByText(title, { exact: true }) }).first();
}

/** Hover the row and click its expand control without asserting what the peek does with it. */
async function clickLinkedGridRowExpand(page: Page, title: string): Promise<void> {
  const row = linkedGridRow(page, title);

  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  const expand = row.getByTestId('row-expand-button');

  await expect(expand).toBeVisible({ timeout: 10_000 });
  await expand.click();
}

async function expectLinkedGridsReady(page: Page, count: number): Promise<void> {
  const grids = DatabaseGridSelectors.grid(page);

  await expect(grids).toHaveCount(count, { timeout: 30_000 });
  for (let index = 0; index < count; index += 1) {
    await expect(grids.nth(index).locator(DATA_ROW_SELECTOR).first()).toBeVisible({ timeout: 30_000 });
  }
}

/** A linked grid takes the paragraph it was inserted into, so the next slash menu needs a new one below it. */
async function addParagraphBelowLastGridBlock(page: Page): Promise<void> {
  const blockId = await page.evaluate(() => {
    const testWindow = window as Window & {
      __TEST_EDITOR__?: { children?: Array<{ type?: string; blockId?: string }> };
      __TEST_CUSTOM_EDITOR__?: {
        addBelowBlock?: (editor: unknown, blockId: string, type: string, data: Record<string, never>) => string | void;
      };
    };
    const editor = testWindow.__TEST_EDITOR__;
    const grids = editor?.children?.filter((node) => node.type === 'grid') ?? [];
    const lastGrid = grids[grids.length - 1];

    if (!editor || !testWindow.__TEST_CUSTOM_EDITOR__?.addBelowBlock || !lastGrid?.blockId) return null;
    return testWindow.__TEST_CUSTOM_EDITOR__.addBelowBlock(editor, lastGrid.blockId, 'paragraph', {}) ?? null;
  });

  if (!blockId) throw new Error('Unable to add a paragraph below the last linked grid');
  await expect(BlockSelectors.blockByType(page, 'paragraph').last()).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Drafts the row handoff has to commit
// ---------------------------------------------------------------------------

/** Leaves the property editor focused: no Enter or blur, the handoff itself must commit it. */
When(
  'I type {string} into the {string} text property of the peek without leaving it',
  async ({ page }, value: string, name: string) => {
    const active = activeSidePeekPage(page);

    await peekPropertyValue(active, name).click();
    const editor = peek(active).getByTestId('rich-text-cell-editor');

    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.fill(value);
    await expect(editor).toBeFocused();
  }
);

/** The title saves as it is typed, so an oversized one is rejected right here. */
When('I replace the peek title with {int} characters', async ({ page }, length: number) => {
  const active = activeSidePeekPage(page);

  await peekTitle(active).fill(titleOfLength(length));
  await expect(peekTitle(active)).toHaveText(titleOfLength(length));
});

Then('the title is rejected as too long to save', async ({ page }) => {
  const toast = activeSidePeekPage(page)
    .locator('[data-sonner-toast][data-type="error"]')
    .filter({ hasText: TEXT_TOO_LONG_MESSAGE });

  await expect(toast).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// Attempts the peek may refuse
// ---------------------------------------------------------------------------

When('I try to close the peek with the close button', async ({ page }) => {
  await activeSidePeekPage(page).getByTestId('row-detail-close').click();
});

/** The target row must exist, so a refusal is the peek's decision, not a missing row. */
When('I try to navigate to the {word} row with the {word}', async ({ page }, direction: string, via: string) => {
  const active = activeSidePeekPage(page);
  const target = assertOneOf<PeekDirection>(direction, ['previous', 'next'], 'Direction');
  const button = peekNavigationButton(active, target);

  await expect(button).toBeEnabled();
  if (assertOneOf<PeekNavigationVia>(via, ['button', 'shortcut'], 'Navigation') === 'button') await button.click();
  else await active.keyboard.press(PEEK_SHORTCUTS[target]);
});

Then('the peek stays open showing the {int} character title', async ({ page }, length: number) => {
  const active = activeSidePeekPage(page);

  await expect(peek(active)).toHaveCount(1);
  await expect(peek(active)).toBeVisible();
  await expect(peekTitle(active)).toHaveText(titleOfLength(length));
});

// ---------------------------------------------------------------------------
// A document with two linked grids
// ---------------------------------------------------------------------------

Given('the document also links the grid {string}', async ({ page }, gridName: string) => {
  const active = activeSidePeekPage(page);
  const documentId = currentViewIdFromUrl(active);
  const before = await DatabaseGridSelectors.grid(active).count();

  await addParagraphBelowLastGridBlock(active);
  // A line past the existing blocks opens the slash menu below the last grid.
  await insertLinkedGridViaSlash(active, documentId, gridName, before);
  await expectLinkedGridsReady(active, before + 1);
});

When('I open the row {string} in the peek from the linked grid', async ({ page }, title: string) => {
  const active = activeSidePeekPage(page);

  await clickLinkedGridRowExpand(active, title);
  await expectPeekOpen(active, undefined, title);
});

/** No assertion: an open peek with an unsaved draft may keep the panel. */
When('I try to open the row {string} in the peek from the linked grid', async ({ page }, title: string) => {
  await clickLinkedGridRowExpand(activeSidePeekPage(page), title);
});

Then('the linked grid shows a row titled {string}', async ({ page }, title: string) => {
  await expect(linkedGridRow(activeSidePeekPage(page), title)).toBeVisible({ timeout: 15_000 });
});

/** The shared reload step expects one grid; a document can show several. */
When('I reload the document page', async ({ page }) => {
  const active = activeSidePeekPage(page);
  const count = await DatabaseGridSelectors.grid(active).count();

  await active.reload();
  await expectLinkedGridsReady(active, count);
});
