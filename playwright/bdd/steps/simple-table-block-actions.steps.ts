import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { When, Then } = createBdd();
const layoutWidths = new WeakMap<Page, number>();
const blockLinks = new WeakMap<Page, string>();
const originalTables = new WeakMap<Page, TestNode>();
const convertedDatabases = new WeakMap<Page, TestNode>();
const originalDocuments = new WeakMap<Page, TestNode[]>();

type TestNode = {
  type?: string;
  blockId?: string;
  children?: TestNode[];
  [key: string]: unknown;
};

async function readBlock(page: Page, type: string) {
  return page.evaluate((type) => {
    type TestEditor = { children: TestNode[] };
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestEditor;
      __TEST_EDITORS__?: Record<string, TestEditor>;
    };
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];
    const findBlock = (nodes: TestNode[]): TestNode | undefined => {
      for (const node of nodes) {
        if (node.type === type) return node;
        const nested = findBlock(node.children ?? []);

        if (nested) return nested;
      }
    };

    return findBlock(editor?.children ?? []);
  }, type);
}

function table(page: Page) {
  return page.locator('.simple-table').first();
}

function blockMenu(page: Page) {
  return page.getByTestId('controls-menu');
}

function cells(page: Page) {
  return table(page).locator('tr:first-child > td');
}

When('I enter {string} in simple table cell {int}, {int}', async ({ page }, value: string, row: number, column: number) => {
  const target = table(page).locator(`td[data-row-index="${row}"][data-cell-index="${column}"]`);

  await target.locator('.text-element').first().click();
  await page.keyboard.insertText(value);
  await expect(target).toContainText(value);
});

When('I open the simple table block menu', async ({ page }) => {
  await table(page).locator('td').first().hover();
  const controls = page.getByTestId('hover-controls');

  await expect(controls).toHaveCSS('opacity', '1');
  await controls.getByTestId('drag-block').click();
  await expect(blockMenu(page)).toBeVisible();
  await expect(blockMenu(page).locator('..')).toHaveCSS('opacity', '1');
  const link = new URL(page.url());
  const blockId = (await readBlock(page, 'simple_table'))?.blockId;

  expect(blockId).toBeTruthy();
  link.searchParams.set('blockId', blockId!);
  blockLinks.set(page, link.toString());
});

When('I dismiss the simple table block menu', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(blockMenu(page)).toBeHidden();
});

When('I choose simple table block action {string}', async ({ page }, label: string) => {
  if (label === 'Distribute columns evenly') {
    layoutWidths.set(page, await table(page).locator('table').evaluate((element) => element.getBoundingClientRect().width));
  }

  if (label === 'Turn into database' || label === 'Convert to text' || label === 'Delete') {
    const original = await readBlock(page, 'simple_table');

    expect(original).toBeTruthy();
    originalTables.set(page, original!);
  }

  await blockMenu(page).getByRole('button', { name: label, exact: true }).click();
});

async function redoConversionWithKeyboard(page: Page) {
  // Playwright's desktop profile can report a different OS from the test host.
  const isAppleBrowser = await page.evaluate(() => /Mac OS X/.test(navigator.userAgent));

  await page.keyboard.press(`${isAppleBrowser ? 'Meta' : 'Control'}+Shift+z`);
}

When('I redo the simple table conversion with the keyboard', async ({ page }) => {
  await redoConversionWithKeyboard(page);
});

When('I redo the simple table conversion with the keyboard after waiting {int} seconds', async ({ page }, seconds: number) => {
  // Give delayed database orphan cleanup time to run before restoring the block.
  await page.waitForTimeout(seconds * 1000);
  await redoConversionWithKeyboard(page);
});

When('I resize the first simple table column by {int} pixels', async ({ page }, pixels: number) => {
  // The bottom row's handle stays clear of the floating text toolbar.
  const handle = table(page).locator('tr:last-child > td:first-child .simple-table-col-resize-handle');
  const box = await handle.boundingBox();

  if (!box) throw new Error('The first column has no resize handle');
  // The cell clips the handle's outer half, so grab its visible inner edge.
  const x = box.x + 1;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(handle).toHaveClass(/\bdragging\b/);
  await page.mouse.move(x + pixels, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => {
    const widths = await cells(page).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));

    return Math.max(...widths) - Math.min(...widths);
  }).toBeGreaterThan(10);
});

When('I choose simple table alignment {string}', async ({ page }, alignment: string) => {
  await page.locator('.simple-table-context-menu:visible').getByRole('button', { name: alignment, exact: true }).click();
});

Then('the simple table block menu offers all design actions', async ({ page }) => {
  for (const label of ['Delete', 'Duplicate', 'Copy link to block', 'Set to page width', 'Distribute columns evenly', 'Align', 'Turn into database', 'Convert to text']) {
    await expect(blockMenu(page).getByRole('button', { name: label, exact: true })).toBeVisible();
  }
});

Then('the whole simple table has the design selection effect', async ({ page, $testInfo }) => {
  await expect(table(page).locator('..')).toHaveClass(/\bselected\b/);
  const selection = table(page).locator('.simple-table-block-selection');

  await expect(selection).toBeVisible();
  await expect(selection).toHaveCSS('border-color', 'rgb(0, 188, 240)');
  await expect(selection).toHaveCSS('border-width', '2px');
  for (const cell of await table(page).locator('td').all()) {
    await expect(cell).toHaveCSS('box-shadow', 'none');
    expect(await cell.evaluate((element) => getComputedStyle(element, '::after').borderWidth)).toBe('0px');
  }

  const box = await selection.boundingBox();
  const grid = await table(page).locator('table').boundingBox();

  if (!box || !grid) throw new Error('The selected table has no bounds');
  expect(box.x).toBeCloseTo(grid.x, 0);
  expect(box.y).toBeCloseTo(grid.y, 0);
  expect(box.width).toBeCloseTo(grid.width, 0);
  expect(box.height).toBeCloseTo(grid.height, 0);
  if (await page.locator('html').getAttribute('data-dark-mode') === 'false') {
    await expect(table(page).locator('td').first()).toHaveCSS('background-color', 'rgb(224, 248, 255)');
  }

  const handle = page.getByTestId('drag-block').locator('.simple-table-block-drag-icon');

  await expect(handle).toBeVisible();
  await expect(handle).toHaveCSS('width', '16px');
  await expect(handle).toHaveCSS('height', '16px');
  await $testInfo.attach('simple-table-block-menu', { body: await page.screenshot(), contentType: 'image/png' });
});

Then('the whole simple table is no longer selected', async ({ page }) => {
  await expect(table(page).locator('..')).not.toHaveClass(/\bselected\b/);
  await expect(table(page).locator('.simple-table-block-selection')).toBeHidden();
});

Then('simple table columns have equal widths without changing the total width', async ({ page }) => {
  await expect.poll(async () => {
    const widths = await cells(page).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));

    return Math.max(...widths) - Math.min(...widths);
  }).toBeLessThan(1);
  const width = await table(page).locator('table').evaluate((element) => element.getBoundingClientRect().width);

  expect(Math.abs(width - (layoutWidths.get(page) ?? 0))).toBeLessThan(3);
});

Then('the simple table fits the document width', async ({ page }) => {
  await expect.poll(() => table(page).evaluate((element) => {
    const container = element.querySelector('.simple-table-scroll-container');
    const grid = element.querySelector('table');

    return Math.abs((container?.clientWidth ?? 0) - (grid?.getBoundingClientRect().width ?? 0));
  })).toBeLessThan(3);
});

Then('every simple table column has center alignment', async ({ page }) => {
  const count = await table(page).locator('td').count();

  await expect(table(page).locator('td[data-table-cell-horizontal-align="center"]')).toHaveCount(count);
});

Then('the simple table still contains its original cell content', async ({ page }) => {
  for (const text of ['Name', 'Status', 'Alice', 'Ready']) await expect(table(page)).toContainText(text);
});

Then('the original simple table is restored with its content and layout', async ({ page }) => {
  await expect(table(page)).toHaveCount(1);
  const original = originalTables.get(page);

  expect(original).toBeTruthy();
  await expect.poll(() => readBlock(page, 'simple_table')).toEqual(original);
});

Then('both simple tables contain the original cell content', async ({ page }) => {
  for (const instance of await page.locator('.simple-table').all()) {
    for (const text of ['Name', 'Status', 'Alice', 'Ready']) await expect(instance).toContainText(text);
  }
});

Then('the clipboard contains a link to the simple table block', async ({ page }) => {
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const link = new URL(copied);

  expect(link.pathname).toBe(new URL(page.url()).pathname);
  expect(link.searchParams.get('blockId')).toBeTruthy();
  const expected = blockLinks.get(page);

  expect(copied).toBe(expected);
});

Then('the simple table is replaced by a database containing its original cells', async ({ page, $testInfo }) => {
  $testInfo.setTimeout(240_000);
  await expect(table(page)).toHaveCount(0, { timeout: 120_000 });
  const database = page.locator('[data-block-type="grid"]').first();

  await expect(database).toBeVisible({ timeout: 30_000 });
  for (const text of ['Name', 'Status', 'Alice', 'Ready']) await expect(database).toContainText(text, { timeout: 30_000 });
  const node = await readBlock(page, 'grid');

  expect(node?.blockId).toBeTruthy();
  // Redo must reuse the imported database rather than create another one.
  if (convertedDatabases.has(page)) expect(node).toEqual(convertedDatabases.get(page));
  else convertedDatabases.set(page, node!);
});

async function prepareTableContent(page: Page, mode: 'empty' | 'inline') {
  await page.evaluate((mode) => {
    type TestEditor = { children: TestNode[]; apply: (operation: Record<string, unknown>) => void };
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestEditor; __TEST_EDITORS__?: Record<string, TestEditor>;
    };
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];

    if (!editor) throw new Error('The table editor is unavailable');
    const leaves: { path: number[]; text: string }[] = [];
    const visit = (nodes: TestNode[], parentPath: number[], inCell = false, inParagraph = false) => {
      nodes.forEach((node, index) => {
        const path = [...parentPath, index];
        const cell = inCell || node.type === 'simple_table_cell';
        const paragraph = inParagraph || (cell && node.type === 'paragraph');

        if (paragraph && typeof node.text === 'string') leaves.push({ path, text: node.text });
        else visit(node.children ?? [], path, cell, paragraph);
      });
    };

    visit(editor.children, []);
    for (const [index, leaf] of leaves.entries()) {
      if (mode === 'inline' && index > 1) break;
      if (leaf.text) editor.apply({ type: 'remove_text', path: leaf.path, offset: 0, text: leaf.text });
      if (mode === 'empty') continue;
      editor.apply({ type: 'insert_text', path: leaf.path, offset: 0, text: index === 0 ? '$' : '@' });
      editor.apply({
        type: 'set_node', path: leaf.path, properties: {},
        newProperties: index === 0 ? { formula: 'E = mc^2' }
          : { mention: { type: 'person', person_id: 'ada', person_name: 'Ada Lovelace' } },
      });
    }
  }, mode);
}

When('I prepare {string} simple table content', async ({ page }, content: string) => {
  if (content === 'empty') await prepareTableContent(page, 'empty');
  else if (content !== 'populated') throw new Error(`Unknown table content state: ${content}`);
});

When('I add inline values to the simple table', async ({ page }) => {
  await prepareTableContent(page, 'inline');
});

When('I add a paragraph {string} the table with its plus button', async ({ page }, direction: string) => {
  if (direction !== 'above' && direction !== 'below') throw new Error(`Unknown insertion direction: ${direction}`);
  await table(page).locator('td').first().hover();
  const controls = page.getByTestId('hover-controls');

  await expect(controls).toHaveCSS('opacity', '1');
  await controls.getByTestId('add-block').click({ modifiers: direction === 'above' ? ['Alt'] : [] });
  await expect(page.getByTestId('slash-panel')).toBeVisible();
});

When('I dismiss the slash menu after adding a table sibling', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('slash-panel')).toBeHidden();
});

When('I type {string} without refocusing the editor', async ({ page }, value: string) => {
  await page.keyboard.insertText(value);
});

Then('the editor has keyboard focus after the table action', async ({ page }) => {
  await expect(page.locator('[data-slate-editor="true"]').first()).toBeFocused();
});

Then('a paragraph is inserted {string} the simple table', async ({ page }, direction: string) => {
  await expect.poll(() => page.evaluate((direction) => {
    type TestEditor = { children: TestNode[] };
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestEditor; __TEST_EDITORS__?: Record<string, TestEditor>;
    };
    const editor = testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0];
    const nodes = editor?.children ?? [];
    const index = nodes.findIndex((node) => node.type === 'simple_table');

    return nodes[index + (direction === 'above' ? -1 : 1)]?.type;
  }, direction)).toBe('paragraph');
});

When('I select the whole table document', async ({ page }) => {
  const document = await page.evaluate(() => {
    type TestEditor = { children: TestNode[] };
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestEditor; __TEST_EDITORS__?: Record<string, TestEditor>;
    };

    return (testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0])?.children;
  });

  expect(document).toBeTruthy();
  originalDocuments.set(page, document);
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+a`);
});

Then('the block menu targets multiple selected blocks', async ({ page }) => {
  await expect(blockMenu(page).getByRole('button', { name: 'Turn into database', exact: true })).toHaveCount(0);
  await expect(blockMenu(page).getByTestId('delete')).toBeVisible();
});

Then('every selected table document block is restored in its original order', async ({ page }) => {
  await expect.poll(() => page.evaluate(() => {
    type TestEditor = { children: TestNode[] };
    const testWindow = window as Window & {
      __TEST_EDITOR__?: TestEditor; __TEST_EDITORS__?: Record<string, TestEditor>;
    };

    return (testWindow.__TEST_EDITOR__ ?? Object.values(testWindow.__TEST_EDITORS__ ?? {})[0])?.children;
  })).toEqual(originalDocuments.get(page));
  await expect(table(page)).toContainText('Alice');
  await expect(page.locator('[data-slate-editor="true"]').first()).toContainText('A sibling paragraph');
});

Then('the converted table preserves its displayed inline values', async ({ page, $testInfo }) => {
  $testInfo.setTimeout(240_000);
  await expect(table(page)).toHaveCount(0, { timeout: 120_000 });
  const editor = page.locator('[data-slate-editor="true"]').first();

  for (const value of ['E = mc^2', 'Ada Lovelace', 'Alice', 'Ready']) {
    await expect(editor).toContainText(value, { timeout: 30_000 });
  }
});
