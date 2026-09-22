import { expect, test as base } from '@playwright/test';

const test = base.extend<{}, { subpageFixtureURL: string }>({
  subpageFixtureURL: [
    async ({}, use, workerInfo) => {
      const { createServer } = await import('vite');
      const server = await createServer({
        cacheDir: `node_modules/.vite/subpage-${workerInfo.workerIndex}`,
        logLevel: 'error',
        optimizeDeps: { entries: ['playwright/support/subpage.fixture.tsx'] },
        server: { host: '127.0.0.1', port: 5173, strictPort: false },
      });
      try {
        await server.listen();
        const url = server.resolvedUrls?.local[0];
        if (!url) throw new Error('Subpage fixture server did not start');
        await use(url);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
});

test.beforeEach(async ({ page, subpageFixtureURL }) => {
  await page.route('**/subpage-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body id="body"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/subpage.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto(new URL('/subpage-fixture', subpageFixtureURL).href);
  await expect(page.getByTestId('editor-content')).toBeVisible({ timeout: 90_000 });
});

test('creates a child with /subpage, renders live metadata, opens it, and supports delete undo/redo', async ({
  page,
}) => {
  const editor = page.getByTestId('editor-content');
  await editor.click();
  await page.keyboard.type('/subpage');
  await page.locator('[data-option-key="document"]').filter({ hasText: 'Subpage' }).click({ timeout: 10_000 });
  const block = editor.locator('[data-block-type="sub_page"]');
  await expect(block).toHaveText('New child');
  await expect(page.getByTestId('child-pages')).toHaveText('New child');
  await expect(page.getByTestId('opened-page')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Rename child', exact: true }).click();
  await expect(block).toHaveText('Renamed child');
  await block.getByText('Renamed child').click();
  await expect(page.getByTestId('opened-page')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Delete subpage block', exact: true }).click();
  await expect(block).toHaveCount(0);
  await expect(page.getByTestId('trash')).not.toBeEmpty();
  await expect(page.getByTestId('child-pages')).toBeEmpty();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(block).toHaveText('Renamed child');
  await expect(page.getByTestId('trash')).toBeEmpty();
  await expect(page.getByTestId('child-pages')).toHaveText('Renamed child');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(block).toHaveCount(0);
  await expect(page.getByTestId('trash')).not.toBeEmpty();
});

test('failed creation leaves no subpage block or child page', async ({ page }) => {
  await page.getByLabel('Fail creation').check();
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/subpage');
  await page.locator('[data-option-key="document"]').click({ timeout: 10_000 });
  await expect(page.getByTestId('creation-attempts')).toHaveText('1');
  await expect(page.getByTestId('child-pages')).toBeEmpty();
  await expect(page.locator('[data-block-type="sub_page"]')).toHaveCount(0);
  await expect(page.getByTestId('opened-page')).toBeEmpty();
});

test('the block menu duplicates the child page instead of inserting an alias', async ({ page }) => {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/subpage');
  await page.getByTestId('slash-menu-document').click();
  const blocks = page.locator('[data-block-type="sub_page"]');
  await expect(blocks).toHaveCount(1);
  await blocks.first().hover();
  await page.getByTestId('drag-block').click();
  await page.getByTestId('controls-menu').getByTestId('duplicate').click();
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(1)).toHaveText('New child (Copy)');
  const ids = await blocks
    .locator('[data-mention-id]')
    .evaluateAll((elements) => elements.map((el) => el.getAttribute('data-mention-id')));
  expect(new Set(ids).size).toBe(2);
  await expect(page.getByTestId('child-pages').locator('div')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(blocks).toHaveCount(1);
  await expect(page.getByTestId('child-pages').locator('div')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(blocks).toHaveCount(2);
  await expect(page.getByTestId('child-pages').locator('div')).toHaveCount(2);
});

test('pasting desktop subpage data duplicates the child and preserves desktop linked_page references', async ({
  page,
}) => {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/subpage');
  await page.getByTestId('slash-menu-document').click();
  const block = page.locator('[data-block-type="sub_page"]').first();
  await expect(block).toHaveText('New child');
  const id = await block.locator('[data-mention-id]').getAttribute('data-mention-id');
  // Dispatch Chromium’s rich-paste input with the desktop clipboard format. The
  // actual editor clipboard parser, page operations, and Yjs insertion run.
  await page.getByTestId('editor-content').evaluate((element, viewId) => {
    const data = new DataTransfer();
    data.setData(
      'io.appflowy.InAppJsonType',
      JSON.stringify({
        document: {
          type: 'page',
          children: [
            { type: 'sub_page', data: { view_id: viewId, was_copied: true }, children: [] },
            { type: 'linked_page', data: { view_id: viewId }, children: [] },
          ],
        },
      })
    );
    element.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertFromPaste',
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }, id);
  await expect(page.locator('[data-block-type="sub_page"]').filter({ hasText: 'New child (Copy)' })).toBeVisible();
  await expect(page.locator('[data-block-type="sub_page"]')).toHaveCount(2);
  await expect(page.getByTestId('trash')).toBeEmpty();
  await expect(page.locator('[data-block-type="linked_page"]')).toHaveText('New child');
  await expect(page.locator('[data-block-type="linked_page"] [data-mention-id]')).toHaveAttribute(
    'data-mention-id',
    id!
  );
});

test('read-only documents still open subpages without allowing slash creation', async ({ page }) => {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/subpage');
  await page.getByTestId('slash-menu-document').click();
  await expect(page.locator('[data-block-type="sub_page"]')).toHaveText('New child');
  await page.getByLabel('Read only').check();
  await expect(page.getByTestId('editor-content')).toHaveAttribute('contenteditable', 'false');
  await page.getByTestId('editor-content').getByText('New child').click();
  await expect(page.getByTestId('opened-page')).not.toBeEmpty();
  await page.keyboard.type('/subpage');
  await expect(page.getByTestId('slash-menu-document')).toHaveCount(0);
  await expect(page.getByTestId('child-pages').locator('div')).toHaveCount(1);
});

test('cut and paste into another document moves the existing child and remains undoable', async ({ page }) => {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/subpage');
  await page.getByTestId('slash-menu-document').click();
  const block = page.locator('[data-block-type="sub_page"]');
  await expect(block).toHaveText('New child');
  const childId = await block.locator('[data-mention-id]').getAttribute('data-mention-id');
  const clipboard = await page.getByTestId('editor-content').evaluate((element) => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('application/x-appflowy-fragment');
  });
  expect(clipboard).not.toBe('');
  await expect(block).toHaveCount(0);
  await expect(page.getByTestId('trash')).toHaveText(childId!);
  await page.getByRole('button', { name: 'Open other parent', exact: true }).click();
  await page.getByTestId('editor-content').click();
  await page.getByTestId('editor-content').evaluate((element, fragment) => {
    const data = new DataTransfer();
    data.setData('application/x-appflowy-fragment', fragment);
    element.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertFromPaste',
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }, clipboard);
  await expect(block).toHaveText('New child');
  await expect(block.locator('[data-mention-id]')).toHaveAttribute('data-mention-id', childId!);
  await expect(page.getByTestId('trash')).toBeEmpty();
  await expect(page.getByTestId('child-pages')).toHaveText('New child');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(block).toHaveCount(0);
  await expect(page.getByTestId('trash')).toHaveText(childId!);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(block).toHaveText('New child');
  await expect(page.getByTestId('trash')).toBeEmpty();
});

test('undoing and redoing slash creation keeps the child page and block in sync', async ({ page }) => {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('/subpage');
  await page.getByTestId('slash-menu-document').click();
  const block = page.locator('[data-block-type="sub_page"]');
  await expect(block).toHaveText('New child');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(block).toHaveCount(0);
  await expect(page.getByTestId('child-pages')).toBeEmpty();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(block).toHaveText('New child');
  await expect(page.getByTestId('child-pages')).toHaveText('New child');
});
