import { expect, test, type Page, type Locator } from '@playwright/test';

async function openFixture(page: Page, mode = '') {
  await page.route('**/presentation-outline-fixture*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body id="body"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/presentation-outline.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto(`/presentation-outline-fixture?mode=${mode}`);
  await expect(page.getByTestId('native-document').locator('.outline-block')).toBeVisible();
}
async function present(page: Page) {
  await page.getByRole('button', { name: 'Present document', exact: true }).click();
  await page.getByRole('button', { name: 'Next slide' }).click();
  const main = page.getByRole('main', { name: /^Slide/ });
  await expect(main.locator('.outline-block')).toBeVisible();
  return main;
}
async function style(locator: Locator) {
  return locator.evaluate((element) => {
    const css = getComputedStyle(element);
    return { color: css.color, background: css.backgroundColor, radius: css.borderRadius };
  });
}

test('renders the native table of contents, hierarchy, colors, depth and inline labels in both themes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await openFixture(page);
  const native = page.getByTestId('native-document').locator('.outline-block');
  const nativeStyle = await style(native);
  const labels = await native.locator('[data-outline-heading]').allTextContents();
  const main = await present(page);
  const toc = main.locator('.outline-block');
  expect(await toc.locator('[data-outline-heading]').allTextContents()).toEqual(labels);
  await expect(toc).toContainText('Ada x^2');
  await expect(toc).not.toContainText('Deeper detail');
  await expect(main.locator('.ps-doc-fallback')).toHaveCount(0);
  expect(await style(toc)).toEqual(nativeStyle);
  const intro = await toc
    .getByRole('button', { name: 'Introduction', exact: true })
    .locator(':scope > div')
    .last()
    .boundingBox();
  const detail = await toc
    .getByRole('button', { name: 'Details', exact: true })
    .locator(':scope > div')
    .last()
    .boundingBox();
  expect(detail!.x - intro!.x).toBe(12);
  await page.screenshot({ path: 'test-results/presentation/outline-light.png', animations: 'disabled' });
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'true');
  expect(await style(toc)).toEqual(await style(native));
  await page.screenshot({ path: 'test-results/presentation/outline-dark.png', animations: 'disabled' });
  await toc.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Details', exact: true })).toBeInViewport();
  await expect(main).toContainText('Detail content.');
  expect(errors).toEqual([]);
});

test('jumps to nested headings in the correct continuation and only expands the presentation copy', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 650 });
  await openFixture(page);
  const main = await present(page);
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await main.getByRole('button', { name: 'Nested target', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(main.getByRole('heading', { name: 'Nested target', exact: true })).toBeInViewport();
  await expect(main.locator('details')).toHaveAttribute('open', '');
  await expect(page.locator('.ps-presenter > header')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Exit presentation' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-unchanged', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-updates', '0');
});

test('continues a long table of contents across slides without losing entries', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 650 });
  await openFixture(page, 'long');
  const main = await present(page);
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const visible = await main.evaluate((area) => {
      const viewport = area.getBoundingClientRect();
      return Array.from(area.querySelectorAll<HTMLElement>('[data-outline-heading]'))
        .filter((entry) => {
          const box = entry.getBoundingClientRect();
          return box.top >= viewport.top && box.bottom <= viewport.bottom;
        })
        .map((entry) => entry.textContent!);
    });
    visible.forEach((label) => seen.add(label));
    if (seen.has('Section 40')) break;
    await page.getByRole('button', { name: 'Next slide' }).click();
  }
  expect([...seen]).toEqual(Array.from({ length: 40 }, (_, index) => `Section ${index + 1}`));
  await main.getByRole('button', { name: 'Section 40', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Section 40', exact: true })).toBeInViewport();
});

for (const mode of ['empty', 'filtered']) {
  test(`shows AppFlowy's native ${mode} outline state`, async ({ page }) => {
    await openFixture(page, mode);
    const nativeText = await page.getByTestId('native-document').locator('.outline-block').textContent();
    const main = await present(page);
    await expect(main.locator('.outline-block')).toHaveText(nativeText!);
    await expect(main.locator('.ps-doc-fallback')).toHaveCount(0);
  });
}
