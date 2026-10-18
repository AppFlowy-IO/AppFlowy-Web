import { expect, test } from '@playwright/test';

for (const level of [0, 1, 2, 3]) {
  test(`callout toggle ${level} matches Figma and keeps its body editable`, async ({ page }, info) => {
    await page.goto(`/iframe.html?id=editor-blocks-callout--toggles&viewMode=story&theme=${info.project.name}`);
    const callout = page.getByTestId('callout').nth(level);
    const toggle = callout.locator('.toggle-list').first();
    const title = toggle.locator(':scope > .text-element > .text-content');
    const arrow = toggle.getByTestId('toggle-icon').first();
    const hint = toggle.getByTestId('toggle-list-empty');

    await expect(title).toBeVisible();
    await expect(arrow).toHaveCSS('width', '24px');
    await expect(arrow).toHaveCSS('height', '24px');
    await expect(arrow.locator('svg')).toHaveCSS('width', '20px');
    await expect(arrow.locator('svg')).toHaveCSS('height', '20px');
    await expect(title).toHaveCSS('font-size', `${[16, 32, 28, 24][level]}px`);
    await expect(title).toHaveCSS('line-height', `${[24, 44, 42, 36][level]}px`);
    await expect(hint).toHaveCSS('height', '24px');
    await expect(hint).toHaveText('Empty toggle. Click to add content');
    const titleRect = (await title.boundingBox())!;
    const arrowRect = (await arrow.boundingBox())!;
    const hintRect = (await hint.boundingBox())!;

    expect(titleRect.x - arrowRect.x - arrowRect.width).toBeCloseTo(4);
    expect(arrowRect.y + arrowRect.height / 2).toBeCloseTo(titleRect.y + titleRect.height / 2);
    expect(hintRect.x + 4).toBeCloseTo(titleRect.x);
    expect(hintRect.y - titleRect.y - titleRect.height).toBeCloseTo(6);

    // Hovering the title offers the outer callout handle, never an inner title menu.
    await expect(async () => {
      await page.mouse.move(0, 0);
      await title.hover();
      const controls = page.getByTestId('hover-controls');

      await expect(controls).toHaveCSS('opacity', '1', { timeout: 500 });
      const controlsRect = (await controls.boundingBox())!;
      const calloutRect = (await callout.boundingBox())!;

      expect(controlsRect.x + controlsRect.width).toBeLessThanOrEqual(calloutRect.x + 1);
    }).toPass();
    await page.getByTestId('drag-block').click();
    await expect(
      page.getByTestId('controls-menu').getByRole('button', { name: 'Quick Style', exact: true })
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await arrow.click();
    await expect(hint).toHaveCount(0);
    await arrow.click();
    await hint.click();
    await page.keyboard.type('Nested toggle body');
    const body = toggle.getByText('Nested toggle body', { exact: true });

    await expect(body).toBeVisible();
    const bodyRect = (await body.boundingBox())!;

    expect(bodyRect.x).toBeCloseTo(titleRect.x);
    await arrow.click();
    await expect(body).not.toBeVisible();
    await arrow.click();
    await expect(body).toBeVisible();

    // Body lines keep their own menu inside the callout.
    await expect(async () => {
      await page.mouse.move(0, 0);
      await body.hover();
      const controls = page.getByTestId('hover-controls');

      await expect(controls).toHaveCSS('opacity', '1', { timeout: 500 });
      const controlsRect = (await controls.boundingBox())!;
      const calloutRect = (await callout.boundingBox())!;
      const handleRect = (await page.getByTestId('drag-block').boundingBox())!;
      const textRect = (await body.boundingBox())!;

      expect(controlsRect.x + controlsRect.width).toBeGreaterThan(calloutRect.x + 32);
      expect(handleRect.y + handleRect.height / 2).toBeCloseTo(textRect.y + textRect.height / 2, 0);
    }).toPass();
    await page.getByTestId('drag-block').click();
    await expect(
      page.getByTestId('controls-menu').getByRole('button', { name: 'Turn into', exact: true })
    ).toBeVisible();
    await expect(
      page.getByTestId('controls-menu').getByRole('button', { name: 'Quick Style', exact: true })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/callout-toggle-${level}-${info.project.name}.png` });
  });
}
