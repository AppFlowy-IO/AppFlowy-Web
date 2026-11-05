import { expect, test } from '@playwright/test';

for (const width of [1200, 600]) {
  test(`nested list backgrounds keep a bottom inset at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      `/iframe.html?id=editor-block-spacing--nested-backgrounds&viewMode=story&theme=${testInfo.project.name}`
    );
    const block = (id: string) => page.locator(`[data-block-id="${id}"]`);
    const background = (id: string) => block(id).locator(':scope > div');

    await expect(block('todo-background')).toBeVisible({ timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    for (const prefix of ['todo-background', 'toggle-background']) {
      for (const [parentId, childId] of [
        [prefix, `${prefix}-last`],
        [`${prefix}-nested`, `${prefix}-middle`],
        [`${prefix}-middle`, `${prefix}-deepest`],
      ]) {
        const parent = background(parentId);
        const child = background(childId);

        await expect(parent).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(child).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(parent).toHaveCSS('padding-bottom', '2px');
        const parentBounds = (await parent.boundingBox())!;
        const childBounds = (await child.boundingBox())!;

        expect(parentBounds.y + parentBounds.height - childBounds.y - childBounds.height).toBeCloseTo(2);
      }

      await expect(background(`${prefix}-leaf`)).toHaveCSS('padding-bottom', '0px');
      const parentBounds = (await background(prefix).boundingBox())!;
      const afterBounds = (await block(`${prefix}-after`).boundingBox())!;

      expect(afterBounds.y - parentBounds.y - parentBounds.height).toBeCloseTo(6);
    }

    const toggle = background('toggle-background');
    const arrow = toggle.locator(':scope > .text-element > .toggle-icon');

    await arrow.click();
    await expect(toggle).toHaveClass(/collapsed/);
    await expect(block('toggle-background-last')).not.toBeVisible();
    await expect(toggle).toHaveCSS('padding-bottom', '0px');
    await arrow.click();
    await expect(block('toggle-background-last')).toBeVisible();
    await expect(toggle).toHaveCSS('padding-bottom', '2px');
  });
}
