import { expect, test } from '@playwright/test';

for (const width of [1200, 600]) {
  test(`document spacing at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('https://api.microlink.io/**', (route) =>
      route.fulfill({ json: { data: { title: 'Bookmark', description: 'Deterministic bookmark preview' } } })
    );
    await page.goto(`/iframe.html?id=editor-block-spacing--default&viewMode=story&theme=${testInfo.project.name}`);
    const block = (id: string) => page.locator(`[data-block-id="${id}"]`);

    await expect(block('paragraph-one')).toBeVisible({ timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    for (const id of ['paragraph-one', 'paragraph-two', 'bullet', 'after-divider', 'cell-second']) {
      await expect(block(id)).toHaveCSS('margin-top', '6px');
    }

    for (const [index, margin] of [32, 24, 16, 12, 8, 4].entries()) {
      await expect(block(`heading-${index + 1}`)).toHaveCSS('margin-top', `${margin}px`);
      await expect(block(`heading-${index + 1}`).locator('> .heading')).toHaveCSS('padding-top', '0px');
    }

    const callout = block('adjacent-callout').getByTestId('callout');

    await expect(callout).toHaveCSS('margin-top', '0px');
    await expect(callout).toHaveCSS('margin-bottom', '0px');
    const precedingBounds = (await block('paragraph-two').boundingBox())!;
    const calloutBounds = (await callout.boundingBox())!;
    const followingBounds = (await block('paragraph-after-callout').boundingBox())!;

    expect(calloutBounds.y - precedingBounds.y - precedingBounds.height).toBeCloseTo(6);
    expect(followingBounds.y - calloutBounds.y - calloutBounds.height).toBeCloseTo(6);

    await expect(block('toggle')).toHaveCSS('margin-top', '4px');
    await expect(block('paragraph-one').locator('.text-content')).toHaveCSS('line-height', '22.4px');
    for (const id of ['colored-paragraph', 'colored-heading']) {
      const content = block(id).locator('> div');

      await expect(content).toHaveCSS('border-radius', '4px');
      const color = await content.evaluate((el) => {
        const probe = document.createElement('span');

        probe.style.backgroundColor = 'var(--palette-bg-color-1)';
        // Keep probes outside Slate's managed DOM while inheriting the theme tokens.
        el.closest('[role="textbox"]')!.parentElement!.appendChild(probe);
        const result = getComputedStyle(probe).backgroundColor;

        probe.remove();
        return result;
      });

      expect(color).not.toBe('rgba(0, 0, 0, 0)');
      await expect(content).toHaveCSS('background-color', color);
    }

    await expect(block('code').locator('.code-block-surface')).toHaveCSS('border-radius', '8px');
    await expect(block('code').locator('.code-block-surface')).toHaveCSS(
      'background-color',
      await block('code').evaluate((el) => {
        const probe = document.createElement('span');

        probe.style.backgroundColor = 'var(--block-bg-color-20)';
        // Keep probes outside Slate's managed DOM while inheriting the theme tokens.
        el.closest('[role="textbox"]')!.parentElement!.appendChild(probe);
        const result = getComputedStyle(probe).backgroundColor;

        probe.remove();
        return result;
      })
    );
    await expect(block('bookmark').locator('.link-preview-card')).toHaveCSS('border-radius', '16px');
    await expect(block('cell-first')).toHaveCSS('margin-top', '0px');
    await expect(block('bullet-child')).toHaveCSS('margin-left', '26px');
    for (const id of ['toggle', 'toggle-heading']) {
      const title = block(id).locator('> .toggle-list > .text-element > .text-content');
      const icon = block(id).locator('> .toggle-list > .text-element > .toggle-icon');
      const child = block(`${id}-child`);

      expect(await icon.evaluate((el) => parseFloat(getComputedStyle(el).width))).toBeCloseTo(22.4, 1);
      const titleBounds = (await title.boundingBox())!;
      const childBounds = (await child.boundingBox())!;
      const iconBounds = (await icon.boundingBox())!;

      expect(iconBounds.y + iconBounds.height / 2 + 2.5).toBeCloseTo(titleBounds.y + titleBounds.height / 2, 1);
      expect(childBounds.x + 2).toBeCloseTo(titleBounds.x);
    }

    await expect(block('divider').locator('.divider-node > div[contenteditable="false"]')).toHaveCSS('height', '28px');
    const first = (await block('paragraph-one').boundingBox())!;
    const second = (await block('paragraph-two').boundingBox())!;

    expect(second.y - first.y - first.height).toBeCloseTo(6);
  });
}
