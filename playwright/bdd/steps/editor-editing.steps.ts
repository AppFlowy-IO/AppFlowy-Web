import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { BlockSelectors, EditorSelectors, SlashCommandSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, Before } = createBdd();

const isMac = process.platform === 'darwin';
const modKey = isMac ? 'Meta' : 'Control';
const wordKey = isMac ? 'Alt' : 'Control';

type TestSlatePoint = {
  path: number[];
  offset: number;
};

type TestSlateRange = {
  anchor: TestSlatePoint;
  focus: TestSlatePoint;
};

type TestSlateNode = {
  type?: string;
  text?: string;
  children?: TestSlateNode[];
  data?: Record<string, unknown>;
  href?: string;
  [key: string]: unknown;
};

type TestSlateEditor = {
  children: TestSlateNode[];
  selection?: TestSlateRange | null;
  delete?: (options?: { at?: TestSlateRange }) => void;
  select?: (range: TestSlateRange) => void;
  insertText?: (text: string) => void;
  insertData?: (data: DataTransfer) => void;
  undo?: () => void;
  redo?: () => void;
};

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1280, height: 720 });
});

Given('a blank document page is open', async ({ page, request }) => {
  await signInAndWaitForApp(page, request, generateRandomEmail());
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

  await createDocumentPageAndNavigate(page);
  await focusEditor(page);
});

When('I type {string} in the editor', async ({ page }, text: string) => {
  const insertedIntoSelection = await insertTextIntoExpandedSelection(page, text);

  if (!insertedIntoSelection) {
    if (!(await hasTestEditorSelection(page))) {
      await focusEditor(page);
    }

    await page.keyboard.type(text);
  }

  await page.waitForTimeout(300);
});

When('I type quote markdown text {string} in the editor', async ({ page }, text: string) => {
  await focusEditor(page);
  await page.keyboard.type(`" ${text}`);
  await page.waitForTimeout(300);
});

When('I paste plain text:', async ({ page }, plainText: string) => {
  await focusEditor(page);
  await pasteContent(page, '', plainText);
});

When('I paste html content:', async ({ page }, html: string) => {
  await focusEditor(page);
  await pasteContent(page, html, htmlToPlainText(html));
});

When('I paste markdown text:', async ({ page }, markdown: string) => {
  await focusEditor(page);
  await pasteContent(page, '', markdown);
});

When('I paste plain text into the current selection:', async ({ page }, plainText: string) => {
  await pasteContent(page, '', plainText.trim());
});

When('I select the last word', async ({ page }) => {
  await focusEditor(page);
  const lastWord = await selectLastWordInTestEditor(page);

  expect(lastWord).toBeTruthy();
  await page.waitForTimeout(300);
});

When(
  'I select text from offset {int} to offset {int} in editor block {int}',
  async ({ page }, startOffset: number, endOffset: number, blockIndex: number) => {
    await selectTextInEditorBlock(page, blockIndex, startOffset, endOffset);
    await page.waitForTimeout(500);
  }
);

When('I select all editor content', async ({ page }) => {
  await focusEditor(page);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.waitForTimeout(500);
});

When('I apply the {string} formatting shortcut', async ({ page }, format: string) => {
  await page.keyboard.press(formatShortcut(format));
  await page.waitForTimeout(500);
});

When('I apply the {string} block toolbar action', async ({ page }, action: string) => {
  await expect(EditorSelectors.selectionToolbar(page)).toBeVisible();
  await applyBlockToolbarAction(page, action);
  await page.waitForTimeout(500);
});

When('I apply the {string} alignment shortcut', async ({ page }, alignment: string) => {
  await page.keyboard.press(alignmentShortcut(alignment));
  await page.waitForTimeout(500);
});

When('I apply link {string} from the toolbar', async ({ page }, href: string) => {
  await expect(EditorSelectors.selectionToolbar(page)).toBeVisible();
  await EditorSelectors.linkButton(page).click({ force: true });

  const popover = page.locator('.MuiPopover-root:visible').last();
  const input = popover.locator('input').first();

  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(href);
  await input.press('Enter');
  await page.waitForTimeout(500);
});

When('I delete the previous word', async ({ page }) => {
  await focusEditor(page);
  await page.keyboard.press(`${wordKey}+Backspace`);
  await page.waitForTimeout(300);
});

When('I move the caret left {int} characters', async ({ page }, count: number) => {
  await focusEditor(page);
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('ArrowLeft');
  }
  await page.waitForTimeout(200);
});

When('I press {string}', async ({ page }, key: string) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(300);
});

When('I undo the editor change', async ({ page }) => {
  await undoEditorChange(page);
  await page.waitForTimeout(500);
});

When('I undo the editor change {int} times', async ({ page }, count: number) => {
  for (let i = 0; i < count; i++) {
    await undoEditorChange(page);
  }
  await page.waitForTimeout(500);
});

When('I redo the editor change', async ({ page }) => {
  await redoEditorChange(page);
  await page.waitForTimeout(500);
});

When('I redo the editor change {int} times', async ({ page }, count: number) => {
  for (let i = 0; i < count; i++) {
    await redoEditorChange(page);
  }
  await page.waitForTimeout(500);
});

When('I open the slash menu', async ({ page }) => {
  await focusEditor(page);
  await page.keyboard.type('/');
  await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible({ timeout: 10000 });
});

When('I type slash in the editor', async ({ page }) => {
  await page.keyboard.type('/');
  await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible({ timeout: 10000 });
});

When('I search the slash menu for {string}', async ({ page }, searchTerm: string) => {
  await page.keyboard.type(searchTerm, { delay: 50 });
  await page.waitForTimeout(300);
});

When('I select slash command {string}', async ({ page }, command: string) => {
  const commandItem = page.getByTestId(`slash-menu-${command}`);

  await expect(commandItem).toBeVisible({ timeout: 10000 });
  await commandItem.click({ force: true });
  await page.waitForTimeout(500);
});

When('I choose slash command {string}', async ({ page }, command: string) => {
  await focusEditor(page);
  await page.keyboard.type(`/${slashCommandSearch(command)}`, { delay: 50 });

  const commandItem = page.getByTestId(`slash-menu-${command}`);

  await expect(commandItem).toBeVisible({ timeout: 10000 });
  await commandItem.click({ force: true });
  await page.waitForTimeout(500);
});

When('I toggle the todo item checkbox', async ({ page }) => {
  await page.locator('span.text-block-icon').first().click();
  await page.waitForTimeout(300);
});

When('I toggle the toggle list icon', async ({ page }) => {
  await page.getByTestId('toggle-icon').first().click({ force: true });
  await page.waitForTimeout(300);
});

When('I press the toggle block shortcut', async ({ page }) => {
  await page.keyboard.press(`${modKey}+Enter`);
  await page.waitForTimeout(300);
});

Then('the editor contains {string}', async ({ page }, text: string) => {
  await expect(EditorSelectors.slateEditor(page)).toContainText(text);
});

Then('the editor does not contain {string}', async ({ page }, text: string) => {
  await expect(EditorSelectors.slateEditor(page)).not.toContainText(text);
});

Then('the editor visibly contains {string}', async ({ page }, text: string) => {
  await expect(EditorSelectors.slateEditor(page).getByText(text)).toBeVisible();
});

Then('the editor does not visibly contain {string}', async ({ page }, text: string) => {
  await expect(EditorSelectors.slateEditor(page).getByText(text)).not.toBeVisible();
});

Then('a {string} block contains {string}', async ({ page }, blockType: string, text: string) => {
  await expect(BlockSelectors.blockByType(page, blockType).filter({ hasText: text }).first()).toBeVisible();
});

Then('the document has {int} {string} block', async ({ page }, count: number, blockType: string) => {
  await expect(BlockSelectors.blockByType(page, blockType)).toHaveCount(count);
});

Then('the editor has exactly {int} top-level block', async ({ page }, count: number) => {
  await expect
    .poll(() => getTopLevelBlockCount(page), {
      timeout: 15000,
      message: `Expected editor to have exactly ${count} top-level block(s)`,
    })
    .toBe(count);
});

Then('the editor has exactly {int} top-level blocks', async ({ page }, count: number) => {
  await expect
    .poll(() => getTopLevelBlockCount(page), {
      timeout: 15000,
      message: `Expected editor to have exactly ${count} top-level block(s)`,
    })
    .toBe(count);
});

Then('the editor has at least {int} top-level blocks', async ({ page }, count: number) => {
  await expect
    .poll(() => getTopLevelBlockCount(page), {
      timeout: 15000,
      message: `Expected editor to have at least ${count} top-level block(s)`,
    })
    .toBeGreaterThanOrEqual(count);
});

Then('editor block {int} has type {string}', async ({ page }, blockIndex: number, blockType: string) => {
  await expect
    .poll(() => getEditorBlock(page, blockIndex).then((block) => block?.type ?? null), {
      timeout: 15000,
      message: `Expected editor block ${blockIndex} to have type "${blockType}"`,
    })
    .toBe(blockType);
});

Then('editor block {int} contains {string}', async ({ page }, blockIndex: number, text: string) => {
  await expect
    .poll(() => getEditorBlock(page, blockIndex).then((block) => (block ? nodeText(block) : null)), {
      timeout: 15000,
      message: `Expected editor block ${blockIndex} to contain "${text}"`,
    })
    .toContain(text);
});

Then('editor block {int} has alignment {string}', async ({ page }, blockIndex: number, alignment: string) => {
  await expect
    .poll(() => getEditorBlock(page, blockIndex).then((block) => block?.data?.align ?? null), {
      timeout: 15000,
      message: `Expected editor block ${blockIndex} to have "${alignment}" alignment`,
    })
    .toBe(alignment);
});

Then('inline code contains {string}', async ({ page }, text: string) => {
  await expect(page.locator('span.bg-border-primary').filter({ hasText: text })).toBeAttached();
});

Then('{string} formatting contains {string}', async ({ page }, format: string, text: string) => {
  await expect(formattingLocator(page, format).filter({ hasText: text })).toBeAttached();
});

Then('link mark {string} has href {string}', async ({ page }, text: string, href: string) => {
  await expect
    .poll(() => findLinkHref(page, text), {
      timeout: 15000,
      message: `Expected link mark "${text}" to have href "${href}"`,
    })
    .toBe(href);
});

Then('the selection toolbar is visible', async ({ page }) => {
  const toolbar = EditorSelectors.selectionToolbar(page);

  await expect(toolbar).toHaveCSS('opacity', '1');
  await expect(toolbar).toHaveCSS('pointer-events', 'auto');
});

Then('the selection toolbar is hidden', async ({ page }) => {
  const toolbar = EditorSelectors.selectionToolbar(page);

  await expect(toolbar).toHaveCSS('opacity', '0');
  await expect(toolbar).toHaveCSS('pointer-events', 'none');
});

Then('the slash menu is visible', async ({ page }) => {
  await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();
});

Then('the slash menu is hidden', async ({ page }) => {
  await expect(SlashCommandSelectors.slashPanel(page)).toBeHidden();
});

Then('the slash menu command {string} is visible', async ({ page }, command: string) => {
  await expect(page.getByTestId(`slash-menu-${command}`)).toBeVisible();
});

Then('the slash menu has {int} visible command', async ({ page }, count: number) => {
  await expect(SlashCommandSelectors.slashPanel(page).locator('[data-testid^="slash-menu-"]:visible')).toHaveCount(
    count
  );
});

Then(
  '{string} is nested under {string} in {string}',
  async ({ page }, childText: string, parentText: string, blockType: string) => {
    const parentBlock = BlockSelectors.blockByType(page, blockType).filter({ hasText: parentText }).first();
    const nestedBlock = parentBlock.locator(BlockSelectors.blockSelector(blockType), { hasText: childText });

    await expect(nestedBlock).toBeVisible();
  }
);

Then(
  '{string} is not nested under {string} in {string}',
  async ({ page }, childText: string, parentText: string, blockType: string) => {
    const parentBlock = BlockSelectors.blockByType(page, blockType).filter({ hasText: parentText }).first();
    const nestedBlock = parentBlock.locator(BlockSelectors.blockSelector(blockType), { hasText: childText });

    await expect(nestedBlock).not.toBeVisible();
  }
);

Then('the todo item {string} is checked', async ({ page }, text: string) => {
  await expect(
    BlockSelectors.blockByType(page, 'todo_list').filter({ hasText: text }).first().locator('.checked')
  ).toBeVisible();
});

Then('the todo item {string} is not checked', async ({ page }, text: string) => {
  await expect(
    BlockSelectors.blockByType(page, 'todo_list').filter({ hasText: text }).first().locator('.checked')
  ).toHaveCount(0);
});

Then('the first toggle list is collapsed', async ({ page }) => {
  await expect
    .poll(() => getFirstBlockDataValue(page, 'toggle_list', 'collapsed'), {
      timeout: 15000,
      message: 'Expected the first toggle list to be collapsed',
    })
    .toBe(true);
});

Then('the first toggle list is expanded', async ({ page }) => {
  await expect
    .poll(() => getFirstBlockDataValue(page, 'toggle_list', 'collapsed'), {
      timeout: 15000,
      message: 'Expected the first toggle list to be expanded',
    })
    .toBe(false);
});

async function focusEditor(page: Page) {
  const editor = EditorSelectors.firstEditor(page);

  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.click({ force: true });
  await page.waitForTimeout(200);
}

async function undoEditorChange(page: Page) {
  await page.keyboard.press(`${modKey}+z`);
}

async function redoEditorChange(page: Page) {
  const redone = await page.evaluate(() => {
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestSlateEditor;
      __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
    };
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];

    if (editor?.redo) {
      editor.redo();
      return true;
    }

    return false;
  });

  if (!redone) {
    await page.keyboard.press(isMac ? 'Meta+Shift+z' : 'Control+Shift+z');
  }
}

async function applyBlockToolbarAction(page: Page, action: string) {
  switch (action) {
    case 'heading1':
      await EditorSelectors.headingButton(page).click({ force: true });
      await EditorSelectors.heading1Button(page).click({ force: true });
      return;
    case 'bulletedList':
      await page.getByTestId('toolbar-bulleted-list-button').click({ force: true });
      return;
    case 'numberedList':
      await page.getByTestId('toolbar-numbered-list-button').click({ force: true });
      return;
    case 'quote':
      await page.getByTestId('toolbar-quote-button').click({ force: true });
      return;
    default:
      throw new Error(`Unsupported block toolbar action: ${action}`);
  }
}

async function hasTestEditorSelection(page: Page) {
  return page.evaluate(() => {
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestSlateEditor;
      __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
    };
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];

    return Boolean(editor?.selection);
  });
}

async function selectTextInEditorBlock(page: Page, blockIndex: number, startOffset: number, endOffset: number) {
  const selected = await page.evaluate(
    ({ blockIndex, startOffset, endOffset }) => {
      const testWindow = window as Window & {
        __TEST_EDITOR__?: TestSlateEditor;
        __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
        __TEST_SELECTED_RANGE__?: TestSlateRange;
      };
      const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];

      if (!editor?.select) {
        throw new Error('No test editor with select() found');
      }

      const block = editor.children[blockIndex];

      if (!block) return false;

      const leaves: Array<{ path: number[]; text: string; start: number; end: number }> = [];
      let cursor = 0;

      const walk = (node: TestSlateNode, path: number[]) => {
        if (typeof node.text === 'string') {
          const start = cursor;

          cursor += node.text.length;
          leaves.push({ path, text: node.text, start, end: cursor });
          return;
        }

        node.children?.forEach((child, index) => walk(child, [...path, index]));
      };

      walk(block, [blockIndex]);

      if (leaves.length === 0) return false;

      const pointAtTextOffset = (offset: number): TestSlatePoint => {
        const leaf = leaves.find(({ start, end }) => offset >= start && offset <= end) ?? leaves[leaves.length - 1];

        return {
          path: leaf.path,
          offset: Math.max(0, Math.min(offset - leaf.start, leaf.text.length)),
        };
      };

      const selectedRange = {
        anchor: pointAtTextOffset(startOffset),
        focus: pointAtTextOffset(endOffset),
      };

      editor.select(selectedRange);
      testWindow.__TEST_SELECTED_RANGE__ = selectedRange;

      (document.querySelector('[data-slate-editor="true"]') as HTMLElement | null)?.focus();
      document.dispatchEvent(new Event('selectionchange'));

      return true;
    },
    { blockIndex, startOffset, endOffset }
  );

  expect(selected).toBe(true);
}

async function insertTextIntoExpandedSelection(page: Page, text: string) {
  return page.evaluate((text) => {
    const getTestWindow = () => {
      const testWindow = window as Window & {
        __TEST_EDITOR__?: TestSlateEditor;
        __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
        __TEST_SELECTED_RANGE__?: TestSlateRange;
      };

      return testWindow;
    };
    const pointsEqual = (a: TestSlatePoint, b: TestSlatePoint) => {
      return (
        a.offset === b.offset &&
        a.path.length === b.path.length &&
        a.path.every((value, index) => value === b.path[index])
      );
    };
    const testWindow = getTestWindow();
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];
    const selectedRange = testWindow.__TEST_SELECTED_RANGE__;

    if (editor?.delete && editor?.insertText && selectedRange) {
      editor.select?.(selectedRange);
      editor.delete({ at: selectedRange });
      editor.insertText(text);
      delete testWindow.__TEST_SELECTED_RANGE__;
      return true;
    }

    const selection = editor?.selection;

    if (!editor?.insertText || !selection || pointsEqual(selection.anchor, selection.focus)) {
      return false;
    }

    editor.insertText(text);
    return true;
  }, text);
}

async function selectLastWordInTestEditor(page: Page) {
  return page.evaluate(() => {
    const getTestWindow = () => {
      const testWindow = window as Window & {
        __TEST_EDITOR__?: TestSlateEditor;
        __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
        __TEST_SELECTED_RANGE__?: TestSlateRange;
      };

      return testWindow;
    };
    const pointAtTextOffset = (
      leaves: Array<{ path: number[]; text: string; start: number; end: number }>,
      offset: number
    ): TestSlatePoint => {
      const leaf = leaves.find(({ start, end }) => offset >= start && offset <= end) ?? leaves[leaves.length - 1];

      return {
        path: leaf.path,
        offset: Math.max(0, Math.min(offset - leaf.start, leaf.text.length)),
      };
    };
    const testWindow = getTestWindow();
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];

    if (!editor?.select) {
      throw new Error('No test editor with select() found');
    }

    const leaves: Array<{ path: number[]; text: string; start: number; end: number }> = [];
    let cursor = 0;

    const walk = (node: TestSlateNode, path: number[]) => {
      if (typeof node.text === 'string') {
        const start = cursor;

        cursor += node.text.length;
        leaves.push({ path, text: node.text, start, end: cursor });
        return;
      }

      node.children?.forEach((child, index) => walk(child, [...path, index]));
    };

    editor.children.forEach((child, index) => walk(child, [index]));

    const fullText = leaves.map((leaf) => leaf.text).join('');
    const trimmedLength = fullText.trimEnd().length;
    const lastWord = fullText.slice(0, trimmedLength).match(/\S+$/)?.[0] ?? '';

    if (!lastWord) return '';

    const startIndex = trimmedLength - lastWord.length;
    const endIndex = trimmedLength;
    const selectedRange = {
      anchor: pointAtTextOffset(leaves, startIndex),
      focus: pointAtTextOffset(leaves, endIndex),
    };

    editor.select(selectedRange);
    testWindow.__TEST_SELECTED_RANGE__ = selectedRange;

    (document.querySelector('[data-slate-editor="true"]') as HTMLElement | null)?.focus();
    document.dispatchEvent(new Event('selectionchange'));

    return lastWord;
  });
}

async function pasteContent(page: Page, html: string, plainText: string) {
  await page.evaluate(
    ({ html, plainText }) => {
      const getTestEditor = () => {
        const testWindow = window as Window & {
          __TEST_EDITOR__?: TestSlateEditor;
          __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
        };

        return testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];
      };
      const editor = getTestEditor();

      if (!editor?.insertData) {
        throw new Error('No test editor with insertData() found');
      }

      const dataTransfer = new DataTransfer();

      if (html) dataTransfer.setData('text/html', html);
      dataTransfer.setData('text/plain', plainText);
      editor.insertData(dataTransfer);
    },
    { html, plainText }
  );

  await page.waitForTimeout(1000);
}

async function getTopLevelBlockCount(page: Page) {
  return page.evaluate(() => {
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestSlateEditor;
      __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
    };
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];

    return editor?.children.length ?? 0;
  });
}

async function getEditorBlock(page: Page, blockIndex: number): Promise<TestSlateNode | null> {
  return page.evaluate((blockIndex) => {
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestSlateEditor;
      __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
    };
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];

    return editor?.children[blockIndex] ?? null;
  }, blockIndex);
}

async function getFirstBlockDataValue(page: Page, blockType: string, key: string) {
  return page.evaluate(
    ({ blockType, key }) => {
      const testWindow = window as Window & {
        __TEST_EDITOR__?: TestSlateEditor;
        __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
      };
      const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];
      const block = editor?.children.find((child) => child.type === blockType);

      return block?.data?.[key] ?? null;
    },
    { blockType, key }
  );
}

async function findLinkHref(page: Page, text: string) {
  return page.evaluate((text) => {
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestSlateEditor;
      __TEST_EDITORS__?: Record<string, TestSlateEditor | undefined>;
    };
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];

    const find = (node: TestSlateNode): string | null => {
      if (typeof node.text === 'string' && node.text.includes(text) && typeof node.href === 'string') {
        return node.href;
      }

      for (const child of node.children ?? []) {
        const href = find(child);

        if (href) return href;
      }

      return null;
    };

    for (const child of editor?.children ?? []) {
      const href = find(child);

      if (href) return href;
    }

    return null;
  }, text);
}

function nodeText(node: TestSlateNode): string {
  if (typeof node.text === 'string') return node.text;

  return (node.children ?? []).map(nodeText).join('');
}

function htmlToPlainText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatShortcut(format: string) {
  switch (format) {
    case 'bold':
      return `${modKey}+b`;
    case 'italic':
      return `${modKey}+i`;
    case 'underline':
      return `${modKey}+u`;
    case 'strikethrough':
      return `${modKey}+Shift+x`;
    case 'code':
      return `${modKey}+e`;
    default:
      throw new Error(`Unsupported formatting shortcut: ${format}`);
  }
}

function alignmentShortcut(alignment: string) {
  switch (alignment) {
    case 'left':
      return 'Control+Shift+L';
    case 'center':
      return 'Control+Shift+E';
    case 'right':
      return 'Control+Shift+R';
    default:
      throw new Error(`Unsupported alignment shortcut: ${alignment}`);
  }
}

function formattingLocator(page: Page, format: string) {
  switch (format) {
    case 'bold':
      return page.locator('strong');
    case 'italic':
      return page.locator('em');
    case 'underline':
      return page.locator('u');
    case 'strikethrough':
      return page.locator('s, del, strike, [style*="text-decoration: line-through"]');
    case 'code':
      return page.locator('span.bg-border-primary');
    default:
      throw new Error(`Unsupported formatting assertion: ${format}`);
  }
}

function slashCommandSearch(command: string) {
  const searchTerms: Record<string, string> = {
    heading1: 'heading',
    heading2: 'heading',
    heading3: 'heading',
    bulletedList: 'bullet',
    numberedList: 'number',
    todoList: 'todo',
    divider: 'divider',
    quote: 'quote',
    simpleTable: 'table',
    table: 'table',
    code: 'code',
  };

  return searchTerms[command] ?? command;
}
