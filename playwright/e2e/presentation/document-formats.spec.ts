import { expect, test, type Page, type Locator } from '@playwright/test';

async function openFixture(page: Page, query = '') {
  await page.route('**/document-formats-fixture*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body id="body"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/document-formats.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto(`/document-formats-fixture${query}`);
  await expect(page.getByTestId('native-document').getByText('Desktop guide', { exact: true }).first()).toBeVisible();
}
async function styles(locator: Locator) {
  return locator.evaluate((node) => {
    const css = getComputedStyle(node);
    return { color: css.color, background: css.backgroundColor, borderRadius: css.borderRadius, padding: css.padding };
  });
}
async function goTo(page: Page, text: string) {
  const main = page.getByRole('main', { name: /^Slide/ });
  for (let attempt = 0; attempt < 15; attempt++) {
    if (await main.getByText(text, { exact: true }).count()) return main;
    await page.getByRole('button', { name: 'Next slide' }).click();
  }
  throw new Error(`No slide with ${text}`);
}

test('preserves native mentions, page links, rich text and list formatting', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await openFixture(page);
  const native = page.getByTestId('native-document');
  const nativeMention = native.locator('[data-mention-id="desktop-guide"]').first();
  const mentionStyles = await styles(nativeMention);
  const beforeLoads = JSON.parse((await page.locator('html').getAttribute('data-metadata-loads')) ?? '{}') as Record<
    string,
    number
  >;
  const nativeColor = await native
    .getByText('quick start', { exact: false })
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  await page.getByRole('button', { name: 'Present document', exact: true }).click();
  const main = await goTo(page, 'Welcome to AppFlowy');
  const mention = main.locator('[data-mention-id="desktop-guide"]').first();
  await expect(mention).toContainText('Desktop guide');
  expect(await styles(mention)).toEqual(mentionStyles);
  await expect(mention.locator('.mention-icon')).toContainText('✏️');
  await expect(mention.locator('.link-arrow-overlay')).toHaveCount(1);
  await expect(main.getByText('quick start', { exact: false }).first()).toHaveCSS('color', nativeColor);
  await expect(main.locator('.subpage [data-mention-id="web-guide"]')).toContainText('Web guide');
  await expect(main.locator('.subpage .link-arrow-overlay')).toHaveCount(0);
  await expect(main.locator('.ps-doc-fallback')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/presentation/document-formats-mentions.png', animations: 'disabled' });
  const formatted = await goTo(page, 'Document formatting');
  await expect(formatted.locator('.mention-person')).toHaveText('@Alex');
  await expect(formatted.locator('.formula-inline .katex')).toBeVisible();
  await expect(formatted.getByText('@10/22/2026', { exact: true })).toBeVisible();
  await expect(formatted.locator('strong', { hasText: 'Bold' })).toBeVisible();
  await expect(formatted.locator('em', { hasText: 'italic' })).toBeVisible();
  await expect(formatted.locator('u', { hasText: 'underlined' })).toBeVisible();
  await expect(formatted.locator('s', { hasText: 'struck' })).toBeVisible();
  await expect(formatted.getByRole('link', { name: 'Visit AppFlowy' })).toHaveCSS('color', 'rgb(182, 36, 36)');
  await expect(formatted.locator('.ps-doc-marker').filter({ hasText: '1.' })).toBeVisible();
  await expect(formatted.locator('.ps-doc-marker').filter({ hasText: '2.' })).toBeVisible();
  await expect(formatted.getByText('Completed task')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(formatted.locator('blockquote')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(formatted.locator('[contenteditable="true"]')).toHaveCount(0);
  const afterLoads = JSON.parse((await page.locator('html').getAttribute('data-metadata-loads')) ?? '{}') as Record<
    string,
    number
  >;
  for (const [id, count] of Object.entries(beforeLoads)) expect(afterLoads[id] - count).toBe(1);
  await expect(page.locator('html')).toHaveAttribute('data-updates', '0');
  await page.getByRole('button', { name: 'Exit presentation' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-unchanged', 'true');
  expect(errors).toEqual([]);
});

test('uses exactly the native callout palettes, icons and frames in both themes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await openFixture(page);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-dark-mode', String(theme === 'dark'));
    const native = page.getByTestId('native-document').getByTestId('callout');
    const expected = await Promise.all([0, 1, 2, 3].map((i) => styles(native.nth(i))));
    await page.getByRole('button', { name: 'Present document', exact: true }).click();
    const main = await goTo(page, 'Callouts');
    const callouts = main.getByTestId('callout');
    await expect(callouts).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      expect(await styles(callouts.nth(i))).toEqual(expected[i]);
      await expect(callouts.nth(i)).toBeInViewport();
    }
    await expect(callouts.nth(0).locator('.ps-callout-symbol svg')).toBeVisible();
    await expect(callouts.nth(0)).toContainText('Desktop guide');
    await expect(callouts.nth(0)).toContainText('Nested content keeps the callout indentation.');
    await expect(callouts.nth(1).locator('.ps-callout-symbol')).toHaveText('⚠️');
    await expect(callouts.nth(2)).toHaveAttribute('data-callout-icon', 'removed');
    await expect(callouts.nth(2).locator('.ps-callout-symbol')).toHaveCount(0);
    await expect(callouts.nth(3).locator('.ps-callout-symbol')).toHaveText('💡');
    await page.screenshot({
      path: `test-results/presentation/document-formats-callouts-${theme}.png`,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(main.getByTestId('callout').nth(0)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Exit presentation' }).click();
  }
  expect(errors).toEqual([]);
});

test('shows native no-access mentions and opens allowed page links without editing', async ({ page }) => {
  await openFixture(page, '?denied=1');
  await page.getByRole('button', { name: 'Present document', exact: true }).click();
  const main = await goTo(page, 'Welcome to AppFlowy');
  await expect(main.locator('[data-mention-id="mobile-guide"] .mention-unpublished')).toBeVisible();
  await main.locator('[data-mention-id="desktop-guide"]').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-navigated', 'desktop-guide');
  await expect(page.locator('html')).toHaveAttribute('data-unchanged', 'true');
});
