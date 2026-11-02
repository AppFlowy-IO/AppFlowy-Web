import { expect, test, type Page } from '@playwright/test';

async function openFixture(page: Page) {
  await page.route('**/presentation-code-math-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body id="body"><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import('/playwright/support/presentation-code-math.fixture.tsx');
  </script></body></html>`,
    })
  );
  await page.goto('/presentation-code-math-fixture');
  await page.getByRole('button', { name: 'Present document', exact: true }).click();
}
async function goTo(page: Page, heading: string) {
  const main = page.getByRole('main', { name: /^Slide/ });
  for (let i = 0; i < 30; i++) {
    if (await main.getByRole('heading', { name: heading, exact: true }).count()) return main;
    await page.getByRole('button', { name: 'Next slide' }).click();
  }
  throw new Error(`Missing ${heading}`);
}

test('typesets native equation blocks, multiline math, error states and fullscreen without changing the source', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await openFixture(page);
  const main = await goTo(page, 'Equations');
  await expect(main.locator('.katex-display')).toHaveCount(3);
  await expect(main.locator('.ps-doc-fallback')).toHaveCount(0);
  await expect(main.locator('.katex-display').first()).toBeInViewport();
  await expect(main.locator('annotation').nth(0)).toHaveText(String.raw`\frac{-b \pm \sqrt{b^2-4ac}}{2a}`);
  await expect(main.locator('annotation').nth(2)).toContainText(String.raw`\begin{array}{l}`);
  await expect(main.locator('.katex').first()).toHaveCSS('font-size', '20px');
  await page.screenshot({ path: 'test-results/presentation/equations-light.png', animations: 'disabled' });
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'false');
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'true');
  await expect(main.locator('.katex').first()).toHaveCSS('color', 'rgb(228, 232, 245)');
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(main.locator('.katex-display')).toHaveCount(3);
  await expect(page.locator('.ps-presenter > header')).toBeHidden();
  await page.screenshot({ path: 'test-results/presentation/equations-fullscreen-dark.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await goTo(page, 'Invalid equation');
  await expect(main.getByRole('status')).toContainText('Undefined control sequence');
  await expect(main).toContainText('The rest of the document remains readable.');
  await goTo(page, 'Finished');
  await page.getByRole('button', { name: 'Exit presentation' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-unchanged', 'true');
  expect(errors).toEqual([]);
});

test('renders code with the native surface, local syntax highlighting, language labels and exact whitespace', async ({
  page, baseURL,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL!).origin)
      external.push(request.url());
  });
  await openFixture(page);
  const main = await goTo(page, 'TypeScript');
  await expect(main.locator('[data-code-language="typescript"] .token.keyword').first()).toHaveText('interface');
  await expect(main.locator('.ps-code-heading')).toContainText('TypeScript');
  await expect(main.locator('pre')).toHaveCSS('background-color', 'rgb(249, 250, 253)');
  await expect(main.locator('pre')).toHaveCSS('border-radius', '8px');
  await expect(main.locator('pre')).toHaveCSS('padding-top', '48px');
  await expect(main.locator('.token.keyword').first()).toHaveCSS('color', 'rgb(0, 119, 170)');
  await page.screenshot({ path: 'test-results/presentation/code-light.png', animations: 'disabled' });
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'false');
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect(main.locator('pre')).toHaveCSS('background-color', 'rgb(60, 69, 87)');
  await expect(main.locator('.token.keyword').first()).toHaveCSS('color', 'rgb(209, 148, 158)');
  await page.screenshot({ path: 'test-results/presentation/code-dark.png', animations: 'disabled' });
  await goTo(page, 'Python');
  await expect(main.locator('[data-code-language="python"] .token.keyword').first()).toHaveText('def');
  expect(await main.locator('pre code').textContent()).toBe(
    'def total(values):\n    # Keep the original indentation\n    return sum(value ** 2 for value in values)\n\nprint(total([1, 2, 3]))'
  );
  await expect(main.locator('[contenteditable="true"]')).toHaveCount(0);
  await goTo(page, 'Plain source');
  expect(await main.locator('pre code').textContent()).toBe(
    '<script>window.presentationInjected = true</script>\n\tUntouched whitespace'
  );
  expect(await page.evaluate(() => 'presentationInjected' in window)).toBe(false);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('keeps wide math and long code lines reachable and renders Mermaid code as a diagram', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 650 });
  await openFixture(page);
  const main = await goTo(page, 'Wide content');
  const math = main.locator('.math-equation-render');
  await expect(math.locator('.katex')).toBeVisible();
  expect(await math.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await math.hover();
  await page.mouse.wheel(3000, 0);
  await expect.poll(() => math.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const code = main.locator('pre');
  await expect(code).toBeVisible();
  expect(await code.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await code.hover();
  await page.mouse.wheel(10000, 0);
  await expect.poll(() => code.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await goTo(page, 'Diagram');
  await expect(main.locator('pre .mermaid-diagram > svg')).toBeVisible({ timeout: 20000 });
  await expect(main.locator('pre')).toContainText('Source document');
  await expect(main.locator('pre')).toContainText('Presentation');
  await page.screenshot({ path: 'test-results/presentation/code-diagram.png', animations: 'disabled' });
});
