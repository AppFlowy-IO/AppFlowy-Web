import { createBdd } from 'playwright-bdd';

const { When } = createBdd();

type TestSlatePoint = {
  path: number[];
  offset: number;
};

type TestSlateRange = {
  anchor: TestSlatePoint;
  focus: TestSlatePoint;
};

type TestSlateEditor = {
  select?: (range: TestSlateRange) => void;
  insertData?: (data: DataTransfer) => void;
  setFragmentData?: (data: Pick<DataTransfer, 'getData' | 'setData'>) => void;
};

type TestWindow = Window & {
  __TEST_EDITOR__?: TestSlateEditor;
  __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
  __TEST_SELECTED_RANGE__?: TestSlateRange;
  __TEST_COPIED_CLIPBOARD__?: Record<string, string>;
};

// The shared "I select text from offset ..." step stashes the chosen range on
// __TEST_SELECTED_RANGE__ because the DOM selection sync can clobber
// editor.selection between steps. Each step below re-applies the stashed range
// right before acting, like insertTextIntoExpandedSelection in
// editor-editing.steps does.

/**
 * Pastes html content at the current editor selection WITHOUT refocusing the
 * editor first. The shared "I paste html content:" step clicks the editor,
 * which moves the caret — these scenarios place the caret explicitly and must
 * keep it where it is.
 */
When('I paste html content at the current caret:', async ({ page }, html: string) => {
  await page.evaluate((html) => {
    const testWindow = window as TestWindow;
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];

    if (!editor?.insertData) {
      throw new Error('No test editor with insertData() found');
    }

    const stashed = testWindow.__TEST_SELECTED_RANGE__;

    if (stashed) {
      editor.select?.(stashed);
      delete testWindow.__TEST_SELECTED_RANGE__;
    }

    const plainText = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const dataTransfer = new DataTransfer();

    dataTransfer.setData('text/html', html);
    dataTransfer.setData('text/plain', plainText);
    editor.insertData(dataTransfer);
  }, html.trim());

  await page.waitForTimeout(1000);
});

/**
 * Captures what AppFlowy would put on the clipboard for the current selection
 * (text/plain, text/html, and application/x-appflowy-fragment) via the
 * editor's setFragmentData, and stashes it on the window for a later paste.
 */
When('I copy the current editor selection', async ({ page }) => {
  const types = await page.evaluate(() => {
    const testWindow = window as TestWindow;
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];

    if (!editor?.setFragmentData) {
      throw new Error('No test editor with setFragmentData() found');
    }

    const stashed = testWindow.__TEST_SELECTED_RANGE__;

    if (stashed) {
      editor.select?.(stashed);
    }

    const dataTransfer = new DataTransfer();

    editor.setFragmentData(dataTransfer);

    const captured: Record<string, string> = {};

    for (const type of dataTransfer.types) {
      captured[type] = dataTransfer.getData(type);
    }

    testWindow.__TEST_COPIED_CLIPBOARD__ = captured;
    return Object.keys(captured);
  });

  if (types.length === 0) {
    throw new Error('Copy captured no clipboard data — is the selection expanded?');
  }
});

/**
 * Pastes the clipboard data captured by "I copy the current editor selection"
 * at the current editor selection, without refocusing the editor.
 */
When('I paste the copied content at the current caret', async ({ page }) => {
  await page.evaluate(() => {
    const testWindow = window as TestWindow;
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];
    const captured = testWindow.__TEST_COPIED_CLIPBOARD__;

    if (!editor?.insertData) {
      throw new Error('No test editor with insertData() found');
    }

    if (!captured || Object.keys(captured).length === 0) {
      throw new Error('No copied clipboard data — run "I copy the current editor selection" first');
    }

    const stashed = testWindow.__TEST_SELECTED_RANGE__;

    if (stashed) {
      editor.select?.(stashed);
      delete testWindow.__TEST_SELECTED_RANGE__;
    }

    const dataTransfer = new DataTransfer();

    for (const [type, value] of Object.entries(captured)) {
      dataTransfer.setData(type, value);
    }

    editor.insertData(dataTransfer);
  });

  await page.waitForTimeout(1000);
});
