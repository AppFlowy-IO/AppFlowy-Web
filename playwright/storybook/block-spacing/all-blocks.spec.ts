import { expect, test } from '@playwright/test';

// Desktop's default margin is 6px at the top. Some builders override it,
// or render a structural container without applying configuration.margin.
function margins(id: string): [number, number] {
  const heading = id.match(/(?:heading|toggle-heading)-(\d)$/);

  if (heading) return [[32, 24, 16, 12, 8, 4][Number(heading[1]) - 1], 0];
  if (id === 'all-toggle_list') return [4, 0];
  if (id === 'all-ai_meeting_speaker') return [4, 12];
  if (['all-table', 'all-simple_columns', 'all-ai_meeting_summary', 'all-ai_meeting_notes'].includes(id)) return [0, 0];
  return [6, 0];
}

for (const width of [1200, 600]) {
  test(`all desktop block spacing at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('https://api.microlink.io/**', (route) =>
      route.fulfill({ json: { data: { title: 'Bookmark', description: 'Fixed preview' } } })
    );
    await page.goto(`/iframe.html?id=editor-block-spacing--all-blocks&viewMode=story&theme=${testInfo.project.name}`);
    const block = (id: string) => page.locator(`[data-block-id="${id}"]`);

    await expect(block('all-paragraph')).toBeVisible({ timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    const ids = await page
      .locator('[data-block-id$="-before"]')
      .evaluateAll((elements) => elements.map((el) => el.getAttribute('data-block-id')!.slice(0, -'-before'.length)));

    expect(ids).toHaveLength(55);
    for (const id of ids) {
      const node = block(id);
      const [top, bottom] = margins(id);

      await expect(node, id).toBeVisible();
      await expect(node, id).toHaveCSS('margin-top', `${top}px`);
      await expect(node, id).toHaveCSS('margin-bottom', `${bottom}px`);
      const before = (await block(`${id}-before`).boundingBox())!;
      const current = (await node.boundingBox())!;
      const after = (await block(`${id}-after`).boundingBox())!;

      expect(current.y - before.y - before.height, `${id}: preceding gap`).toBeCloseTo(top);
      expect(after.y - current.y - current.height, `${id}: following gap`).toBeCloseTo(bottom + 6);
      for (const surface of await node
        .locator(':scope > div, :scope > div > .embed-block, :scope > div > .container-bg')
        .all()) {
        await expect(surface, `${id}: no duplicate top margin`).toHaveCSS('margin-top', '0px');
        await expect(surface, `${id}: no duplicate bottom margin`).toHaveCSS('margin-bottom', '0px');
      }
    }

    for (const type of ['bulleted_list', 'numbered_list', 'todo_list']) {
      for (const id of [`all-${type}`, `all-callout-${type}`]) {
        const marker = block(id).locator('.text-block-icon');

        await expect(marker).toHaveCSS('width', '26px');
        await expect(marker).toHaveCSS('flex-basis', '26px');
        await expect(marker).toHaveCSS('height', '22px');
        await expect(marker).toHaveCSS('min-height', '22px');
      }
    }

    await expect(block('all-gallery-loaded').locator('.embed-block')).toHaveCSS('padding', '0px');
    await expect(block('all-code').locator('.code-block-surface')).toHaveCSS('height', '81px');
    await expect(block('all-code').locator('.code-block-body')).toHaveCSS('padding', '8px 20px 22px');
    await expect(block('all-code').locator('.code-block-source')).toHaveCSS('line-height', '21px');
    await expect(block('all-simple_columns').locator(':scope > div')).toHaveCSS('gap', '6px');
    await expect(block('column-left')).toHaveCSS('margin-top', '0px');
    await expect(block('all-simple-first')).toHaveCSS('margin-top', '0px');
    await expect(block('all-simple-second')).toHaveCSS('margin-top', '6px');
    await expect(block('all-cell-heading')).toHaveCSS('margin-top', '24px');
    await expect(block('all-cell-quote-child')).toHaveCSS('margin-left', '24px');
    await expect(block('all-legacy-text')).toHaveCSS('margin-top', '6px');
    await expect(block('all-cell-toggle')).toHaveCSS('margin-top', '4px');
    await expect(block('all-ai_meeting_transcription').locator(':scope > div')).toHaveCSS('padding-inline', '32px');
    await expect(block('all-nested-quote').locator('.quote-rail')).toHaveCSS('width', '3px');
    await expect(block('quote-child')).toHaveCSS('margin-left', '0px');
    await expect(block('quote-grandchild')).toHaveCSS('margin-left', '50px');
    for (const surface of await page.locator('[data-media-placeholder="true"], [data-file-row]').all()) {
      await expect(surface).toHaveCSS('padding', '8px 12px');
    }

    for (const type of ['audio', 'video', 'google_drive']) {
      await expect(block(`all-${type}`).locator('[data-media-placeholder="true"]')).toHaveCSS('min-height', '44px');
    }

    for (const type of ['image', 'multi_image']) {
      await expect(block(`all-${type}`).locator('[data-media-placeholder="true"]')).toHaveCSS('min-height', '40px');
    }

    await expect(block('all-file').locator('[data-file-row]')).toHaveCSS('min-height', '44px');
    await expect(block('all-sub_page').locator('.subpage')).toHaveCSS('height', '32px');
    await expect(block('all-linked_page').locator('.subpage')).toHaveCSS('height', '32px');
  });
}
