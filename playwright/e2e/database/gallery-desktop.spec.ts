import { expect, test as base, type Page } from '@playwright/test';

// Exercise the real Gallery, menus and Yjs dispatches without a server account.
const test = base.extend<{}, { galleryFixtureURL: string }>({
  galleryFixtureURL: [
    async ({}, use, workerInfo) => {
      const { createServer } = await import('vite');
      const server = await createServer({
        cacheDir: `node_modules/.vite/gallery-desktop-${workerInfo.workerIndex}`,
        logLevel: 'error',
        optimizeDeps: { entries: ['playwright/support/gallery-desktop.fixture.tsx'] },
        server: { host: '127.0.0.1', port: 5173, strictPort: false },
      });
      try {
        await server.listen();
        const url = server.resolvedUrls?.local[0];
        if (!url) throw new Error('Gallery fixture server did not start');
        await use(url);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
});
test.describe.configure({ mode: 'default' });
const rowId = '00000000-0000-4000-8000-000000000001';

async function openFixture(page: Page, url: string, dark = false) {
  await page.route('**/gallery-desktop-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html data-dark-mode="${dark}"><body id="body" style="background:var(--surface-primary)"><div id="root"></div>
      <script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import('/playwright/support/gallery-desktop.fixture.tsx');
      </script></body></html>`,
    })
  );
  await page.goto(new URL('/gallery-desktop-fixture', url).href);
  await expect(page.getByTestId(`gallery-card-${rowId}`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('The Art of Living in the Moment')).toBeVisible();
}

async function openLayout(page: Page) {
  await page.getByTestId('fixture-settings').click();
  await page.getByTestId('database-layout-settings-trigger').hover();
  await expect(page.getByTestId('gallery-layout-settings-menu')).toBeVisible();
  await expect(page.getByTestId('gallery-layout-settings-menu').locator('..')).toHaveCSS('opacity', '1');
}

for (const dark of [false, true]) {
  test(`Gallery desktop appearance and compact mode in ${dark ? 'dark' : 'light'} mode`, async ({
    page,
    galleryFixtureURL,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, galleryFixtureURL, dark);
    const card = page.getByTestId(`gallery-card-${rowId}`);
    await expect(page.getByTestId('gallery-grid')).toHaveAttribute('data-column-count', '4');
    await expect(card).toHaveCSS('border-radius', '10px');
    await expect(page.getByTestId('gallery-grid')).toHaveCSS('gap', '8px');
    await card.hover();
    await expect(page.getByTestId(`gallery-card-toolbar-${rowId}`)).toHaveCSS('opacity', '1');
    await expect(page.getByTestId(`gallery-card-toolbar-${rowId}`)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.6)');
    await page.screenshot({ path: testInfo.outputPath(`gallery-${dark ? 'dark' : 'light'}.png`) });
    await openLayout(page);
    await page.screenshot({ path: testInfo.outputPath('gallery-layout.png') });
    await page.getByTestId('gallery-compact-mode-toggle').click();
    await expect(page.getByTestId('gallery-compact-mode-toggle')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(`gallery-card-properties-${rowId}`)).toHaveAttribute('data-compact', 'true');
    await page.reload();
    await expect(page.getByTestId(`gallery-card-properties-${rowId}`)).toHaveAttribute('data-compact', 'true');
    await openLayout(page);
    await page.getByTestId('gallery-card-size-trigger').hover();
    await page.getByTestId('gallery-card-size-large').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('gallery-grid')).toHaveAttribute('data-column-count', '3');
    await page.setViewportSize({ width: 500, height: 900 });
    await expect(page.getByTestId('gallery-grid')).toHaveAttribute('data-column-count', '1');
    await page.screenshot({ path: testInfo.outputPath('gallery-narrow.png') });
    expect(errors).toEqual([]);
  });
}

test('cover changes can be saved or canceled, and read-only cards only offer peek', async ({
  page,
  galleryFixtureURL,
}) => {
  await openFixture(page, galleryFixtureURL);
  const card = page.getByTestId(`gallery-card-${rowId}`);
  const image = card.locator('img').first();
  const reposition = page.getByTestId(`gallery-card-reposition-${rowId}`);
  await card.hover();
  await reposition.click();
  const slider = page.getByRole('slider', { name: 'Reposition cover' });
  await slider.press('ArrowUp');
  await expect(image).toHaveCSS('object-position', '50% 55%');
  await page.getByTestId('gallery-cover-cancel').click();
  await expect(image).toHaveCSS('object-position', '50% 50%');
  await reposition.click();
  const box = await slider.boundingBox();
  if (!box) throw new Error('Missing cover bounds');
  await page.mouse.move(box.x + 30, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 50);
  await page.mouse.up();
  await expect(slider).toHaveAttribute('aria-valuenow', '0.4');
  await page.getByTestId('gallery-cover-save').click();
  await expect(image).toHaveCSS('object-position', '50% 70%');
  await reposition.click();
  await slider.press('ArrowUp');
  await slider.press('Escape');
  await expect(image).toHaveCSS('object-position', '50% 70%');
  // Entering a second card commits the first card's live offset, as on desktop.
  await reposition.click();
  await slider.press('ArrowUp');
  const secondRowId = '00000000-0000-4000-8000-000000000002';
  await page.getByTestId(`gallery-card-${secondRowId}`).hover();
  await page.getByTestId(`gallery-card-reposition-${secondRowId}`).click();
  await expect(page.getByRole('slider')).toHaveCount(1);
  await expect(image).toHaveCSS('object-position', '50% 75%');
  await page.getByTestId('gallery-cover-cancel').click();
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await card.hover();
  await expect(reposition).toHaveCount(0);
  await expect(page.getByTestId(`gallery-card-edit-${rowId}`)).toHaveCount(0);
  await expect(page.getByTestId(`gallery-card-more-${rowId}`)).toHaveCount(0);
  await expect(page.getByTestId('gallery-new-row')).toHaveCount(0);
  await page.getByTestId(`gallery-card-peek-${rowId}`).click();
  await expect(page.getByLabel('Opened row')).toHaveText(rowId);
});

test('groups, searches and collapses cards using the shared desktop grouping format', async ({
  page,
  galleryFixtureURL,
}, testInfo) => {
  await openFixture(page, galleryFixtureURL);
  await page.getByTestId('fixture-settings').click();
  await page.getByTestId('gallery-group-settings-trigger').hover();
  await page.getByTestId('gallery-group-by-field-category').click();
  await page.keyboard.press('Escape');
  const group = page.getByTestId('gallery-group-mauve');
  await expect(group).toBeVisible();
  await expect(group.getByTestId('list-group-row-count')).toHaveText('2');
  await expect(page.getByTestId('gallery-group-camellia')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('gallery-grouped.png') });
  await group.getByTestId('list-group-collapse-toggle').click();
  await expect(group.getByTestId(`gallery-card-${rowId}`)).toHaveCount(0);
  await group.getByTestId('list-group-collapse-toggle').click();
  await page.getByRole('textbox', { name: 'Search Gallery' }).fill('Art of Living');
  await expect(page.locator('[data-testid^="gallery-tile-"]')).toHaveCount(1);
  await expect(page.getByTestId('gallery-group-camellia')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search Gallery' }).fill('unmatched');
  await expect(page.locator('[data-testid^="gallery-tile-"]')).toHaveCount(0);
});
