import { expect, test } from '@playwright/test';

test('presenter buttons retain native Space activation and arrows keep navigating', async ({ page }) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  // Keep the controls visible and exercise dialog keyboard behavior independently of browser fullscreen policy.
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
  });
  await page.route('**/presentation-deck-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/presentation-deck.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto('/presentation-deck-fixture');
  await page.getByRole('button', { name: 'Open saved deck' }).click();
  const presenter = page.locator('.ps-presenter');

  await expect(presenter).toContainText('1 / 3');
  await presenter.getByRole('button', { name: 'Next slide', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(presenter).toContainText('2 / 3');
  await presenter.getByRole('button', { name: 'Previous slide', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(presenter).toContainText('1 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(presenter).toContainText('2 / 3');
  await presenter.getByRole('button', { name: 'Enter fullscreen', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(presenter.getByRole('alert')).toContainText('Fullscreen is unavailable');
  await expect(presenter).toContainText('2 / 3');
  await presenter.getByRole('button', { name: 'Exit presentation', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(presenter).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
