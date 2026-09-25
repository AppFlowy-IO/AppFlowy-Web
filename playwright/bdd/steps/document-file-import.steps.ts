import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp, signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { HeaderSelectors, ModalSelectors, ViewActionSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();

type Format = 'pdf' | 'docx';
type ImportStatus = {
  task_id: string;
  status: string;
  view_id?: string;
  error?: string;
  diagnostics?: { warnings: { code: string; message: string }[] };
};
type ImportState = {
  format: Format;
  name: string;
  workspaceId: string;
  parentId: string;
  status: ImportStatus;
};

const stateByPage = new WeakMap<Page, ImportState>();
const BULLETS = [
  'Open the import guide',
  'Check the destination workspace',
  'Keep the original file unchanged',
  'Review the imported headings',
  'Verify every list item separately',
  'Preserve drawn circle bullets',
  'Keep bold text inside a list',
  'Confirm the final bullet survives',
];
const SECTIONS = [
  'Text and navigation',
  'Lists and links',
  'Tables and code',
  'Figures and final checks',
  'Typography and layout',
  'Deeper structure',
];
const DEEP_BULLETS = ['Release review', 'Review formatting', 'Inspect the deepest item', 'Approve the document'];
const CODE = '// keep the next statement on a new line\nlet ready = true;\nprintln!("ready");';

function stateFor(page: Page): ImportState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Upload the generated document before checking its content');
  return state;
}

function editorFor(page: Page): Locator {
  return page.locator('[data-slate-editor="true"]').last();
}

// Read only this block's text leaves: a nested bullet's text must not count twice.
async function blockTexts(blocks: Locator): Promise<string[]> {
  return blocks.evaluateAll((elements) =>
    elements.map((element) =>
      Array.from(element.querySelectorAll('[data-slate-string]'))
        .filter((leaf) => leaf.closest('[data-block-type]') === element)
        .map((leaf) => leaf.textContent || '')
        .join('')
    )
  );
}

Given('I am signed in for document file import', async ({ page, request }) => {
  setupPageErrorHandling(page);
  const email = process.env.DOCUMENT_IMPORT_EMAIL;
  const password = process.env.DOCUMENT_IMPORT_PASSWORD;

  if (email || password) {
    if (!email || !password) throw new Error('Set both DOCUMENT_IMPORT_EMAIL and DOCUMENT_IMPORT_PASSWORD');
    await signInWithPasswordViaUi(page, email, password, 0);
  } else {
    await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  }

  await expect(page.getByTestId('space-item').first()).toBeVisible();
});

When(
  'I upload the generated {string} fixture through the import dialog',
  async ({ page, $testInfo }, format: string) => {
    if (format !== 'pdf' && format !== 'docx') throw new Error(`Unsupported fixture: ${format}`);
    const space = page.getByTestId('space-item').first();

    await space.hover();
    await space.getByTestId('inline-add-page').first().click();
    await page.getByTestId('add-import-button').click();
    await expect(page.getByTestId('import-dialog')).toBeVisible();

    const name = `BDD ${format.toUpperCase()} feature matrix ${Date.now()}`;
    const filePath = path.resolve('playwright/fixtures/document-import', `feature_matrix.${format}`);
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/import\/[^/]+\/document$/.test(new URL(response.url()).pathname)
    );

    // Exercise the native file input, including upload signing and the actual worker. No routes
    // are intercepted; changing only the filename makes retained manual evidence distinguishable.
    await page.getByTestId(`import-${format}-input`).setInputFiles({
      name: `${name}.${format}`,
      mimeType:
        format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: await readFile(filePath),
    });
    const created = await createResponsePromise;

    expect(created.ok(), 'The real server must accept the import').toBe(true);
    const body = await created.json();

    expect(body.code, body.message).toBe(0);
    expect(body.data.task_id).toBeTruthy();
    const taskUrl = `${created.url()}/${body.data.task_id}`;
    const terminalResponse = await page.waitForResponse(
      async (response) => {
        if (response.url() !== taskUrl || response.request().method() !== 'GET') return false;
        const result = await response.json();

        return result.code !== 0 || !['Pending', 'Processing'].includes(result.data?.status);
      },
      { timeout: 90000 }
    );
    const terminal = await terminalResponse.json();

    expect(terminal.code, terminal.message).toBe(0);
    const status: ImportStatus = terminal.data;
    const workspaceId = new URL(created.url()).pathname.split('/')[3];
    const parentId: string = created.request().postDataJSON().parent_view_id;

    stateByPage.set(page, { format, name, workspaceId, parentId, status });
    await $testInfo.attach('document-import-result', {
      body: JSON.stringify({ format, name, workspaceId, parentId, ...status }, null, 2),
      contentType: 'application/json',
    });
  }
);

Then('the document import completes and opens its page', async ({ page }) => {
  const { format, status, name } = stateFor(page);

  expect(status.status, status.error || JSON.stringify(status)).toBe('Completed');
  expect(status.view_id).toBeTruthy();
  if (format === 'pdf') {
    expect(status.diagnostics?.warnings || []).toEqual([]);
  } else {
    expect(status.diagnostics?.warnings.map((warning) => warning.code)).toEqual(['docx_merged_cells_flattened']);
  }

  await expect(page).toHaveURL(new RegExp(`/${status.view_id}(?:[?#]|$)`));
  await expect(page.getByTestId('page-title-input')).toHaveText(name);
  await expect(page.getByTestId('import-dialog')).toHaveCount(0);
});

Then('the imported document renders the fixture content', async ({ page, $testInfo }) => {
  const { format } = stateFor(page);
  const editor = editorFor(page);
  const blocks = (type: string) => editor.locator(`[data-block-type="${type}"]`);

  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Final sentinel: every page was imported.');
  for (const label of [
    ...SECTIONS,
    'Formatting examples',
    'Code example',
    'Inline style samples',
    'Paragraph alignment',
    'Nested list examples',
  ]) {
    await expect(blocks('heading').filter({ hasText: label })).toHaveCount(1);
  }

  const outline = blocks('outline');

  await expect(outline).toHaveCount(1);
  await expect(outline.locator('.outline-block')).toBeVisible();
  await expect(blocks('heading').filter({ hasText: /^Table of contents$/i })).toHaveCount(0);
  for (const label of SECTIONS) {
    await expect(outline.getByText(label, { exact: true })).toHaveCount(1);
  }

  // Every source contents entry must navigate to its real native heading, before and after reload.
  for (const label of SECTIONS) {
    const target = blocks('heading')
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator('[id^="heading-"]');
    const targetId = (await target.getAttribute('id'))?.replace(/^heading-/, '');

    expect(targetId).toBeTruthy();
    await outline.getByText(label, { exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('blockId')).toBe(targetId);
    await expect(target).toBeInViewport();
  }

  const expectedBullets = [...BULLETS];

  if (format === 'docx') expectedBullets.splice(2, 0, 'Nested checklist detail');
  expectedBullets.push(...DEEP_BULLETS);
  await expect.poll(() => blockTexts(blocks('bulleted_list'))).toEqual(expectedBullets);
  await expect
    .poll(() => blockTexts(blocks('numbered_list')))
    .toEqual(['Choose the source file', 'Start the import task', 'Open the completed page']);
  const deepParent = blocks('bulleted_list').filter({ hasText: 'Release review' });

  await expect
    .poll(() => blockTexts(deepParent.locator('[data-block-type="bulleted_list"]')))
    .toEqual(['Review formatting', 'Inspect the deepest item']);
  await expect(deepParent.locator('[data-block-type="bulleted_list"] [data-block-type="bulleted_list"]')).toHaveText(
    'Inspect the deepest item'
  );
  const finalBullet = blocks('bulleted_list').filter({ hasText: /^Approve the document$/ });

  expect(
    await finalBullet.evaluate((el) => el.parentElement?.closest('[data-block-type="bulleted_list"]') === null)
  ).toBe(true);

  for (const [label, href] of [
    ['Open the import guide', 'https://example.com/import-guide?source=fixture&format=document'],
    ['Read the reference', 'https://example.com/reference'],
    ['Cedar', 'https://example.com/projects/cedar'],
  ]) {
    // Editable Slate links are spans. Inspect the URL shown by the actual link popover
    // rather than assuming an anchor or navigating to the external example website.
    const link = editor.locator('.href-link').filter({ hasText: label });

    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(label);
    // Scrolling closes the editor's hover popover. Move off the content before
    // hovering again so a link scrolled under the pointer gets a fresh mouseenter.
    await link.scrollIntoViewIfNeeded();
    await expect(async () => {
      await page.mouse.move(0, 0);
      await link.hover();
      await expect(page.getByText(href, { exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000, intervals: [250, 500] });
    await editor.locator('[data-block-type="heading"]').first().hover();
  }

  // PDF layout may combine this plain label with the following sentence. It must still
  // remain unlinked even though an earlier bullet uses the exact same words as a link.
  await expect
    .poll(() =>
      editor
        .locator('[data-slate-string]')
        .filter({ hasText: BULLETS[0] })
        .evaluateAll((leaves) => leaves.filter((leaf) => !leaf.closest('.href-link')).length)
    )
    .toBe(1);
  await expect(editor.locator('strong').filter({ hasText: /^bold emphasis$/ })).toHaveCount(1);
  await expect(editor.locator('em').filter({ hasText: /^italic emphasis$/ })).toHaveCount(1);
  await expect(editor.locator('strong em').filter({ hasText: 'bold italic emphasis' })).toHaveCount(1);
  await expect(
    blocks('bulleted_list').locator('strong').filter({ hasText: 'Keep bold text inside a list' })
  ).toHaveCount(1);
  await expect(editor).toContainText('Accented text: Réinitialiser le réseau. Café déjà vu.');
  const content: Record<string, string[]> = JSON.parse(
    await readFile(path.resolve('playwright/fixtures/document-import/feature_matrix.content.json'), 'utf8')
  );
  const renderedText = (await blockTexts(editor.locator('[data-block-type]'))).join(' ').replace(/\s+/g, ' ');

  for (const passage of [...content.common, ...content[format]]) {
    expect(renderedText.split(passage).length - 1, `Source passage must survive exactly once: ${passage}`).toBe(1);
  }

  // File-local bookmarks are flattened. They must not become broken external links.
  for (const label of [...SECTIONS, 'Back to contents']) {
    await expect(editor.locator('.href-link').filter({ hasText: label })).toHaveCount(0);
  }

  const table = blocks('simple_table').filter({ hasText: 'Atlas' });

  await expect(table).toHaveCount(1);
  const rows = table.locator('[data-block-type="simple_table_row"]');

  await expect(rows).toHaveCount(4);
  for (const [index, cells] of [
    ['Project', 'Count', 'Status'],
    ['Atlas', '3', 'Ready'],
    ['Boreal', '5', 'Review'],
    ['Cedar', '8', 'Done'],
  ].entries()) {
    await expect(rows.nth(index).locator('td')).toHaveText(cells);
  }

  await expect(blocks('simple_table')).toHaveCount(3);
  const mergedRows = blocks('simple_table')
    .filter({ hasText: 'Merged readiness summary' })
    .locator('[data-block-type="simple_table_row"]');

  await expect(mergedRows).toHaveCount(3);
  // Slate's empty cells have a zero-width text leaf; compare their visible text.
  expect(
    await mergedRows
      .nth(0)
      .locator('td')
      .evaluateAll((cells) => cells.map((cell) => (cell.textContent || '').replace(/[\uFEFF\u200B]/g, '').trim()))
  ).toEqual(['Merged readiness summary', '', '']);
  await expect(mergedRows.nth(1).locator('td')).toHaveText(['Area', 'Status', 'Owner']);
  await expect(mergedRows.nth(2).locator('td')).toHaveText(['Navigation', 'Verified', 'Mira']);
  const richTable = blocks('simple_table').filter({ hasText: 'Delta' });
  const richRows = richTable.locator('[data-block-type="simple_table_row"]');

  await expect(richTable).toHaveCount(1);
  await expect(richRows).toHaveCount(3);
  await expect(richRows.nth(0).locator('td')).toHaveText(['Item', 'Description', 'Owner']);
  await expect(richRows.nth(1).locator('td')).toHaveText(['Delta', 'First line Second line', 'Mira']);
  await expect(richRows.nth(2).locator('td')).toHaveText(['Echo', 'Bold table detail', 'Noah']);

  // textContent preserves literal newlines; normalized toHaveText would miss concatenated code.
  await expect.poll(async () => (await blocks('code').locator('pre code').textContent())?.trimEnd()).toBe(CODE);
  await expect(editor).toContainText('Figure 1 Source to conversion to imported page');
  await expect(editor).toContainText('Left column first paragraph.');
  await expect(editor).toContainText('Right column second paragraph.');
  for (let pageNumber = 1; pageNumber <= 6; pageNumber++) {
    await expect(editor).not.toContainText(`Page ${pageNumber}`);
  }

  await expect(editor.getByTestId('unsupported-block')).toHaveCount(0);

  if (format === 'docx') {
    const parent = blocks('bulleted_list').filter({ hasText: 'Check the destination workspace' });

    await expect(parent.locator('[data-block-type="bulleted_list"]')).toHaveText('Nested checklist detail');
    await expect(blocks('quote')).toHaveText('Only mark a page ready after its content is persisted.');
    await expect(editor.locator('s')).toHaveText(['Removed wording', 'Double strike sample']);
    await expect(richTable.locator('strong').filter({ hasText: 'Bold table detail' })).toHaveCount(1);
    await expect(richTable.locator('em').filter({ hasText: 'Mira' })).toHaveCount(1);
    await expect(editor.locator('span.bg-border-primary').filter({ hasText: /^import_ready = true$/ })).toHaveCount(1);
    await expect(editor).toContainText('Subscript example: H2O');
    await expect(editor).toContainText('Superscript example: x2');
    for (const [label, level] of [
      ['Level three sample', 3],
      ['Level four sample', 4],
      ['Level five sample', 5],
      ['Level six sample', 6],
    ] as const) {
      await expect(editor.locator(`.heading.level-${level}`).filter({ hasText: label })).toHaveCount(1);
    }
  } else {
    await expect(editor).toContainText('Subscript example: H₂O');
    await expect(editor).toContainText('Superscript example: x²');
  }

  await richTable.scrollIntoViewIfNeeded();
  await $testInfo.attach(`imported-${format}-styles-and-rich-table`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

Then('the imported document displays the exact source image', async ({ page, $testInfo }) => {
  const { format } = stateFor(page);
  const editor = editorFor(page);
  const blocks = (type: string) => editor.locator(`[data-block-type="${type}"]`);

  const figure = blocks('image');
  const image = figure.locator('img');

  await expect(figure).toHaveCount(1);
  await expect(image).toHaveCount(1);
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect(image).toBeInViewport();
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => ({
        complete: element.complete,
        width: element.naturalWidth,
        height: element.naturalHeight,
      }))
    )
    .toEqual({ complete: true, width: 960, height: 240 });

  const sourceImage = await readFile(path.resolve('playwright/fixtures/document-import/feature_matrix.png'));
  const pixels = await image.evaluate(async (element: HTMLImageElement, base64: string) => {
    const expected = new Image();

    expected.src = `data:image/png;base64,${base64}`;
    await expected.decode();
    const rgba = (img: HTMLImageElement) => {
      const canvas = document.createElement('canvas');

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d');

      if (!context) throw new Error('Canvas is required for exact image verification');
      context.drawImage(img, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };

    const actual = rgba(element);
    const reference = rgba(expected);
    let differentChannels = 0;

    for (let index = 0; index < reference.length; index++) {
      if (actual[index] !== reference[index]) differentChannels++;
    }

    return { actualBytes: actual.length, expectedBytes: reference.length, differentChannels };
  }, sourceImage.toString('base64'));

  expect(pixels, 'Every displayed RGBA channel must match the source figure; placeholders cannot pass').toEqual({
    actualBytes: 960 * 240 * 4,
    expectedBytes: 960 * 240 * 4,
    differentChannels: 0,
  });
  const placement = await figure.evaluate((element) => {
    const editor = element.closest('[data-slate-editor="true"]');
    const blocks = Array.from(editor?.querySelectorAll('[data-block-type]') || []);
    const index = blocks.indexOf(element);

    return { before: blocks[index - 1]?.textContent, after: blocks[index + 1]?.textContent };
  });

  expect(placement).toEqual({
    before: 'Figures and final checks',
    after: 'Figure 1 Source to conversion to imported page',
  });
  await $testInfo.attach(`imported-${format}-exact-source-image`, {
    body: await image.screenshot(),
    contentType: 'image/png',
  });
});

When('I reload and reopen the imported document from the sidebar', async ({ page }) => {
  const { workspaceId, parentId, status } = stateFor(page);

  // Leave the page and reload before opening it by the projected sidebar entry. This checks
  // both sidebar discoverability and a fresh document read, rather than only the conversion.
  await page.goto(`/app/${workspaceId}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const sidebarPage = page.getByTestId(`page-${status.view_id}`);
  const space = page.getByTestId(`space-${parentId}`);

  await expect(space).toBeVisible();
  if ((await space.getAttribute('data-expanded')) !== 'true') {
    await space.click();
  }

  await expect(space).toHaveAttribute('data-expanded', 'true');
  await expect(sidebarPage).toBeVisible();
  await sidebarPage.click();
  await expect(page).toHaveURL(new RegExp(`/${status.view_id}(?:[?#]|$)`));
});

After({ tags: '@document-file-import' }, async ({ page }) => {
  const state = stateByPage.get(page);

  if (!state?.status.view_id || process.env.DOCUMENT_IMPORT_KEEP_PAGES === '1') return;
  await page.goto(`/app/${state.workspaceId}/${state.status.view_id}`, { waitUntil: 'domcontentloaded' });
  await HeaderSelectors.moreActionsButton(page).click();
  await ViewActionSelectors.deleteButton(page).click();
  const confirmation = ModalSelectors.confirmDeleteButton(page);

  if (await confirmation.isVisible()) await confirmation.click();
  await expect(page.getByTestId(`page-${state.status.view_id}`)).toHaveCount(0);
  stateByPage.delete(page);
});
