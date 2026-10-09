import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { waitForGridReady } from '../../support/database-ui-helpers';
import { waitForDatabaseTestContext } from '../../support/relation-test-helpers';
import { RowDetailSelectors } from '../../support/selectors';
import { activeSidePeekPage, peekDocument } from '../../support/side-peek-helpers';

const { Then, When } = createBdd();

// Reused steps defined elsewhere (do not redefine):
// - the shared side peek library: sign-in, grid and property fixtures, opening
//   rows, the "Open page in" menu, edits, tabs, reload (side-peek.steps.ts)
// - 'the full row page document contains {string}' (side-peek-locked.steps.ts)
// - 'I return to the grid page' (row-page-lifecycle.steps.ts) replays that
//   file's own grid URL, so the step below derives the grid from the row URL

function assertOneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} must be one of ${allowed.join(', ')}, got "${value}"`);
  return value as T;
}

/**
 * The full row page (?r=) renders the row's properties with the peek's markup
 * (`.property-label` beside the cell wrapper), outside any peek shell.
 */
function fullRowPagePropertyValue(page: Page, name: string): Locator {
  return page
    .locator('.property-label')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()
    .locator('xpath=..')
    .locator(':scope > div')
    .last();
}

/**
 * Put the caret after the last character and type. The shared append step
 * clicks the editor itself, which lands inside longer text or, on the editor's
 * empty tail, inserts a paragraph; the right edge of the text is where a user
 * clicks to continue the line.
 */
async function appendToDocumentEnd(page: Page, editor: Locator, text: string): Promise<void> {
  const lastText = editor.locator('[data-slate-string="true"]').last();

  await expect(lastText).toBeVisible({ timeout: 15_000 });
  const box = await lastText.boundingBox();

  if (!box) throw new Error('The row document has no text to append to');
  await lastText.click({ position: { x: box.width - 1, y: box.height / 2 } });
  await page.keyboard.type(text, { delay: 30 });
  await expect(editor).toContainText(text.trim(), { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Editing in the peek
// ---------------------------------------------------------------------------

When('I append {string} to the end of the peek document', async ({ page }, text: string) => {
  const active = activeSidePeekPage(page);

  await appendToDocumentEnd(active, peekDocument(active), text);
});

// ---------------------------------------------------------------------------
// The full row page
// ---------------------------------------------------------------------------

Then('the {string} checkbox on the full row page is {word}', async ({ page }, name: string, state: string) => {
  const checked = assertOneOf(state, ['checked', 'unchecked'], 'Checkbox state') === 'checked';

  await expect(
    fullRowPagePropertyValue(activeSidePeekPage(page), name).locator('[data-testid^="checkbox-cell-"]')
  ).toHaveAttribute('data-checked', String(checked), { timeout: 15_000 });
});

/** The row page keeps its ?r= URL across a reload, unlike a peek. */
When('I reload the full row page', async ({ page }) => {
  const active = activeSidePeekPage(page);

  await active.reload();
  await expect(active).toHaveURL(/[?&]r=.+/);
  await expect(RowDetailSelectors.titleInput(active)).toBeVisible({ timeout: 30_000 });
});

/** Without ?r= the same database page renders its grid view again. */
When('I return to the grid page from the full row page', async ({ page }) => {
  const active = activeSidePeekPage(page);
  const url = new URL(active.url());

  if (!url.searchParams.has('r')) throw new Error('No full row page is open in the active browser tab');
  url.searchParams.delete('r');
  await active.goto(url.toString());
  await waitForGridReady(active);
  await waitForDatabaseTestContext(active);
});
