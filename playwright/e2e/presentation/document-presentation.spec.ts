import { expect, test } from '@playwright/test';

import { openDocumentSourceFixture } from '../../support/presentation-document-source';

const paragraphs = Array.from(
  { length: 12 },
  (_, i) =>
    `Paragraph ${i + 1}: ${'This source detail must remain readable when presenting the document. '.repeat(
      10
    )} End of paragraph ${i + 1}.`
);

async function present(page: import('@playwright/test').Page, markdown: string, theme?: string) {
  await openDocumentSourceFixture(page, theme);
  await page.getByRole('textbox', { name: 'Source content · Markdown' }).fill(markdown);
  await page.getByRole('button', { name: 'Update source snapshot' }).click();
  await page.getByRole('button', { name: 'Present document', exact: true }).last().click();
}

test('Next displays every paragraph in long sections without requiring manual scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await present(page, `## Long section\n${paragraphs.join('\n')}\n---\n## Final section\nThe last source paragraph.`);
  const seen = new Set<string>();
  const next = page.getByRole('button', { name: 'Next slide', exact: true });

  for (let i = 0; i < 40; i++) {
    const visible = await page.getByRole('main', { name: /^Slide \d+ of/ }).evaluate((main) => {
      const viewport = main.getBoundingClientRect();
      return [...main.querySelectorAll('p')]
        .filter((p) => {
          const box = p.getBoundingClientRect();
          return box.top >= viewport.top && box.bottom <= viewport.bottom;
        })
        .map((p) => p.textContent);
    });

    visible.forEach((text) => text && seen.add(text));
    if (await next.isDisabled()) break;
    await next.click();
  }

  expect([...seen]).toEqual([...paragraphs, 'The last source paragraph.']);
});

test('Next reveals every line of an oversized code block and returns to the unchanged source', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  const lines = Array.from({ length: 90 }, (_, i) => `source_line_${i + 1}: preserve_this_value`);
  const markdown = `\`\`\`\n${lines.join('\n')}\n\`\`\`\nAfter the long code block.`;

  await present(page, markdown);
  const seen = new Set<string>();
  const main = page.getByRole('main', { name: /^Slide \d+ of/ });
  const next = page.getByRole('button', { name: 'Next slide', exact: true });
  let continued = false;

  for (let i = 0; i < 40; i++) {
    // The lazy renderer initially shows a readable <pre> fallback without a <code> child.
    if (await main.locator('pre').count()) await expect(main.locator('pre code')).toBeAttached();
    const visible = await main.evaluate((area) => {
      const box = area.getBoundingClientRect();
      const pre = area.querySelector('pre');
      const code = pre?.querySelector('code');
      if (!code) return [];
      const content = code.textContent || '';
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      const texts: { node: Node; start: number; end: number }[] = [];
      let offset = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        texts.push({ node, start: offset, end: offset + (node.textContent?.length ?? 0) });
        offset += node.textContent?.length ?? 0;
      }
      return [...content.matchAll(/source_line_\d+: preserve_this_value/g)]
        .filter((match) => {
          const range = document.createRange();
          const start = texts.find((text) => text.end > match.index!)!;
          const endOffset = match.index! + match[0].length;
          const end = texts.find((text) => text.end >= endOffset)!;
          range.setStart(start.node, match.index! - start.start);
          range.setEnd(end.node, endOffset - end.start);
          const line = range.getBoundingClientRect();
          return line.top >= box.top && line.bottom <= box.bottom;
        })
        .map((match) => match[0]);
    });

    visible.forEach((line) => seen.add(line));
    continued ||= await page.getByText(/^Continued ·/).isVisible();
    if (await next.isDisabled()) break;
    await page.keyboard.press('ArrowRight');
  }
  expect([...seen]).toEqual(lines);
  expect(continued).toBe(true);
  await expect(main).toContainText('After the long code block.');
  await page.keyboard.press('ArrowLeft');
  await expect(main.locator('pre')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Source content · Markdown' })).toHaveValue(markdown);
});

test('reflows after resizing without losing the current source block or later content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await present(page, `## Long section\n${paragraphs.join('\n')}`);
  const next = page.getByRole('button', { name: 'Next slide', exact: true });
  const main = page.getByRole('main', { name: /^Slide \d+ of/ });

  await next.click();
  const anchor = await main.locator('p').first().textContent();
  await page.setViewportSize({ width: 820, height: 650 });
  await expect(main).toContainText(anchor!);
  let foundLast = false;
  for (let i = 0; i < 40; i++) {
    foundLast ||= await main.evaluate((area) => {
      const box = area.getBoundingClientRect();
      const last = [...area.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Paragraph 12:'));
      if (!last) return false;
      const rect = last.getBoundingClientRect();
      return rect.top >= box.top && rect.bottom <= box.bottom;
    });
    if (await next.isDisabled()) break;
    await next.click();
  }
  expect(foundLast).toBe(true);
  await page.screenshot({ path: 'test-results/presentation/document-final-page.png' });
});

async function presentTable(page: import('@playwright/test').Page, scenario = '', theme?: string) {
  await page.route('**/document-presentation-fixture*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/document-presentation.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto(`/document-presentation-fixture?table=${scenario}${theme ? `&theme=${theme}` : ''}`);
  await expect(page.locator('.MuiDialog-container')).toHaveCSS('opacity', '1');
}

for (const viewport of [
  { width: 2048, height: 1090 },
  { width: 1440, height: 900 },
  { width: 1100, height: 650 },
]) {
  test(`keeps the findings heading with its table and shows each row once at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await presentTable(page);
    const main = page.getByRole('main', { name: /^Slide \d+ of/ });
    const next = page.getByRole('button', { name: 'Next slide', exact: true });
    const rows: string[] = [];
    let sawHeading = false;
    let tableSlides = 0;

    for (let index = 0; index < 30; index++) {
      const heading = main.getByRole('heading', { name: 'Key findings at a glance', exact: true });
      if (await heading.count()) {
        await expect(main.getByRole('table')).toBeVisible();
        await expect(main).not.toContainText('Timeline item');
        sawHeading = true;
        tableSlides++;
        await expect(main.getByRole('columnheader')).toHaveCount(3);
        await page.screenshot({ path: `test-results/presentation/findings-${viewport.width}.png` });
      }
      const visibleRows = await main.locator('tbody tr').evaluateAll((elements) =>
        elements.map((element) => {
          const area = element.closest('main')!.getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return {
            text: element.firstElementChild!.textContent!,
            fits: box.top >= area.top && box.bottom <= area.bottom,
          };
        })
      );
      expect(visibleRows.every((row) => row.fits)).toBe(true);
      rows.push(...visibleRows.map((row) => row.text));
      if (await next.isDisabled()) break;
      await next.click();
    }
    expect(sawHeading).toBe(true);
    expect(tableSlides).toBe(1);
    expect(rows).toEqual([
      'Inference cost reduction',
      'Organizational AI adoption',
      'Global AI compute capacity growth',
      'AI agent task-horizon doubling period',
    ]);
    await expect(main).toContainText('The final source paragraph.');
  });
}

test('fits a long table into two balanced slides with repeated headers and unchanged native colors', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await presentTable(page, 'long');
  const main = page.getByRole('main', { name: /^Slide \d+ of/ });
  const next = page.getByRole('button', { name: 'Next slide', exact: true });
  const rows: string[] = [];
  const counts: number[] = [];
  const widths: number[][] = [];

  for (let index = 0; index < 30; index++) {
    if (await main.getByRole('table').count()) {
      await expect(main.getByRole('columnheader')).toHaveCount(3);
      await expect(main.getByRole('heading', { name: 'Key findings at a glance' })).toBeVisible();
      const tableRows = await main.getByRole('rowheader').allTextContents();
      rows.push(...tableRows);
      counts.push(tableRows.length);
      widths.push(
        await main.locator('thead th').evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width))
      );
      const geometry = await main.locator('.ps-table-scroll').evaluate((area) => ({
        fits: area.scrollHeight <= area.clientHeight + 1,
        font: parseFloat(getComputedStyle(area.querySelector('table')!).fontSize),
      }));
      expect(geometry.fits).toBe(true);
      expect(geometry.font).toBeGreaterThanOrEqual(16);
      await expect(main.locator('tbody tr').first().locator('td').first()).toHaveCSS('text-align', 'right');
      await expect(main.locator('tbody tr').first().locator('td').first()).toHaveCSS(
        'background-image',
        /rgb\(255, 240, 204\)/
      );
      const styledRow = main.locator('[data-table-row-id="row-8"]');
      if (await styledRow.count()) {
        await expect(styledRow.locator('td').last()).toHaveCSS('background-image', /rgb\(222, 244, 234\)/);
        await expect(styledRow.locator('td').last()).toHaveCSS('text-align', 'center');
      }
      await page.screenshot({ path: `test-results/presentation/table-continuation-${counts.length}.png` });
    }
    if (await next.isDisabled()) break;
    await next.click();
  }
  expect(counts).toHaveLength(2);
  expect(Math.abs(counts[0] - counts[1])).toBeLessThanOrEqual(1);
  expect(widths[0]).toEqual(widths[1]);
  expect(rows).toEqual(Array.from({ length: 14 }, (_, index) => `Research metric ${index + 1}`));
});

test('document backgrounds follow the current theme and update during presentation', async ({ page }) => {
  await present(page, '## Theme check\nReadable body text\n> A source quote\n```\nconst value = 42;\n```', 'dark');
  const main = page.getByRole('main', { name: /^Slide \d+ of/ });
  const next = page.getByRole('button', { name: 'Next slide' });
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'true');
  await expect(main).toHaveCSS('background-color', 'rgb(26, 32, 44)');
  await expect(main).toHaveCSS('color', 'rgb(228, 232, 245)');
  await next.click();
  await expect(main.locator('pre')).toBeVisible();
  await expect(main.locator('pre')).toHaveCSS('background-color', 'rgb(60, 69, 87)');
  // Native AppFlowy quotes have a transparent body and a themed left border.
  await expect(main.locator('blockquote')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(main.locator('blockquote')).toHaveCSS('border-left-width', '4px');
  const previous = page.getByRole('button', { name: 'Previous slide' });
  await previous.hover();
  await expect(previous).toHaveCSS('background-color', 'rgb(50, 52, 63)');
  await page.screenshot({ path: 'test-results/presentation/document-theme-dark.png', animations: 'disabled' });

  const slide = await main.getAttribute('aria-label');
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'false');
  await expect(main).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(main).toHaveCSS('color', 'rgb(33, 35, 42)');
  await expect(page.locator('.ps-presenter')).toHaveCSS('background-color', 'rgb(248, 250, 255)');
  await expect(main.locator('pre')).toHaveCSS('background-color', 'rgb(249, 250, 253)');
  await expect(main).toHaveAttribute('aria-label', slide!);
  await previous.hover();
  await expect(previous).toHaveCSS('background-color', 'rgb(248, 250, 255)');
  await page.screenshot({ path: 'test-results/presentation/document-theme-light.png', animations: 'disabled' });
});

test('table slides, pinned headers, and native palette colors follow light and dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await presentTable(page, 'theme', 'light');
  const main = page.getByRole('main', { name: /^Slide \d+ of/ });
  while (!(await main.getByRole('table').count())) await page.getByRole('button', { name: 'Next slide' }).click();
  await expect(main).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const coloredCell = main.locator('tbody tr').first().locator('td').first();
  await expect(coloredCell).toHaveCSS('background-image', /rgb\(250, 233, 195\)/);
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'true');
  await expect(main).toHaveCSS('background-color', 'rgb(26, 32, 44)');
  await expect(main.getByRole('rowheader').first()).toHaveCSS('background-color', 'rgb(26, 32, 44)');
  await expect(main.getByRole('rowheader').first()).toHaveCSS('color', 'rgb(228, 232, 245)');
  await expect(main.getByRole('columnheader').first()).toHaveCSS('background-image', /rgba\(255, 255, 255, 0.03\)/);
  await expect(coloredCell).toHaveCSS('background-image', /rgb\(144, 96, 0\)/);
  await page.screenshot({ path: 'test-results/presentation/table-theme-dark.png', animations: 'disabled' });
});

test('anchors row labels when a wide table is scrolled horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 750 });
  await presentTable(page, 'wide');
  const main = page.getByRole('main', { name: /^Slide \d+ of/ });
  while (!(await main.getByRole('table').count())) await page.getByRole('button', { name: 'Next slide' }).click();
  const region = main.getByRole('region', { name: 'Table content' });
  const before = await main.getByRole('rowheader').first().boundingBox();
  await region.hover();
  await page.mouse.wheel(700, 0);
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const after = await main.getByRole('rowheader').first().boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  await expect(main.getByRole('columnheader').first()).toHaveCSS('position', 'sticky');
});

test('preserves source header opt-outs and rich text colors', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await presentTable(page, 'formatted');
  const main = page.getByRole('main', { name: /^Slide \d+ of/ });
  while (!(await main.getByRole('table').count())) await page.getByRole('button', { name: 'Next slide' }).click();
  await expect(main.getByRole('columnheader')).toHaveCount(0);
  await expect(main.getByRole('rowheader')).toHaveCount(0);
  await expect(main.getByText('286×', { exact: true })).toHaveCSS('color', 'rgb(182, 36, 36)');
  await expect(main.locator('strong')).toContainText('286×');
  await expect(main.locator('tbody tr').nth(2).locator('td').last()).toHaveCSS(
    'background-image',
    /rgb\(222, 244, 234\)/
  );
});

test('keeps column headers anchored when an exceptionally tall cell must scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 650 });
  await presentTable(page, 'tall');
  const main = page.getByRole('main', { name: /^Slide \d+ of/ });
  while (!(await main.getByRole('table').count())) await page.getByRole('button', { name: 'Next slide' }).click();
  const region = main.getByRole('region', { name: 'Table content' });
  const before = await main.getByRole('columnheader').first().boundingBox();
  await region.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const after = await main.getByRole('columnheader').first().boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
  const area = await main.boundingBox();
  const table = await region.boundingBox();
  expect(table!.y + table!.height).toBeLessThan(area!.y + area!.height);
  await page.getByRole('button', { name: 'Next slide' }).click();
  await expect(region).toBeVisible();
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(0);
});

for (const viewport of [
  { width: 2048, height: 1090 },
  { width: 1100, height: 650 },
]) {
  test(`keeps the section introduction with its table without clipping at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await presentTable(page, 'intro', 'dark');
    await page.getByRole('button', { name: 'Next slide' }).click();
    const main = page.getByRole('main', { name: /^Slide \d+ of/ });
    await expect(main.getByRole('heading', { name: '2. How LLM architecture and training have changed' })).toBeVisible();
    await expect(main).toContainText('The modern LLM stack');
    await expect(main.getByRole('table')).toBeVisible();
    const rows: string[] = [];
    let tablePages = 0;
    while (await main.getByRole('table').count()) {
      tablePages++;
      rows.push(...(await main.getByRole('rowheader').allTextContents()));
      const fit = await main.evaluate((element) => {
        const table = element.querySelector('table')!;
        return (
          table.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom &&
          element.scrollHeight <= element.clientHeight + 1 &&
          table.parentElement!.scrollHeight <= table.parentElement!.clientHeight + 1
        );
      });
      expect(fit).toBe(true);
      if (tablePages > 1) await expect(main).not.toContainText('The modern LLM stack');
      await page.screenshot({
        path: `test-results/presentation/table-intro-${viewport.width}-${tablePages}.png`,
        animations: 'disabled',
      });
      await page.getByRole('button', { name: 'Next slide' }).click();
    }
    expect(rows).toEqual([
      'Architecture',
      'Pretraining',
      'Post-training',
      'Reasoning',
      'Context',
      'Modalities',
      'Tools',
      'Efficiency',
      'Deployment',
    ]);
    if (viewport.width === 2048) expect(tablePages).toBe(1);
    await expect(main).toContainText('The final source paragraph.');
  });
}
