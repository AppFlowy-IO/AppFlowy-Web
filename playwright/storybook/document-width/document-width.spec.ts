import { expect, test } from '@playwright/test';

for (const [mode, width] of [['default', 952], ['full', 1600], ['fixed', 1200]] as const) {
  test(`${mode} width aligns the title and editor and fits a narrow viewport`, async ({ page }, testInfo) => {
    await page.goto(`/iframe.html?id=document-width--${mode}&viewMode=story`);
    const editor = page.getByTestId('editor-content');
    const title = page.locator('[data-view-meta-preview] h1');

    await expect(editor).toBeVisible({ timeout: 45000 });
    await expect(editor).toHaveCSS('width', `${width}px`);
    await expect(title).toHaveCSS('width', `${width}px`);
    const bodyBounds = (await editor.boundingBox())!;
    const titleBounds = (await title.boundingBox())!;

    expect(titleBounds.x).toBeCloseTo(bodyBounds.x);
    const preview = testInfo.outputPath(`width-${mode}.png`);

    await page.screenshot({ path: preview, fullPage: true });
    await testInfo.attach(`Width: ${mode}`, { path: preview, contentType: 'image/png' });
    await page.setViewportSize({ width: 600, height: 800 });
    await expect(editor).toHaveCSS('width', '600px');
    await expect(title).toHaveCSS('width', '600px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(600);
  });
}
