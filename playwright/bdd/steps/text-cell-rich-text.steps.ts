import { expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { addFieldWithType, changeFieldTypeById, clickFieldHeaderById } from '../../support/field-type-helpers';
import {
  addFilterByFieldName,
  assertRowCount,
  getPrimaryFieldId,
  loginAndCreateGrid,
} from '../../support/filter-test-helpers';
import { getCurrentDatabaseInfo, getFieldTypeDirect } from '../../support/relation-test-helpers';
import { duplicateRowFromDetail, openRowDetail } from '../../support/row-detail-helpers';
import { DatabaseFilterSelectors, DatabaseGridSelectors, FieldType, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then } = createBdd();

interface RichTextCellState {
  fieldId: string;
  fieldName: string;
  primaryFieldId: string;
  rowIds: string[];
}

interface StoredInsert {
  insert: string;
  attributes?: Record<string, unknown>;
}

interface StoredCell {
  data: string;
  richText: { text: string; delta: StoredInsert[] } | null;
}

/** The row's data is not loaded (yet): e.g. right after a reload. */
const UNAVAILABLE = 'cell unavailable';

const stateByPage = new WeakMap<Page, RichTextCellState>();
const chosenPersonByPage = new WeakMap<Page, string>();

/** Mark name in the feature → delta attribute and how the display renders it. */
const MARKS: Record<string, { attribute: string; selector: string }> = {
  bold: { attribute: 'bold', selector: 'strong' },
  italic: { attribute: 'italic', selector: 'em' },
  underline: { attribute: 'underline', selector: 'u' },
  strikethrough: { attribute: 'strikethrough', selector: 's' },
  code: { attribute: 'code', selector: 'span.bg-border-primary' },
  highlight: { attribute: 'bg_color', selector: '.bg-color' },
  link: { attribute: 'href', selector: '.href-link' },
  equation: { attribute: 'formula', selector: '.formula-inline' },
  'text-color': { attribute: 'font_color', selector: '.text-color' },
  'background-color': { attribute: 'bg_color', selector: '.bg-color' },
};

const TOOLBAR_BUTTONS: Record<string, string> = {
  bold: 'toolbar-bold-button',
  italic: 'toolbar-italic-button',
  underline: 'toolbar-underline-button',
  strikethrough: 'toolbar-strikethrough-button',
  code: 'toolbar-code-button',
  link: 'link-button',
  equation: 'toolbar-formula-button',
};

const COLOR_MENU_BUTTONS: Record<string, string> = {
  'text color': 'text-color-button',
  'background color': 'bg-color-button',
};

const LAYOUT_SURFACES: Record<string, string> = {
  List: '[data-testid="database-list"]',
  Board: '.database-board',
  Gallery: '[data-testid="database-gallery"]',
};

function getState(page: Page): RichTextCellState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Rich text cell grid is not set up');
  return state;
}

function getMark(name: string) {
  const mark = MARKS[name];

  if (!mark) throw new Error(`Unknown mark "${name}"`);
  return mark;
}

/** Gherkin strings spell line breaks as `\n`. */
function unescape(text: string) {
  return text.replace(/\\n/g, '\n');
}

function rowId(page: Page, row: number) {
  const id = getState(page).rowIds[row - 1];

  if (!id) throw new Error(`No row ${row}`);
  return id;
}

function gridCell(page: Page, row: number) {
  return DatabaseGridSelectors.cellByIds(page, rowId(page, row), getState(page).fieldId);
}

function activeEditor(page: Page) {
  return page.getByTestId('rich-text-cell-editor');
}

/**
 * The stored cell, or null while its row cannot be read (no database context
 * yet, or the row not loaded), so a check never passes on a cell it did not
 * see. A row without the cell reads as an empty cell.
 */
async function readStoredCell(page: Page, targetRowId: string, fieldId: string): Promise<StoredCell | null> {
  return page.evaluate(
    async ({ targetRowId, fieldId }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      let rowDoc = ctx?.rowMap?.[targetRowId];

      if (!rowDoc && ctx?.ensureRow) rowDoc = await ctx.ensureRow(targetRowId);

      const cells = rowDoc?.getMap('data')?.get('data')?.get('cells');

      if (!cells) return null;

      const cell = cells.get(fieldId);
      const data = cell?.get('data');
      const raw = cell?.get('rich_text');

      return {
        data: data === undefined || data === null ? '' : String(data),
        richText: typeof raw === 'string' && raw ? JSON.parse(raw) : null,
      };
    },
    { targetRowId, fieldId }
  );
}

async function storedCell(page: Page, row: number) {
  return readStoredCell(page, rowId(page, row), getState(page).fieldId);
}

/** Polls until the cell is readable, then returns it. */
async function readableStoredCell(page: Page, row: number): Promise<StoredCell> {
  let cell: StoredCell | null = null;

  await expect
    .poll(
      async () => {
        cell = await storedCell(page, row);
        return cell ? 'readable' : UNAVAILABLE;
      },
      { timeout: 15000 }
    )
    .toBe('readable');
  return cell as unknown as StoredCell;
}

/** The inserts of the stored delta that cover `text` (one insert may hold more). */
function insertsCovering(cell: StoredCell, text: string) {
  const delta = cell.richText?.delta ?? [];
  const full = delta.map((insert) => insert.insert).join('');
  const start = full.indexOf(text);

  if (start < 0) return null;

  const end = start + text.length;
  const covering: StoredInsert[] = [];
  let offset = 0;

  delta.forEach((insert) => {
    const insertStart = offset;
    const insertEnd = offset + insert.insert.length;

    offset = insertEnd;
    if (insertEnd > start && insertStart < end) covering.push(insert);
  });

  return covering;
}

/** The first stored mention of a type (a cell can hold several kinds). */
function storedMention(cell: StoredCell | null, type: string) {
  return cell?.richText?.delta
    .map((insert) => insert.attributes?.mention as { type?: string } | undefined)
    .find((mention) => mention?.type === type);
}

/** Selects `text` inside the active editor through the DOM, as a drag would. */
async function selectInEditor(editor: Locator, text: string) {
  await editor.evaluate((root, target) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let full = '';

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;

      if (node.parentElement?.closest('[data-slate-zero-width],[contenteditable="false"]')) continue;
      nodes.push(node);
      full += node.data;
    }

    const start = full.indexOf(target);

    if (start < 0) throw new Error(`"${target}" is not in the editor: "${full}"`);

    const end = start + target.length;
    const range = document.createRange();
    let offset = 0;

    for (const node of nodes) {
      const nodeEnd = offset + node.data.length;

      if (start >= offset && start <= nodeEnd) range.setStart(node, start - offset);
      if (end >= offset && end <= nodeEnd) {
        range.setEnd(node, end - offset);
        break;
      }

      offset = nodeEnd;
    }

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }, text);
  // Slate takes the DOM selection up on a throttled `selectionchange`; the
  // shortcuts and pastes that follow act on the selection Slate holds.
  await expect
    .poll(
      () =>
        editor.evaluate(
          (element) =>
            (element as HTMLElement & { __richTextCellSelection?: () => string }).__richTextCellSelection?.() ?? null
        ),
      { timeout: 10000 }
    )
    .toBe(text);
}

async function pasteInto(editor: Locator, payload: Record<string, string>) {
  await editor.evaluate((element, data) => {
    const transfer = new DataTransfer();

    Object.entries(data).forEach(([type, value]) => transfer.setData(type, value));

    // Chrome delivers a rich paste to Slate as `beforeinput`/insertFromPaste;
    // only a plain-text-only paste goes through the `paste` event.
    if (Object.keys(data).some((type) => type !== 'text/plain')) {
      element.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertFromPaste',
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        })
      );
      return;
    }

    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, payload);
  await editor.page().waitForTimeout(300);
}

async function expectDisplayedMark(container: Locator, text: string, markName: string) {
  const { selector } = getMark(markName);

  if (markName === 'equation') {
    // KaTeX keeps the LaTeX it rendered in an annotation.
    const equation = container
      .locator(selector)
      .filter({ has: container.page().locator('annotation[encoding="application/x-tex"]', { hasText: text }) });

    await expect(equation.locator('.katex').first()).toBeVisible({ timeout: 15000 });
    return;
  }

  await expect(container.locator(selector).filter({ hasText: text }).first()).toBeVisible({ timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

Given('a grid with a rich text property is open', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await loginAndCreateGrid(page, request, generateRandomEmail());

  const primaryFieldId = await getPrimaryFieldId(page);
  const fieldId = await addFieldWithType(page, FieldType.RichText);
  const fieldName = (await page.getByTestId(`grid-field-header-${fieldId}`).first().innerText()).trim();
  const { rowIds } = await getCurrentDatabaseInfo(page);

  stateByPage.set(page, { fieldId, fieldName, primaryFieldId, rowIds });
});

When('I reload the rich text grid', async ({ page }) => {
  await page.reload();
  await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
  await expect(gridCell(page, 1)).toBeVisible({ timeout: 30000 });
});

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

When('I start editing the rich text cell in row {int}', async ({ page }, row: number) => {
  // Close anything a previous step left open.
  await page.keyboard.press('Escape');
  const cell = gridCell(page, row);

  await cell.scrollIntoViewIfNeeded();
  await cell.evaluate((element) => (element as HTMLElement).click());
  await expect(cell.getByTestId('rich-text-cell-editor')).toBeVisible({ timeout: 10000 });
  await expect(cell.getByTestId('rich-text-cell-editor')).toBeFocused();
});

When('I type {string} in the rich text cell', async ({ page }, text: string) => {
  await activeEditor(page).pressSequentially(text, { delay: 30 });
});

When('I select {string} in the rich text cell', async ({ page }, text: string) => {
  await selectInEditor(activeEditor(page), text);
});

When('I press {string} in the rich text cell', async ({ page }, keys: string) => {
  await page.keyboard.press(keys);
  await page.waitForTimeout(200);
});

When('I press Enter in the rich text cell', async ({ page }) => {
  await page.keyboard.press('Enter');
  await expect(activeEditor(page)).toHaveCount(0, { timeout: 10000 });
});

When('I click outside the rich text cell', async ({ page }) => {
  // The empty grid background below the rows: outside every cell and popover.
  const grid = DatabaseGridSelectors.grid(page);
  const position = await grid.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.bottom - 24;

    if (document.elementFromPoint(x, y) !== element) {
      throw new Error('Expected an empty grid background below the rows');
    }

    return { x, y };
  });

  await page.mouse.click(position.x, position.y);
});

When('I paste {string} into the rich text cell', async ({ page }, text: string) => {
  await pasteInto(activeEditor(page), { 'text/plain': unescape(text) });
});

When(
  'I paste a document fragment with a bold heading {string} and a paragraph {string} into the rich text cell',
  async ({ page }, heading: string, paragraph: string) => {
    // The shape the document editor copies: blocks wrapping text elements.
    const fragment = [
      {
        type: 'heading',
        blockId: 'b1',
        data: { level: 1 },
        children: [{ type: 'text', textId: 'b1', children: [{ text: heading, bold: true }] }],
      },
      {
        type: 'paragraph',
        blockId: 'b2',
        data: {},
        children: [{ type: 'text', textId: 'b2', children: [{ text: paragraph }] }],
      },
    ];
    const encoded = await page.evaluate((json) => window.btoa(encodeURIComponent(json)), JSON.stringify(fragment));

    await pasteInto(activeEditor(page), {
      'application/x-slate-fragment': encoded,
      'text/plain': `${heading}\n${paragraph}`,
    });
  }
);

When('I click the rich text toolbar {string} button', async ({ page }, name: string) => {
  const testId = TOOLBAR_BUTTONS[name];

  if (!testId) throw new Error(`Unknown toolbar button "${name}"`);
  await page.getByTestId('rich-text-cell-toolbar').getByTestId(testId).click();
  await page.waitForTimeout(200);
});

When('I enter the link {string} in the link popover', async ({ page }, url: string) => {
  const input = page.locator('.MuiPopover-root input').first();

  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(url);
  await input.press('Enter');
  await expect(input).toHaveCount(0, { timeout: 10000 });
  // The popover hands focus back to the cell editor.
  await expect(activeEditor(page)).toBeFocused({ timeout: 10000 });
});

When('I choose the {string} date in the mention panel', async ({ page }, label: string) => {
  const option = page
    .getByTestId('mention-panel')
    .locator('[data-option-kind="date"]')
    .filter({ hasText: label })
    .first();

  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
  await expect(page.getByTestId('mention-panel')).toBeHidden({ timeout: 10000 });
});

When('I choose the page {string} in the mention panel', async ({ page }, name: string) => {
  const option = page
    .getByTestId('mention-panel')
    .locator('[data-option-kind="page"]')
    .filter({ hasText: name })
    .first();

  await expect(option).toBeVisible({ timeout: 20000 });
  await option.click();
  await expect(page.getByTestId('mention-panel')).toBeHidden({ timeout: 10000 });
});

When('I add a rich text property filter that contains {string}', async ({ page }, text: string) => {
  await addFilterByFieldName(page, getState(page).fieldName);
  const input = DatabaseFilterSelectors.filterInput(page);

  await input.fill(text);
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
});

When(
  'another client sets the rich text cell in row {int} to plain text {string}',
  async ({ page }, row: number, text: string) => {
    // Desktop and the server write only `data`; they keep but never update
    // the formatting beside it.
    await page.evaluate(
      async ({ targetRowId, fieldId, text }) => {
        const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
        const rowDoc = ctx?.rowMap?.[targetRowId] ?? (await ctx?.ensureRow?.(targetRowId));
        const cell = rowDoc?.getMap('data')?.get('data')?.get('cells')?.get(fieldId);

        if (!cell) throw new Error('cell missing');
        rowDoc.transact(() => {
          cell.set('data', text);
        }, 'remote-client');
      },
      { targetRowId: rowId(page, row), fieldId: getState(page).fieldId, text }
    );
  }
);

When('I open the row detail for row {int}', async ({ page }, row: number) => {
  await openRowDetail(page, row - 1);
});

When('I edit the row detail rich text property and append {string}', async ({ page }, text: string) => {
  const modal = RowDetailSelectors.modal(page);

  await modal.getByTestId('rich-text-cell-content').click();
  const editor = modal.getByTestId('rich-text-cell-editor');

  await expect(editor).toBeFocused({ timeout: 10000 });
  await page.keyboard.press('End');
  await editor.pressSequentially(text, { delay: 30 });
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0, { timeout: 10000 });
});

Given('I edit the Name property', async ({ page }) => {
  const state = getState(page);

  // Every rich text step now targets the primary (title) field.
  state.fieldId = state.primaryFieldId;
});

// ---------------------------------------------------------------------------
// Assertions: editor state
// ---------------------------------------------------------------------------

Then('the rich text cell in row {int} is being edited', async ({ page }, row: number) => {
  await expect(gridCell(page, row).getByTestId('rich-text-cell-editor')).toBeVisible();
});

Then('the rich text cell in row {int} is not being edited', async ({ page }, row: number) => {
  await expect(gridCell(page, row).getByTestId('rich-text-cell-editor')).toHaveCount(0, { timeout: 10000 });
});

Then('the rich text editor shows {string} as {word}', async ({ page }, text: string, markName: string) => {
  await expectDisplayedMark(activeEditor(page), text, markName);
});

Then('the rich text toolbar is visible', async ({ page }) => {
  await expect(page.getByTestId('rich-text-cell-toolbar')).toHaveCSS('opacity', '1', { timeout: 10000 });
  await expect(page.getByTestId('rich-text-cell-toolbar').getByTestId('toolbar-bold-button')).toBeVisible();
});

Then('the rich text toolbar does not offer block formatting', async ({ page }) => {
  const toolbar = page.getByTestId('rich-text-cell-toolbar');

  // Exactly the inline actions: underline, bold, italic, strikethrough, code,
  // equation, link, text color and background color. Any heading, list,
  // quote, alignment or AI button would change the count.
  await expect(toolbar.locator('button')).toHaveCount(9);
  for (const testId of [
    'toolbar-bold-button',
    'toolbar-italic-button',
    'toolbar-underline-button',
    'toolbar-strikethrough-button',
    'toolbar-code-button',
    'toolbar-formula-button',
    'link-button',
    'text-color-button',
    'bg-color-button',
  ]) {
    await expect(toolbar.getByTestId(testId)).toHaveCount(1);
  }
});

Then('the mention panel is shown for the rich text cell', async ({ page }) => {
  const panel = page.getByTestId('mention-panel');

  await expect(panel).toBeVisible({ timeout: 15000 });
  // Results load asynchronously; keyboard selection needs them in place.
  await expect(panel.locator('[data-option-index]').first()).toBeVisible({ timeout: 15000 });
});

Then('the slash menu is not shown', async ({ page }) => {
  // The cell mounts no slash panel; this checks that "/" opened no other
  // panel either. (Escape, which only closes an open panel, then leaves the
  // cell: see the scenario.)
  await page.waitForTimeout(500);
  await expect(page.getByTestId('mention-panel')).toHaveCount(0);
  await expect(activeEditor(page)).toHaveText('/todo');
});

// ---------------------------------------------------------------------------
// Assertions: stored value
// ---------------------------------------------------------------------------

Then('the stored rich text cell in row {int} has plain text {string}', async ({ page }, row: number, text: string) => {
  await expect
    .poll(async () => (await storedCell(page, row))?.data ?? UNAVAILABLE, { timeout: 15000 })
    .toBe(unescape(text));
});

Then(
  'the stored rich text cell in row {int} marks {string} as {word}',
  async ({ page }, row: number, text: string, markName: string) => {
    const { attribute } = getMark(markName);

    await expect
      .poll(
        async () => {
          const cell = await storedCell(page, row);

          if (!cell) return UNAVAILABLE;
          // Formatting describes the stored plain text.
          if (!cell.richText || cell.richText.text !== cell.data) return 'no current formatting';
          if (markName === 'equation') {
            return cell.richText.delta.some((insert) => insert.attributes?.formula === text) ? 'marked' : 'unmarked';
          }

          const covering = insertsCovering(cell, text);

          if (!covering) return `"${text}" missing`;
          return covering.every((insert) => Boolean(insert.attributes?.[attribute])) ? 'marked' : 'unmarked';
        },
        { timeout: 15000 }
      )
      .toBe('marked');
  }
);

Then(
  'the stored rich text cell in row {int} does not mark {string} as {word}',
  async ({ page }, row: number, text: string, markName: string) => {
    const { attribute } = getMark(markName);
    const cell = await readableStoredCell(page, row);
    const covering = insertsCovering(cell, text) ?? [];

    // An equation replaces its text with one placeholder, so the plain part
    // is found in the delta as-is.
    expect(covering.length).toBeGreaterThan(0);
    expect(covering.some((insert) => Boolean(insert.attributes?.[attribute]))).toBe(false);
  }
);

Then(
  'the stored rich text cell in row {int} links {string} to {string}',
  async ({ page }, row: number, text: string, url: string) => {
    await expect
      .poll(
        async () => {
          const cell = await storedCell(page, row);
          const covering = cell ? insertsCovering(cell, text) : null;

          return covering?.map((insert) => insert.attributes?.href ?? null) ?? null;
        },
        { timeout: 15000 }
      )
      .toEqual([expect.stringContaining(url.replace(/\/$/, ''))]);
  }
);

Then('the stored rich text cell in row {int} has no formatting', async ({ page }, row: number) => {
  const cell = await readableStoredCell(page, row);

  expect(cell.richText).toBeNull();
});

Then(
  'the stored rich text cell in row {int} still holds the formatting saved for {string}',
  async ({ page }, row: number, text: string) => {
    // Hidden because it no longer describes `data`, not deleted: that is the
    // rule every client reads stored formatting by.
    const cell = await readableStoredCell(page, row);

    expect(cell.data).not.toBe(text);
    expect(cell.richText?.text).toBe(text);
  }
);

Then('the stored rich text cell in row {int} has a date mention for today', async ({ page }, row: number) => {
  await expect
    .poll(
      async () => {
        const cell = await storedCell(page, row);
        const mention = storedMention(cell, 'date') as { type: string; date?: string } | undefined;

        if (!mention || mention.type !== 'date' || !mention.date) return null;
        return new Date(mention.date).toDateString();
      },
      { timeout: 15000 }
    )
    .toBe(new Date().toDateString());
});

Then('the stored rich text cell in row {int} has a page mention', async ({ page }, row: number) => {
  await expect
    .poll(
      async () => {
        const cell = await storedCell(page, row);
        const mention = storedMention(cell, 'page') as { type: string; page_id?: string } | undefined;

        return mention?.type === 'page' && Boolean(mention.page_id);
      },
      { timeout: 15000 }
    )
    .toBe(true);
});



// ---------------------------------------------------------------------------
// Assertions: rendering
// ---------------------------------------------------------------------------

Then(
  'the rich text cell in row {int} displays {string} as {word}',
  async ({ page }, row: number, text: string, markName: string) => {
    const content = gridCell(page, row).getByTestId('rich-text-cell-content');

    await expect(content).toBeVisible({ timeout: 15000 });
    await expectDisplayedMark(content, text, markName);
  }
);

Then('the rich text cell in row {int} displays a date mention', async ({ page }, row: number) => {
  const content = gridCell(page, row).getByTestId('rich-text-cell-content');

  await expect(content.locator('.mention').first()).toBeVisible({ timeout: 15000 });
  await expect(content).toContainText('@');
});

Then('the rich text cell in row {int} displays a page mention {string}', async ({ page }, row: number, name: string) => {
  const content = gridCell(page, row).getByTestId('rich-text-cell-content');

  await expect(content.locator('.mention-inline').filter({ hasText: name }).first()).toBeVisible({ timeout: 15000 });
});

Then('the rich text cell in row {int} shows plain text {string}', async ({ page }, row: number, text: string) => {
  await expect(gridCell(page, row).locator('.text-cell')).toHaveText(text, { timeout: 15000 });
});

Then('the rich text cell in row {int} displays no formatting', async ({ page }, row: number) => {
  await expect(gridCell(page, row).getByTestId('rich-text-cell-content')).toHaveCount(0);
});

Then(
  'clicking {string} in the rich text cell in row {int} opens {string}',
  async ({ page }, text: string, row: number, url: string) => {
    const link = gridCell(page, row).getByTestId('rich-text-cell-content').locator('.href-link').filter({ hasText: text });

    await expect(link).toBeVisible({ timeout: 15000 });
    const popupPromise = page.context().waitForEvent('page', { timeout: 15000 });

    await link.click();
    const popup = await popupPromise;

    expect(popup.url()).toContain(new URL(url).host);
    await popup.close();
  }
);

Then('the grid shows {int} row(s)', async ({ page }, count: number) => {
  await assertRowCount(page, count);
});

Then(
  'the row detail rich text property displays {string} as {word}',
  async ({ page }, text: string, markName: string) => {
    await expectDisplayedMark(RowDetailSelectors.modal(page).getByTestId('rich-text-cell-content'), text, markName);
  }
);

// ---------------------------------------------------------------------------
// Colors, history, clipboard, layout
// ---------------------------------------------------------------------------

When(
  'I pick color number {int} from the rich text toolbar {string} menu',
  async ({ page }, index: number, menu: string) => {
    const testId = COLOR_MENU_BUTTONS[menu];

    if (!testId) throw new Error(`Unknown color menu "${menu}"`);
    const button = page.getByTestId('rich-text-cell-toolbar').getByTestId(testId);

    await button.click();
    const tiles = page.locator('[data-radix-popper-content-wrapper]').last().locator('div.h-7.w-7');

    await expect(tiles.nth(index - 1)).toBeVisible({ timeout: 10000 });
    await tiles.nth(index - 1).click();
    // Close the menu; the toolbar hands focus back to the cell editor.
    await button.click();
    await expect(activeEditor(page)).toBeFocused({ timeout: 10000 });
  }
);

When('I press the database undo shortcut outside the cell', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+z');
});

When('I press the database redo shortcut outside the cell', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+Shift+z');
});

When('I turn wrapping {word} for the rich text property', async ({ page }, state: string) => {
  const { fieldId } = getState(page);

  await clickFieldHeaderById(page, fieldId);
  const toggle = page.getByTestId('grid-field-wrap').first();
  const checked = (await toggle.getAttribute('data-state')) === 'checked';

  if (checked !== (state === 'on')) await toggle.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

function fieldTypeNamed(typeName: string) {
  const fieldType = FieldType[typeName as keyof typeof FieldType];

  if (fieldType === undefined) throw new Error(`Unknown field type "${typeName}"`);
  return fieldType as FieldType;
}

When('I change the rich text property to a {string} property', async ({ page }, typeName: string) => {
  await changeFieldTypeById(page, getState(page).fieldId, fieldTypeNamed(typeName));
});

Then('the rich text property is a {string} property', async ({ page }, typeName: string) => {
  await expect
    .poll(() => getFieldTypeDirect(page, getState(page).fieldId), { timeout: 15000 })
    .toBe(fieldTypeNamed(typeName));
});

When('I switch the rich text database to the {string} layout', async ({ page }, layout: string) => {
  await page.getByTestId('database-actions-settings').click();
  const layoutTrigger = page.getByRole('menuitem', { name: /^Layout$/i });

  await expect(layoutTrigger).toBeVisible();
  await layoutTrigger.hover();
  const layoutMenu = page.locator('[data-slot="dropdown-menu-sub-content"]:visible').last();

  await layoutMenu.getByRole('menuitem', { name: new RegExp(`^${layout}$`, 'i') }).click();
  await expect(page.locator(LAYOUT_SURFACES[layout]).first()).toBeVisible({ timeout: 30000 });
  await page.keyboard.press('Escape');
});

When('I duplicate row {int} from its row detail', async ({ page }, row: number) => {
  await openRowDetail(page, row - 1);
  await duplicateRowFromDetail(page);
  await page.keyboard.press('Escape');
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0, { timeout: 10000 });
});

Then('the mention panel is hidden', async ({ page }) => {
  await expect(page.getByTestId('mention-panel')).toBeHidden({ timeout: 10000 });
});

Then(
  'the stored rich text cell in row {int} has a date mention for tomorrow',
  async ({ page }, row: number) => {
    const tomorrow = new Date();

    tomorrow.setDate(tomorrow.getDate() + 1);
    await expect
      .poll(
        async () => {
          const cell = await storedCell(page, row);
          const mention = storedMention(cell, 'date') as { type: string; date?: string } | undefined;

          return mention?.type === 'date' && mention.date ? new Date(mention.date).toDateString() : null;
        },
        { timeout: 15000 }
      )
      .toBe(tomorrow.toDateString());
  }
);

Then('the rich text cell in row {int} shows its lines wrapped', async ({ page }, row: number) => {
  const line = gridCell(page, row).getByTestId('rich-text-cell-content').locator('[data-rich-text-cell-line]');

  await expect(line).toHaveCSS('white-space', 'pre-wrap', { timeout: 10000 });
  const box = await line.boundingBox();

  // Two lines of text are taller than one.
  expect(box?.height ?? 0).toBeGreaterThan(30);
});

Then('the rich text cell in row {int} shows its lines on one line', async ({ page }, row: number) => {
  const line = gridCell(page, row).getByTestId('rich-text-cell-content').locator('[data-rich-text-cell-line]');

  await expect(line).toHaveCSS('white-space', 'nowrap', { timeout: 10000 });
  const box = await line.boundingBox();

  expect(box?.height ?? 0).toBeLessThan(30);
});

Then('the list row {int} displays {string} as {word}', async ({ page }, row: number, text: string, markName: string) => {
  const field = page.getByTestId(`list-field-${getState(page).fieldId}-${rowId(page, row)}`);

  await expectDisplayedMark(field.getByTestId('rich-text-cell-content'), text, markName);
});

Then(
  'the duplicated row has plain text {string} marking {string} as {word}',
  async ({ page }, text: string, marked: string, markName: string) => {
    const state = getState(page);
    let duplicateId: string | undefined;

    await expect
      .poll(
        async () => {
          const { rowIds } = await getCurrentDatabaseInfo(page);

          duplicateId = rowIds.find((id) => !state.rowIds.includes(id));
          return duplicateId ?? null;
        },
        { timeout: 20000 }
      )
      .not.toBeNull();

    const { attribute } = getMark(markName);

    await expect
      .poll(
        async () => {
          const cell = await readStoredCell(page, duplicateId!, state.fieldId);
          const covering = cell ? insertsCovering(cell, marked) : null;

          return {
            data: cell?.data ?? UNAVAILABLE,
            marked: Boolean(covering?.length && covering.every((insert) => insert.attributes?.[attribute])),
          };
        },
        { timeout: 20000 }
      )
      .toEqual({ data: text, marked: true });
  }
);

When('I choose the first person in the mention panel', async ({ page }) => {
  const option = page.getByTestId('mention-panel').locator('[data-option-kind="person"]').first();

  await expect(option).toBeVisible({ timeout: 20000 });
  chosenPersonByPage.set(page, (await option.locator('span.truncate').first().innerText()).trim());
  await option.click();
  await expect(page.getByTestId('mention-panel')).toBeHidden({ timeout: 10000 });
});

Then('the stored rich text cell in row {int} has a person mention', async ({ page }, row: number) => {
  await expect
    .poll(
      async () => {
        const cell = await storedCell(page, row);
        const mention = storedMention(cell, 'person') as { type: string; person_id?: string } | undefined;

        return mention?.type === 'person' && Boolean(mention.person_id);
      },
      { timeout: 15000 }
    )
    .toBe(true);
});

/** Expects two boxes side by side on one line, as a laid-out chip draws its parts. */
function expectOnOneLine(first: { x: number; y: number; height: number } | null, second: typeof first) {
  expect(first, 'first part is shown').toBeTruthy();
  expect(second, 'second part is shown').toBeTruthy();
  expect(Math.abs(first!.y + first!.height / 2 - (second!.y + second!.height / 2))).toBeLessThan(6);
  expect(first!.x).toBeLessThan(second!.x);
}

// Chips are laid out by the leaf stylesheet, which must load with the cell
// even when no document editor (and its stylesheet) has loaded.
Then(
  'the rich text cell in row {int} shows its page mention {string} on one line',
  async ({ page }, row: number, name: string) => {
    const chip = gridCell(page, row)
      .getByTestId('rich-text-cell-content')
      .locator('.mention-inline')
      .filter({ hasText: name })
      .first();

    await expect(chip).toBeVisible({ timeout: 15000 });
    await expect(chip).toHaveCSS('display', 'inline-flex');
    expectOnOneLine(
      await chip.locator('.mention-icon').first().boundingBox(),
      await chip.locator('.mention-content').first().boundingBox()
    );
    expect((await chip.boundingBox())?.height ?? 0).toBeLessThan(30);
  }
);

Then('the rich text cell in row {int} shows its date mention on one line', async ({ page }, row: number) => {
  const chip = gridCell(page, row)
    .getByTestId('rich-text-cell-content')
    .locator('.mention-inline')
    .filter({ hasText: '@' })
    .first();

  await expect(chip).toBeVisible({ timeout: 15000 });
  await expect(chip).toHaveCSS('display', 'inline-flex');
  expectOnOneLine(
    await chip.locator('.mention-content').first().boundingBox(),
    await chip.locator('svg').last().boundingBox()
  );
  expect((await chip.boundingBox())?.height ?? 0).toBeLessThan(30);
});

Then('row {int} of the rich text grid keeps its default height', async ({ page }, row: number) => {
  const gridRow = DatabaseGridSelectors.rowById(page, rowId(page, row));

  await expect(gridRow).toBeVisible({ timeout: 15000 });
  // One line of text: chips that lost their layout stack and double it.
  expect((await gridRow.boundingBox())?.height ?? 0).toBeLessThan(50);
});

Then('the rich text cell in row {int} displays a person mention', async ({ page }, row: number) => {
  const content = gridCell(page, row).getByTestId('rich-text-cell-content');

  await expect(content.locator('.mention-person').first()).toBeVisible({ timeout: 15000 });
});

When(
  'I click the page mention {string} in the rich text cell in row {int}',
  async ({ page }, name: string, row: number) => {
    await gridCell(page, row)
      .getByTestId('rich-text-cell-content')
      .locator('.mention-inline')
      .filter({ hasText: name })
      .first()
      .click();
  }
);

Then('the page {string} is open', async ({ page }, name: string) => {
  await expect(page.getByTestId('page-title-input').filter({ hasText: name }).first()).toBeVisible({
    timeout: 20000,
  });
});

// ---------------------------------------------------------------------------
// Row page title
// ---------------------------------------------------------------------------

function rowTitle(page: Page) {
  return RowDetailSelectors.modal(page).getByTestId('row-title-input');
}

When('I type {string} at the end of the row title', async ({ page }, text: string) => {
  const title = rowTitle(page);

  await expect(title).toBeVisible({ timeout: 15000 });
  await title.click();
  await page.keyboard.press('ControlOrMeta+ArrowRight');
  await page.keyboard.press('End');
  await title.pressSequentially(text, { delay: 30 });
});

When('I select {string} in the row title', async ({ page }, text: string) => {
  await selectInEditor(rowTitle(page), text);
});

Then('the row title shows {string} as {word}', async ({ page }, text: string, markName: string) => {
  await expectDisplayedMark(rowTitle(page), text, markName);
});

Then('the row title is not focused', async ({ page }) => {
  await expect(rowTitle(page)).not.toBeFocused({ timeout: 10000 });
});

Then('the row title reads {string}', async ({ page }, text: string) => {
  await expect(rowTitle(page)).toHaveText(text, { timeout: 10000 });
});

Then('the mention panel is not shown', async ({ page }) => {
  await page.waitForTimeout(500);
  await expect(page.getByTestId('mention-panel')).toHaveCount(0);
});

Then(
  'the stored rich text cell in row {int} has plain text ending with {string}',
  async ({ page }, row: number, suffix: string) => {
    await expect.poll(async () => (await storedCell(page, row))?.data ?? UNAVAILABLE, { timeout: 15000 }).toMatch(
      new RegExp(`${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    );
  }
);


Then(
  'the stored rich text cell in row {int} has plain text {string} followed by today\'s date',
  async ({ page }, row: number, prefix: string) => {
    // The browser's own calendar date, formatted as the editor writes it.
    const today = await page.evaluate(() =>
      new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    );

    await expect
      .poll(async () => (await storedCell(page, row))?.data ?? UNAVAILABLE, { timeout: 15000 })
      .toBe(`${prefix}${today}`);
  }
);

Then(
  'the stored rich text cell in row {int} has plain text {string} followed by the chosen person\'s name',
  async ({ page }, row: number, prefix: string) => {
    const name = chosenPersonByPage.get(page);

    expect(name, 'a person was chosen').toBeTruthy();
    await expect
      .poll(async () => (await storedCell(page, row))?.data ?? UNAVAILABLE, { timeout: 15000 })
      .toBe(`${prefix}${name}`);
  }
);

Then('a board card displays {string} as {word}', async ({ page }, text: string, markName: string) => {
  const card = page.locator('.board-card').filter({ hasText: text }).first();

  await expect(card).toBeVisible({ timeout: 30000 });
  await expectDisplayedMark(card.getByTestId('rich-text-cell-content').first(), text, markName);
});

Then('a gallery card displays {string} as {word}', async ({ page }, text: string, markName: string) => {
  const gallery = page.getByTestId('database-gallery');

  await expect(gallery).toBeVisible({ timeout: 30000 });
  await expectDisplayedMark(gallery.getByTestId('rich-text-cell-content').first(), text, markName);
});

Then('the rich text editor does not show {string} as {word}', async ({ page }, text: string, markName: string) => {
  const { selector } = getMark(markName);

  await expect(activeEditor(page).locator(selector).filter({ hasText: text })).toHaveCount(0, { timeout: 10000 });
});

