import { expect, test, type Page } from '@playwright/test';

async function openFixture(page: Page, query = '') {
  await page.route('**/presentation-database-fixture*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body id="body"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/presentation-database.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto(`/presentation-database-fixture${query}`);
  await page.getByRole('button', { name: 'Present document', exact: true }).click();
  // The hidden pagination ruler must not load every linked database.
  await expect(page.locator('html')).toHaveAttribute('data-loads', '0');
  await page.getByRole('button', { name: 'Next slide' }).click();
}

test('renders the native linked grid with filters, sorting, colors, hidden fields and read-only tabs', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await openFixture(page);
  const main = page.getByRole('main', { name: /^Slide/ });
  await expect(main.getByTestId('database-grid')).toBeVisible();
  await expect(main.getByText('Milestone 35', { exact: true })).toBeVisible();
  await expect(main.getByTestId('database-grid')).toHaveAttribute('data-row-count', '35');
  await expect(main.getByText('Excluded row', { exact: true })).toHaveCount(0);
  await expect(main.getByText('Private notes', { exact: true })).toHaveCount(0);
  await expect(main.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-loads', '1');
  await expect(main.getByTestId('database-actions-container')).toBeHidden();
  const bounds = await main.locator('.ps-document-database').boundingBox();
  const slideBounds = await main.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(slideBounds!.y + slideBounds!.height);
  await expect(main.locator('[style*="--tag-fill-07-light"]').first()).not.toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
  await page.screenshot({ path: 'test-results/presentation/linked-database-grid.png' });
  await expect(main.getByText('Milestone 35', { exact: true })).toBeInViewport();
  await expect(page.locator('html')).toHaveAttribute('data-row-fetches', '1');
  await main.getByTestId('database-grid').locator('.appflowy-custom-scroller').first().hover();
  await page.mouse.wheel(0, 2000);
  await expect(main.getByText('Milestone 01', { exact: true })).toBeInViewport();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'true');
  await expect(main.getByRole('tab', { name: 'Milestones', exact: true })).toHaveCSS('color', 'rgb(228, 232, 245)');
  await page.screenshot({ path: 'test-results/presentation/linked-database-dark.png', animations: 'disabled' });
  await main.getByText('Work list', { exact: true }).click();
  await expect(main.getByTestId('database-grid')).toHaveCount(0);
  await expect(main.getByText('Milestone 35', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-loads', '1');
  await expect(page.locator('html')).toHaveAttribute('data-updates', '0');
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.locator('.ps-presenter > header')).toBeHidden();
  await expect(main.getByText('Milestone 35', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Next slide' }).click();
  await expect(main).toContainText('The next part of the presentation.');
  await expect(page.locator('.ps-document-database')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('honors legacy linked view IDs', async ({ page }) => {
  await openFixture(page, '?legacy=1');
  await expect(page.getByTestId('database-grid')).toBeVisible();
  await expect(page.getByText('Milestone 35', { exact: true })).toBeVisible();
});

test('does not fetch or expose a linked database when source access is denied', async ({ page }) => {
  await openFixture(page, '?denied=1');
  await expect(page.getByRole('main')).toContainText('You don’t have access to this linked database.');
  await expect(page.getByTestId('database-grid')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-loads', '0');
  await expect(page.locator('html')).toHaveAttribute('data-row-fetches', '0');
  await page.getByRole('button', { name: 'Next slide' }).click();
  await expect(page.getByRole('main')).toContainText('The next part of the presentation.');
});
