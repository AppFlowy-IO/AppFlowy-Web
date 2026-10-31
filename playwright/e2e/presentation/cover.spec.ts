import { expect, test, type Page } from '@playwright/test';

async function openFixture(page: Page, cover = 'built_in') {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.route('**/presentation-cover-fixture*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body id="body"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/presentation-cover.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto(`/presentation-cover-fixture?cover=${cover}`);
  await expect(page.getByRole('button', { name: 'Present document', exact: true })).toBeVisible();
}

for (const type of ['built_in', 'custom', 'unsplash']) {
  test(`preserves the native ${type} cover and crop on the title slide only`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, type);
    const source = page.locator('[data-view-meta-preview] img');
    await expect.poll(() => source.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const expected = await source.evaluate((img: HTMLImageElement) => ({
      src: img.src,
      position: getComputedStyle(img).objectPosition,
      fit: getComputedStyle(img).objectFit,
    }));
    await page.getByRole('button', { name: 'Present document', exact: true }).click();
    const main = page.getByRole('main', { name: 'Slide 1 of 2' });
    const image = main.locator('.ps-doc-cover img');
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect(
      await image.evaluate((img: HTMLImageElement) => ({
        src: img.src,
        position: getComputedStyle(img).objectPosition,
        fit: getComputedStyle(img).objectFit,
      }))
    ).toEqual(expected);
    await expect(image).toBeInViewport({ ratio: 1 });
    await expect(main.getByRole('heading', { level: 1 })).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.ps-doc-measure img')).toHaveCount(0);
    if (type === 'built_in') {
      await page.screenshot({ path: 'test-results/presentation/cover-light.png', animations: 'disabled' });
      await page.keyboard.press('ControlOrMeta+Shift+L');
      await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'true');
      await page.getByRole('button', { name: 'Enter fullscreen' }).click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
      await expect(page.locator('.ps-presenter > header')).toBeHidden();
      await expect(main.getByRole('heading', { level: 1 })).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: 'test-results/presentation/cover-dark-fullscreen.png', animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
      await page.setViewportSize({ width: 900, height: 600 });
      await expect(main).toBeVisible();
      await expect(main.getByRole('heading', { level: 1 })).toBeInViewport({ ratio: 1 });
      await expect.poll(() => main.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    }
    await page.getByRole('button', { name: 'Next slide' }).click();
    await expect(page.getByRole('main')).toHaveText('The document continues here.');
    await expect(page.getByRole('main').locator('.ps-doc-cover')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('matches native color and gradient covers in light and dark themes', async ({ page }) => {
  for (const type of ['color', 'gradient']) {
    await openFixture(page, type);
    const source = page.locator('[data-view-meta-preview] > div').first().locator(':scope > div').first();
    await page.getByRole('button', { name: 'Present document', exact: true }).click();
    for (const dark of [false, true]) {
      if ((await page.locator('html').getAttribute('data-dark-mode')) !== String(dark)) {
        await page.keyboard.press('ControlOrMeta+Shift+L');
      }
      await expect(page.locator('html')).toHaveAttribute('data-dark-mode', String(dark));
      const background = await source.evaluate((el) => getComputedStyle(el).background);
      expect(
        await page
          .getByRole('main')
          .locator('.ps-doc-cover > div')
          .evaluate((el) => getComputedStyle(el).background)
      ).toBe(background);
    }
  }
});

test('keeps uncovered documents unchanged and the title usable when a cover image cannot load', async ({ page }) => {
  for (const type of ['none', 'removed', 'unavailable']) {
    if (type === 'unavailable')
      await page.route('**/missing-presentation-cover.png', (route) => route.fulfill({ status: 404 }));
    await openFixture(page, type);
    await page.getByRole('button', { name: 'Present document', exact: true }).click();
    const main = page.getByRole('main', { name: 'Slide 1 of 2' });
    await expect(main.getByRole('heading', { level: 1 })).toBeInViewport({ ratio: 1 });
    await expect(main.locator('.ps-doc-cover')).toHaveCount(type === 'unavailable' ? 1 : 0);
    await page.getByRole('button', { name: 'Next slide' }).click();
    await expect(page.getByRole('main')).toHaveText('The document continues here.');
  }
});
