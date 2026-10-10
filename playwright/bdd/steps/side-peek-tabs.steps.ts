import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { activeSidePeekPage, peekDocument } from '../../support/side-peek-helpers';

const { Then, When } = createBdd();

// Reused steps defined elsewhere (do not redefine):
// - every other side peek sentence (open, append, mark, tabs, title, reload)
//   lives in side-peek.steps.ts

/** The row document editor the app exposes to tests, with its slate-yjs undo stack. */
type HistoryWindow = Window & {
  __TEST_EDITOR__?: { undoManager?: { undoStack: unknown[] } };
  __SIDE_PEEK_TABS_HISTORY__?: { editor: unknown; undoItems: number };
};

/** Gives the document editor the keyboard without changing its content. */
async function focusPeekDocument(page: Page): Promise<void> {
  const editor = peekDocument(page);

  await expect(editor).toBeVisible({ timeout: 15_000 });
  if (await editor.evaluate((node) => node === node.ownerDocument.activeElement)) return;
  // Click the text itself: a click on the editor's empty tail inserts a paragraph.
  const text = editor.locator('[data-slate-string]').last();

  if ((await text.count()) > 0) await text.click();
  else await editor.click();
}

// ---------------------------------------------------------------------------
// Editing history: the editor instance and its undo stack survive a tab switch
// ---------------------------------------------------------------------------

When('I remember the peek document editing history', async ({ page }) => {
  const active = activeSidePeekPage(page);

  // The typed baseline must already be an undo item, or "retained" would hold vacuously.
  await expect
    .poll(
      () => active.evaluate(() => (window as HistoryWindow).__TEST_EDITOR__?.undoManager?.undoStack.length ?? 0),
      { timeout: 15_000, message: 'Waiting for the row document edit to enter the undo stack' }
    )
    .toBeGreaterThan(0);
  await active.evaluate(() => {
    const win = window as HistoryWindow;
    const editor = win.__TEST_EDITOR__;

    if (!editor?.undoManager) throw new Error('The row document editor is not exposed to tests');
    win.__SIDE_PEEK_TABS_HISTORY__ = { editor, undoItems: editor.undoManager.undoStack.length };
  });
});

Then('the peek document editing history is retained', async ({ page }) => {
  const history = await activeSidePeekPage(page).evaluate(() => {
    const win = window as HistoryWindow;
    const remembered = win.__SIDE_PEEK_TABS_HISTORY__;
    const editor = win.__TEST_EDITOR__;

    if (!remembered) throw new Error('Remember the peek document editing history first');
    return {
      sameEditor: editor === remembered.editor,
      undoItems: editor?.undoManager?.undoStack.length ?? 0,
      rememberedItems: remembered.undoItems,
    };
  });

  expect(history.sameEditor, 'the row document editor was replaced').toBe(true);
  expect(history.undoItems, 'the undo stack changed').toBe(history.rememberedItems);
});

// ---------------------------------------------------------------------------
// Selection and undo inside this tab's document editor
// ---------------------------------------------------------------------------

When('I select all text in the peek document', async ({ page }) => {
  const active = activeSidePeekPage(page);

  await focusPeekDocument(active);
  await active.keyboard.press('ControlOrMeta+a');
});

Then('only the peek document has the selected text {string}', async ({ page }, text: string) => {
  const active = activeSidePeekPage(page);

  // The window has one selection: anchored in this editor, it holds the document and nothing else.
  await expect
    .poll(
      () =>
        peekDocument(active).evaluate((node) => {
          const selection = node.ownerDocument.getSelection();
          const anchor = selection?.anchorNode ?? null;

          return { inDocument: Boolean(anchor && node.contains(anchor)), text: selection?.toString() ?? '' };
        }),
      { timeout: 15_000 }
    )
    .toEqual({ inDocument: true, text });
});

/** The editor hotkey; slate-yjs reverts this editor's own last change only. */
When('I undo the last change in the peek document', async ({ page }) => {
  const active = activeSidePeekPage(page);

  await focusPeekDocument(active);
  await active.keyboard.press('ControlOrMeta+z');
});
