import { expect, test, type Page } from '@playwright/test';

import { openDocumentSourceFixture } from '../../support/presentation-document-source';

// Use the real window size rather than a fixed emulated viewport.
test.use({ viewport: null });

async function openDocumentFixture(page: Page) {
  await openDocumentSourceFixture(page);
  await expect(page.getByRole('button', { name: 'Present document', exact: true })).toBeEnabled();
}

async function expectFullscreen(page: Page, active: boolean) {
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(active);
  if (active) {
    await expect(page.locator(':fullscreen .ps-fullscreen-control button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(':fullscreen .ps-fullscreen-control')).toBeHidden();
    await expect(page.locator('.ps-presenter > header')).toBeHidden();
    await expect(page.locator('.ps-presenter > footer')).toBeHidden();
  } else {
    await expect(page.getByRole('button', { name: /^(Enter fullscreen|Present mind map fullscreen)$/ })).toBeEnabled();
  }
}

test('document slideshow shows only the slide, navigates by keyboard, and restores controls on Escape', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openDocumentFixture(page);
  await page.getByRole('button', { name: 'Present document', exact: true }).last().click();
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expectFullscreen(page, true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const box = document.fullscreenElement!.querySelector('main')!.getBoundingClientRect();
        return (
          box.x === 0 && box.y === 0 && Math.abs(box.width - innerWidth) <= 1 && Math.abs(box.height - innerHeight) <= 1
        );
      })
    )
    .toBe(true);
  await page.keyboard.press('ArrowRight');
  const main = page.getByRole('main', { name: /^Slide \d+ of/ });
  await expect(main).toHaveCSS('border-radius', '0px');
  await expect(main).toHaveCSS('outline-style', 'none');
  const heading = await main.locator('h2').first().textContent();
  await page.screenshot({ path: 'test-results/presentation/fullscreen-document.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expectFullscreen(page, false);
  await expect(page.locator('.ps-presenter > header')).toBeVisible();
  await expect(page.locator('.ps-presenter > footer')).toBeVisible();
  await expect(main).toContainText(heading!);
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expectFullscreen(page, true);
  await page.keyboard.press('Escape');
  await expectFullscreen(page, false);
  await expect(main).toContainText(heading!);
  await page.getByRole('button', { name: 'Exit presentation' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.getByRole('button', { name: 'Present document', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('shows a rejected fullscreen request and allows retrying through the same button', async ({ page }) => {
  await page.addInitScript(() => {
    const request = Element.prototype.requestFullscreen;
    let rejected = false;
    Element.prototype.requestFullscreen = function (options) {
      document.documentElement.dataset.fullscreenNavigationUi = options?.navigationUI;
      if (!rejected) {
        rejected = true;
        return Promise.reject(new TypeError('Fullscreen permission denied'));
      }
      return request.call(this, options);
    };
  });
  await openDocumentFixture(page);
  await page.getByRole('button', { name: 'Present document', exact: true }).last().click();
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect(page.getByRole('alert')).toContainText('Couldn’t enter fullscreen');
  await expectFullscreen(page, false);
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expectFullscreen(page, true);
  await expect(page.locator('html')).toHaveAttribute('data-fullscreen-navigation-ui', 'hide');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expectFullscreen(page, false);
});

test('fullscreen stays open inside the native app theme and nested dialogs without outlining slides', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/presentation-fullscreen-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/presentation-fullscreen.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto('/presentation-fullscreen-fixture');
  await page.getByRole('button', { name: 'Present document', exact: true }).click();
  await page.getByRole('button', { name: 'Next slide' }).click();
  const main = page.getByRole('main', { name: /^Slide \d+ of/ });
  await expect(main).toBeFocused();
  await expect(main).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('ArrowRight');
  await expect(main).toHaveCSS('outline-style', 'none');
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expectFullscreen(page, true);
  await page.keyboard.press('ArrowRight');
  await expectFullscreen(page, true);
  await page.keyboard.press('Escape');
  await expectFullscreen(page, false);
  await page.getByRole('button', { name: 'Exit presentation' }).click();
  await expect(page.getByRole('button', { name: 'Present document', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
