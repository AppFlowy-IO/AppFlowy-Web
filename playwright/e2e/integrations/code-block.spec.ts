import { Download, expect, Page, TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { fixtureHTML, test } from '../../support/integrations-server';

const fixturePath = '/app/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
const block = (page: Page) => page.locator('.code-block[data-language]');
const editor = (page: Page) => page.getByTestId('editor-content');
const source = (page: Page) => block(page).locator('pre.code-block-source');
const snapshot = (page: Page) => page.getByTestId('code-document-snapshot');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function insertCode(page: Page, text = '', mermaid = false) {
  await editor(page).click();
  await page.keyboard.type(mermaid ? '/mermaid' : '/code');
  await page.getByTestId(mermaid ? 'slash-menu-mermaid' : 'slash-menu-code').click();
  await expect(block(page)).toHaveCount(1);
  if (text) await page.keyboard.insertText(text);
}
async function menu(page: Page, sixDot = false) {
  await block(page).first().hover();
  if (sixDot) await page.getByTestId('drag-block').click();
  else await page.getByTestId('code-block-options').click();
  return page.getByTestId('code-block-menu');
}
async function language(page: Page, value: string) {
  await (await menu(page)).getByRole('menuitem', { name: 'Language', exact: true }).click();
  await page.getByRole('combobox').fill(value);
  await page.getByRole('combobox').press('Enter');
}

test.beforeEach(async ({ page, integrationsURL }) => {
  page.on('pageerror', (error) => console.error(error));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) console.error(message.text());
  });
  await page.route('**/api/ai/*/model/list', (route) =>
    route.fulfill({ json: { code: 0, data: { models: [{ name: 'Auto', metadata: { is_default: true } }] } } })
  );
  await page.route(`**${fixturePath}*`, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('code-block') })
  );
  await page.goto(new URL(fixturePath, integrationsURL).href);
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
});

test('code renders with Figma spacing, syntax colors, hover toolbar and no internal vertical scrollbar', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await insertCode(
    page,
    'def validate_input(text):\n    if len(text) > 5 and text.isdigit():\n        return True\n    return False'
  );
  await language(page, 'Python');
  await expect(block(page)).toHaveAttribute('data-language', 'python');
  await expect(source(page).locator('.token.keyword').first()).toBeVisible();
  await expect(block(page).locator('.code-block-body')).toHaveCSS('padding', '8px 20px 38px');
  await expect(source(page)).toHaveCSS('font-size', '14px');
  await expect(source(page)).toHaveCSS('line-height', '20px');
  await expect(source(page)).toHaveCSS('height', '80px');
  await expect(block(page).locator('.code-block-surface')).toHaveCSS('height', '156px');
  await source(page).hover();
  await expect(page.getByTestId('code-toolbar')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('code-hover.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Outside', exact: true }).hover();
  await expect(page.getByTestId('code-toolbar')).toBeHidden();
  await expect(block(page).locator('.code-language-trigger')).toBeHidden();
  await expect(source(page)).toHaveCSS('overflow-y', 'hidden');
  expect(errors).toEqual([]);
});

for (const sixDot of [false, true]) {
  test(`${
    sixDot ? 'six-dot' : 'floating'
  } menu: search, pin, caption, copy, submenu repeat clicks and selection`, async ({ page, context }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await insertCode(page, 'const value = 42;');
    const root = await menu(page, sixDot);

    await expect(block(page)).toHaveAttribute('data-selected', 'true');
    await root.getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
    await root.getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
    await expect(page.getByTestId('code-block-submenu').getByRole('menuitem', { name: 'Explain code' })).toBeVisible();
    const parentBox = await root.boundingBox();
    const childBox = await page.getByTestId('code-block-submenu').boundingBox();

    expect(
      Math.min(
        Math.abs(childBox!.x - (parentBox!.x + parentBox!.width)),
        Math.abs(parentBox!.x - (childBox!.x + childBox!.width))
      )
    ).toBeLessThan(8);
    await page.screenshot({ path: testInfo.outputPath('code-menu-ai.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('code-block-submenu')).toHaveCount(0);
    await expect(root.getByRole('menuitem', { name: 'Ask AI', exact: true })).toBeFocused();
    await root.getByRole('menuitem', { name: 'Language', exact: true }).click();
    const input = page.getByRole('combobox');

    await expect(input).toBeFocused();
    await expect(page.locator('.code-language-search')).toHaveCSS('border-color', 'rgb(0, 181, 255)');
    await input.fill('not-a-language');
    await input.press('ArrowDown');
    await input.press('ArrowUp');
    await input.press('Enter');
    await expect(input).toBeVisible();
    await input.fill(' RUST ');
    await input.press('Enter');
    await expect(block(page)).toHaveAttribute('data-language', 'rust');
    await (await menu(page, sixDot)).getByRole('menuitemcheckbox', { name: 'Pin language' }).click();
    await expect(snapshot(page)).toContainText('"pin_language":true');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Outside' }).hover();
    await expect(block(page).locator('.code-language-trigger')).toBeVisible();
    await (await menu(page, sixDot)).getByRole('menuitem', { name: 'Add caption' }).click();
    await page.getByRole('textbox', { name: 'Caption', exact: true }).fill('A useful example');
    await page.getByRole('textbox', { name: 'Caption', exact: true }).press('Escape');
    await (await menu(page, sixDot)).getByRole('menuitem', { name: 'Copy code', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const value = 42;');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Caption', exact: true })).toHaveValue('A useful example');
    await expect(block(page)).toHaveAttribute('data-language', 'rust');
  });
}

for (const sixDot of [false, true]) {
  test(`${sixDot ? 'six-dot' : 'floating'} submenu follows the pointer across the gap and closes on leave`, async ({
    page,
  }) => {
    await insertCode(page, '', true);
    const root = await menu(page, sixDot);
    const submenu = page.getByTestId('code-block-submenu');

    for (const name of ['Turn into', 'Language', 'Display', 'Download', 'Ask AI']) {
      const trigger = root.getByRole('menuitem', { name, exact: true });

      await trigger.click();
      await expect(submenu).toBeVisible();
      await root.getByRole('menuitem', { name: 'Copy code', exact: true }).hover();
      await expect(submenu).toHaveCount(0);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).not.toHaveClass(/is-active/);
      await expect(root).toBeVisible();
    }

    const trigger = root.getByRole('menuitem', { name: 'Download', exact: true });

    await trigger.click();
    await trigger.click();
    await expect(submenu).toBeVisible();
    const parentBox = (await root.boundingBox())!;
    const triggerBox = (await trigger.boundingBox())!;
    const childBox = (await submenu.boundingBox())!;
    const opensLeft = childBox.x < parentBox.x;
    const gapX = opensLeft ? parentBox.x - 2 : parentBox.x + parentBox.width + 2;
    const y = triggerBox.y + triggerBox.height / 2;

    await page.mouse.move(gapX, y);
    await submenu.getByRole('menuitem', { name: 'SVG', exact: true }).hover();
    // Stay longer than the close grace period to catch a timer that wasn't cancelled.
    await page.waitForTimeout(300);
    await expect(submenu).toBeVisible();
    await trigger.hover();
    await page.waitForTimeout(300);
    await expect(submenu).toBeVisible();
    await submenu.getByRole('menuitem', { name: 'PNG', exact: true }).hover();
    await page.mouse.move(5, 5);
    await expect(submenu).toHaveCount(0);
    await expect(root).toBeVisible();
  });
}

for (const sixDot of [false, true]) {
  for (const mermaid of [false, true]) {
    test(`${sixDot ? 'six-dot' : 'floating'} Turn into Page preserves ${
      mermaid ? 'Mermaid' : 'code'
    } and settings`, async ({ page }) => {
      const text = mermaid ? 'graph TD\n  Mermaid --> Diagram' : 'const value = `<tag> $x$`; \n  // 保留 whitespace';

      await insertCode(page, text, mermaid);
      if (!mermaid) await language(page, 'JavaScript');
      await (await menu(page, sixDot)).getByRole('menuitem', { name: 'Add caption' }).click();
      await page.getByRole('textbox', { name: 'Caption', exact: true }).fill('Example caption');
      await page.getByRole('textbox', { name: 'Caption', exact: true }).press('Escape');
      await (await menu(page, sixDot)).getByRole('menuitemcheckbox', { name: 'Pin language' }).click();
      await page.keyboard.press('Escape');
      const original = JSON.parse((await snapshot(page).textContent())!).find(
        (node: { type: string }) => node.type === 'code'
      );
      const root = await menu(page, sixDot);

      await root.getByRole('menuitem', { name: 'Turn into', exact: true }).click();
      await page.getByTestId('code-block-submenu').getByRole('menuitem', { name: 'Page', exact: true }).click();
      await expect(block(page)).toHaveCount(0);
      await expect(editor(page).locator('.subpage')).toHaveCount(1);
      await expect(page.getByTestId('code-opened-page')).toHaveText('code-child-page');
      expect(JSON.parse((await page.getByTestId('code-created-page').textContent())!)).toEqual({
        layout: 0,
        page_data: {
          type: 'page',
          children: [{ type: 'code', data: { ...original.data, delta: [{ insert: text }] }, children: [] }],
        },
      });
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(source(page)).toHaveText(text);
      await expect(snapshot(page)).toContainText('"caption":"Example caption"');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(block(page)).toHaveCount(0);
      await page.reload();
      await expect(snapshot(page)).toHaveAttribute('data-ready', 'true');
      await expect(editor(page).locator('.subpage')).toHaveCount(1);
    });
  }
}

test('Turn into Page includes an empty code block in the new page', async ({ page }) => {
  await insertCode(page);
  const root = await menu(page);

  await root.getByRole('menuitem', { name: 'Turn into', exact: true }).click();
  await page.getByTestId('code-block-submenu').getByRole('menuitem', { name: 'Page', exact: true }).click();
  await expect(block(page)).toHaveCount(0);
  await expect(page.getByTestId('code-opened-page')).toHaveText('code-child-page');
  expect(JSON.parse((await page.getByTestId('code-created-page').textContent())!).page_data.children).toEqual([
    { type: 'code', data: { delta: [{ insert: '' }] }, children: [] },
  ]);
});

for (const variant of ['Code', 'Mermaid', 'Mermaid preview']) {
  test(`${variant} caption Backspace removes the empty area and returns to code`, async ({ page }) => {
    const mermaid = variant !== 'Code';
    const text = mermaid ? 'graph TD\n  A --> B' : 'const value = 42;';
    const continuation = mermaid ? '\n%% continued' : ' // continued';

    await insertCode(page, text, mermaid);
    if (variant === 'Mermaid preview') {
      await source(page).hover();
      await page.getByTestId('code-toolbar').getByRole('button', { name: 'Display', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Preview', exact: true }).click();
      await expect(source(page)).toHaveCSS('opacity', '0');
    }
    await (await menu(page)).getByRole('menuitem', { name: 'Add caption' }).click();
    const caption = page.getByRole('textbox', { name: 'Caption', exact: true });

    await expect(caption).toBeFocused();
    await caption.press('Backspace');
    await expect(caption).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
    await expect(source(page)).toHaveText(text);
    await expect(source(page)).toHaveCSS('opacity', '1');
    await page.keyboard.insertText(continuation);
    await expect(source(page)).toHaveText(text + continuation);
    await expect(snapshot(page)).toContainText('"caption":null');
    await page.reload();
    await expect(caption).toHaveCount(0);
    await expect(source(page)).toHaveText(text + continuation);
  });
}

test('caption Backspace preserves normal deletion and merges remaining text with undo and redo', async ({ page }) => {
  await insertCode(page, 'original');
  await (await menu(page)).getByRole('menuitem', { name: 'Add caption' }).click();
  const caption = page.getByRole('textbox', { name: 'Caption', exact: true });

  await caption.fill('notes');
  await caption.press('End');
  await caption.press('Backspace');
  await expect(caption).toHaveValue('note');
  await caption.press(`${mod}+a`);
  await caption.press('Backspace');
  await expect(caption).toHaveValue('');
  await expect(caption).toBeFocused();
  await expect(source(page)).toHaveText('original');

  await caption.fill(' suffix\nsecond line');
  await caption.press(`${mod}+a`);
  await caption.press('ArrowLeft');
  await caption.press('Backspace');
  await expect(caption).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await expect(source(page)).toHaveText('original suffix\nsecond line');
  await page.keyboard.insertText('!');
  await expect(source(page)).toHaveText('original suffix\nsecond line!');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(source(page)).toHaveText('original suffix\nsecond line');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(source(page)).toHaveText('original');
  await expect(caption).toHaveValue(' suffix\nsecond line');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(caption).toHaveCount(0);
  await expect(source(page)).toHaveText('original suffix\nsecond line');
});

test('caption grows with newlines and wrapping without a resize handle, including read-only mode', async ({ page }) => {
  await insertCode(page, 'original');
  await (await menu(page)).getByRole('menuitem', { name: 'Add caption' }).click();
  const caption = page.getByRole('textbox', { name: 'Caption', exact: true });

  await expect(caption).toHaveCSS('resize', 'none');
  await caption.fill('First line');
  await caption.press('Enter');
  await page.keyboard.insertText('Second line');
  await expect(caption).toHaveValue('First line\nSecond line');
  await expect(caption).toBeFocused();
  await expect(caption).toHaveCSS('height', '36px');
  const longCaption = 'A caption that wraps across multiple lines. '.repeat(20);

  await caption.fill(longCaption);
  await expect.poll(async () => (await caption.boundingBox())!.height).toBeGreaterThan(36);
  await expect.poll(() => caption.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  await caption.fill('Short caption');
  await expect(caption).toHaveCSS('height', '18px');
  await page.getByRole('checkbox', { name: 'Read only', exact: true }).check();
  await caption.click();
  await caption.press('Home');
  await caption.press('Backspace');
  await expect(caption).toHaveValue('Short caption');
  await expect(source(page)).toHaveText('original');
});

test('language keyboard wraps, searches aliases, and retains Auto', async ({ page }, testInfo) => {
  await insertCode(page);
  await source(page).hover();
  await page.getByRole('button', { name: 'Language: Auto', exact: true }).click();
  const input = page.getByRole('combobox');

  await expect(input).toBeFocused();
  await expect(page.locator('.code-language-search')).toHaveCSS('border-color', 'rgb(0, 181, 255)');
  // Flutter places the picker at the block's 12px inset, 4px below the language button.
  await expect(async () => {
    const trigger = await block(page).locator('.code-language-trigger').boundingBox();
    const picker = await page.locator('.code-menu-paper').boundingBox();
    const surface = await block(page).locator('.code-block-surface').boundingBox();

    expect(picker!.x).toBeCloseTo(surface!.x + 12, 0);
    expect(picker!.x).toBeCloseTo(trigger!.x, 0);
    expect(picker!.y).toBeCloseTo(trigger!.y + trigger!.height + 4, 0);
  }).toPass();
  await page.screenshot({ path: testInfo.outputPath('language-search-focused.png'), animations: 'disabled' });
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(block(page)).toHaveAttribute('data-language', 'zig');
  await language(page, 'c#');
  await expect(block(page)).toHaveAttribute('data-language', 'cs');
  await language(page, 'auto');
  await expect(block(page)).toHaveAttribute('data-language', 'auto');
});

test('empty AI actions disabled, delete uses red text on neutral hover, and no Comment', async ({ page }) => {
  await insertCode(page);
  await expect(block(page).locator('.code-block-surface')).toHaveCSS('height', '96px');
  const root = await menu(page);

  await expect(root.getByRole('menuitem', { name: 'Comment', exact: true })).toHaveCount(0);
  const deletion = root.getByRole('menuitem', { name: 'Delete', exact: true });

  await deletion.hover();
  const colors = await deletion.evaluate((node) => ({
    text: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
    error: getComputedStyle(node).getPropertyValue('--text-error').trim(),
  }));

  const errorRGB = colors.error.match(/[a-f0-9]{2}/gi)?.map((hex) => parseInt(hex, 16));

  expect(colors.text).toBe(`rgb(${errorRGB?.join(', ')})`);
  expect(colors.background).not.toBe(colors.text);
  await root.getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  for (const name of ['Explain code', 'Check code', 'Add inline code comments'])
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeDisabled();
  await expect(
    page.getByTestId('code-block-submenu').getByRole('menuitem', { name: 'Ask AI', exact: true })
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await root.getByRole('menuitem', { name: 'Turn into', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Page', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await deletion.click();
  await expect(block(page)).toHaveCount(0);
});

for (const keyboard of [false, true]) {
  test(`Mermaid defaults are selected on ${keyboard ? 'keyboard' : 'mouse'} insertion and repeated insertion`, async ({
    page,
  }, testInfo) => {
    const defaultCode = 'graph TD\n  Mermaid --> Diagram';
    const replacement = 'graph LR\n  Start --> Finish';
    const insertMermaid = async () => {
      await page.keyboard.type('/mermaid');
      await expect(page.getByTestId('slash-menu-mermaid')).toBeVisible();
      if (keyboard) await page.keyboard.press('Enter');
      else await page.getByTestId('slash-menu-mermaid').click();
    };

    await editor(page).click();
    await insertMermaid();
    await expect(source(page)).toHaveText(defaultCode);
    await expect(page.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
    await expect(editor(page)).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(defaultCode);
    await page.screenshot({ path: testInfo.outputPath('mermaid-default-selected.png'), animations: 'disabled' });
    await page.keyboard.insertText(replacement);
    await expect(source(page)).toHaveText(replacement);

    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Keep this paragraph ');
    await insertMermaid();
    await expect(block(page)).toHaveCount(2);
    await expect(editor(page)).toContainText('Keep this paragraph');
    await expect(source(page).first()).toHaveText(replacement);
    await expect(source(page).last()).toHaveText(defaultCode);
    await expect(editor(page)).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(defaultCode);
    await page.keyboard.insertText('graph TD\n  New --> Diagram');
    await expect(source(page).last()).toHaveText('graph TD\n  New --> Diagram');
    await page.reload();
    await expect(source(page).first()).toHaveText(replacement);
    await expect(source(page).last()).toHaveText('graph TD\n  New --> Diagram');
  });
}

test('Mermaid slash insertion, code/preview/split, expand, download and persistence', async ({ page }, testInfo) => {
  await insertCode(page, '', true);
  await expect(source(page)).toHaveText('graph TD\n  Mermaid --> Diagram');
  await expect(page.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
  await source(page).hover();
  await page.getByTestId('code-toolbar').getByRole('button', { name: 'Display', exact: true }).click();
  await expect(page.locator('.code-display-paper')).toHaveCSS('width', '100px');
  await expect(page.getByTestId('code-block-menu')).toHaveCSS('height', '36px');
  await page.screenshot({ path: testInfo.outputPath('mermaid-display.png'), animations: 'disabled' });
  await page.getByRole('menuitemradio', { name: 'Preview', exact: true }).click();
  await expect(source(page)).toHaveCSS('opacity', '0');
  await block(page).hover();
  await (await menu(page)).getByRole('menuitem', { name: 'Display', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Code', exact: true }).click();
  await expect(page.getByTestId('mermaid-preview')).toHaveCount(0);
  await expect(source(page)).toHaveCSS('opacity', '1');
  await (await menu(page)).getByRole('menuitem', { name: 'Display', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Split', exact: true }).click();
  await expect(page.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mermaid-split.png'), animations: 'disabled' });
  await (await menu(page)).getByRole('menuitem', { name: 'Expand diagram', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: testInfo.outputPath('mermaid-expanded.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  for (const extension of ['SVG', 'PNG']) {
    const download = page.waitForEvent('download');

    await page.getByRole('button', { name: `Download ${extension}` }).click();
    expect((await download).suggestedFilename()).toBe(`diagram.${extension.toLowerCase()}`);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
});

async function verifyDiagramDownload(
  page: Page,
  download: Download,
  format: 'svg' | 'png',
  viewBox: number[],
  expectedText: string,
  testInfo: TestInfo
) {
  expect(download.suggestedFilename()).toBe(`diagram.${format}`);
  expect(await download.failure()).toBeNull();
  const path = testInfo.outputPath(`diagram.${format}`);

  await download.saveAs(path);
  const bytes = await readFile(path);
  const contentType = format === 'svg' ? 'image/svg+xml' : 'image/png';
  const dark = testInfo.project.name.includes('dark');
  const decoded = await page.evaluate(
    async ({ base64, contentType, dark }) => {
      const image = new Image();

      image.src = `data:${contentType};base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');

      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;

      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const fill = dark ? [76, 89, 102] : [230, 233, 240];
      let themePixels = 0;
      let visiblePixels = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 255) {
          visiblePixels++;
          if (fill.every((channel, offset) => pixels[i + offset] === channel)) themePixels++;
        }
      }

      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        visiblePixels,
        themePixels,
        cornerAlpha: pixels[3],
      };
    },
    { base64: bytes.toString('base64'), contentType, dark }
  );

  expect(decoded.visiblePixels).toBeGreaterThan(100);
  expect(decoded.themePixels).toBeGreaterThan(100);
  expect(decoded.cornerAlpha).toBe(0);
  if (format === 'svg') {
    const details = await page.evaluate((svg) => {
      const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGSVGElement;

      return {
        width: Number(root.getAttribute('width')),
        height: Number(root.getAttribute('height')),
        viewBox: root.getAttribute('viewBox')?.split(/\s+/).map(Number),
        maxWidth: root.style.maxWidth,
        text: Array.from(root.querySelectorAll('text'), (text) => text.textContent).join(''),
        paths: root.querySelectorAll('path').length,
        images: root.querySelectorAll('image').length,
      };
    }, bytes.toString('utf8'));

    expect(details.width).toBe(viewBox[2]);
    expect(details.height).toBe(viewBox[3]);
    expect(details.viewBox).toEqual(viewBox);
    expect(details.maxWidth).toBe('');
    expect(details.text).toBe(expectedText);
    expect(details.text).not.toBe('');
    expect(details.paths).toBeGreaterThan(0);
    expect(details.images).toBe(0);
  } else {
    // Check the real PNG file header as well as the browser's decoded pixels.
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([decoded.width, decoded.height]);
    expect(Math.max(decoded.width, decoded.height)).toBeGreaterThanOrEqual(2048);
    expect(decoded.width).toBeGreaterThanOrEqual(Math.floor(viewBox[2] * 4));
    expect(decoded.height).toBeGreaterThanOrEqual(Math.floor(viewBox[3] * 4));
    expect(Math.abs(decoded.width * viewBox[3] - decoded.height * viewBox[2])).toBeLessThanOrEqual(
      Math.max(viewBox[2], viewBox[3])
    );
    expect(decoded.width * decoded.height).toBeLessThanOrEqual(16 * 1024 * 1024);
  }
  await testInfo.attach(`export-${format}`, { path, contentType });
}

for (const entry of ['floating', 'six-dot', 'expanded'] as const) {
  test(`Mermaid high-resolution ${entry} exports retain complete vector content, proportions and theme`, async ({
    page,
  }, testInfo) => {
    const text =
      entry === 'floating'
        ? 'graph LR\n  A[Read source] --> B[Render vectors] --> C[Download diagram]'
        : entry === 'six-dot'
        ? 'graph TD\n  A[Source] --> B[Parse] --> C[Layout] --> D[Render] --> E[Download]'
        : 'graph TD\n  Mermaid --> Diagram';

    await insertCode(page, text, true);
    const svg = page.getByTestId('mermaid-diagram').locator('svg');

    await expect(svg).toBeVisible();
    const viewBox = (await svg.getAttribute('viewBox'))!.split(/\s+/).map(Number);
    const expectedText = (await svg.locator('text').allTextContents()).join('');

    if (entry === 'expanded') {
      await page.setViewportSize({ width: 600, height: 800 });
      await (await menu(page)).getByRole('menuitem', { name: 'Expand diagram', exact: true }).click();
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    }
    for (const format of ['svg', 'png'] as const) {
      if (entry !== 'expanded') {
        await (await menu(page, entry === 'six-dot')).getByRole('menuitem', { name: 'Download', exact: true }).click();
      }
      const downloading = page.waitForEvent('download');

      if (entry === 'expanded') {
        await page.getByRole('button', { name: `Download ${format.toUpperCase()}`, exact: true }).click();
      } else {
        await page
          .getByTestId('code-block-submenu')
          .getByRole('menuitem', { name: format.toUpperCase(), exact: true })
          .click();
      }
      await verifyDiagramDownload(page, await downloading, format, viewBox, expectedText, testInfo);
    }
  });
}

async function replaceCode(page: Page, text: string) {
  await source(page).first().click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText(text);
}

for (const mode of ['split', 'preview', 'expanded'] as const) {
  test(`Mermaid Copy image from ${mode} copies a high-resolution PNG without editing source`, async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('Before image copy'));
    await insertCode(page, '', true);
    await expect(page.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
    if (mode === 'preview') {
      await (await menu(page)).getByRole('menuitem', { name: 'Display', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Preview', exact: true }).click();
      await expect(source(page)).toHaveCSS('opacity', '0');
    }
    if (mode === 'expanded') {
      // Copying and expanding remain available on read-only documents.
      await page.getByRole('checkbox', { name: 'Read only' }).check();
      await page.getByTestId('mermaid-preview').hover();
      await page.getByRole('button', { name: 'Expand diagram', exact: true }).click();
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    }
    const before = await snapshot(page).textContent();
    const area = mode === 'expanded' ? page.getByRole('dialog') : page.getByTestId('mermaid-preview');
    const copy = area.getByRole('button', { name: 'Copy image', exact: true });

    await area.hover();
    if (mode !== 'expanded') await expect(page.locator('.mermaid-preview-actions')).toHaveCSS('opacity', '1');
    await copy.click();
    await expect(page.getByText('Image copied to clipboard', { exact: true })).toBeVisible();
    await expect(copy).toHaveAttribute('aria-busy', 'false');
    await expect(copy.locator('path').first()).toHaveCSS(
      'stroke',
      await copy.evaluate((button) => getComputedStyle(button).color)
    );
    const image = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const blob = await items[0].getType('image/png');
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');

      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;

      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let filledPixels = 0;
      let lightPixels = 0;
      let darkPixels = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 255) {
          filledPixels++;
          if (pixels[i] === 230 && pixels[i + 1] === 233 && pixels[i + 2] === 240) lightPixels++;
          if (pixels[i] === 76 && pixels[i + 1] === 89 && pixels[i + 2] === 102) darkPixels++;
        }
      }
      const result = {
        types: items[0].types,
        width: bitmap.width,
        height: bitmap.height,
        cornerAlpha: pixels[3],
        filledPixels,
        lightPixels,
        darkPixels,
      };

      bitmap.close();
      return result;
    });

    expect(image.types).toEqual(['image/png']);
    expect(image.height).toBe(2048);
    expect(image.width).toBeGreaterThan(1600);
    expect(image.filledPixels).toBeGreaterThan(1000);
    expect(testInfo.project.name.includes('dark') ? image.darkPixels : image.lightPixels).toBeGreaterThan(1000);
    expect(image.cornerAlpha).toBe(0);
    expect(await snapshot(page).textContent()).toBe(before);
    await page.screenshot({ path: testInfo.outputPath('mermaid-copy-image.png'), animations: 'disabled' });
    if (mode !== 'expanded') {
      await page.getByRole('button', { name: 'Outside', exact: true }).hover();
      await expect(page.locator('.mermaid-preview-actions')).toHaveCSS('opacity', '0');
      await block(page).hover();
      await page.getByTestId('code-toolbar').getByRole('button', { name: 'Copy code', exact: true }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('graph TD\n  Mermaid --> Diagram');
    }
  });
}

test('Mermaid Copy image supports keyboard focus, reports clipboard rejection and allows retry', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await insertCode(page, '', true);
  await expect(page.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
  await page.evaluate(() => {
    const write = navigator.clipboard.write.bind(navigator.clipboard);
    let rejected = false;

    navigator.clipboard.write = (items) => {
      if (!rejected) {
        rejected = true;
        return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      }
      return write(items);
    };
  });
  // Tab from the language control reaches image actions even without mouse hover.
  await block(page).hover();
  await block(page).locator('.code-language-trigger').focus();
  await page.getByRole('button', { name: 'Outside', exact: true }).hover();
  await page.keyboard.press('Tab');
  const copy = page.getByTestId('mermaid-preview').getByRole('button', { name: 'Copy image', exact: true });

  await expect(copy).toBeFocused();
  await expect(page.locator('.mermaid-preview-actions')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Could not copy image. Try downloading it instead.', { exact: true })).toBeVisible();
  await expect(page.getByText('Image copied to clipboard', { exact: true })).toHaveCount(0);
  await expect(copy).toHaveAttribute('aria-busy', 'false');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Image copied to clipboard', { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toEqual(['image/png']);
  await replaceCode(page, 'invalid diagram language');
  await expect(page.getByRole('alert').filter({ hasText: /diagram/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy image', exact: true })).toHaveCount(0);
});

async function askAI(page: Page, action: string, sixDot = false) {
  const root = await menu(page, sixDot);

  await root.getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  await page.getByTestId('code-block-submenu').getByRole('menuitem', { name: action, exact: true }).click();
  return page.getByTestId('code-block-ai');
}
async function seed(page: Page, value: object) {
  await page.evaluate(() => localStorage.removeItem('code-block-fixture'));
  await page.goto(`${page.url().split('?')[0]}?seed=${encodeURIComponent(JSON.stringify(value))}`);
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true');
}
const codeSeed = (text: string, language = 'plaintext') => ({
  type: 'code',
  data: { language },
  children: [{ type: 'text', children: [{ text }] }],
});

test('Flutter literal code shortcuts, indentation, selection, Shift Enter and first-block deletion', async ({
  page,
}) => {
  await editor(page).click();
  await page.keyboard.type('```');
  await expect(block(page)).toHaveCount(1);
  const text = '@user + [[ / :smile: **bold** __under_score__ ~~strike~~ -- => ->';

  await page.keyboard.type(text);
  await expect(source(page)).toHaveText(text);
  await expect(page.getByTestId('slash-menu')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('two');
  await expect(source(page)).toHaveText(`${text}\n  one\n  two`);
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press('Tab');
  await expect(source(page)).toHaveText(`  ${text}\n    one\n    two`);
  await page.keyboard.press('Shift+Tab');
  await expect(source(page)).toHaveText(`${text}\n  one\n  two`);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('outside code');
  await expect(source(page)).not.toContainText('outside code');
  await expect(editor(page)).toContainText('outside code');
  await replaceCode(page, '');
  await page.keyboard.press('Backspace');
  await expect(block(page)).toHaveCount(0);
});

test('plain text suppresses highlighting; Rust auto, Delphi, Verilog, VHDL and Zig are colored', async ({ page }) => {
  await insertCode(page, 'fn main() { println!("hello"); }');
  await expect(source(page).locator('.token').first()).toBeVisible();
  for (const [lang, text] of [
    ['Delphi', 'program Hello; begin writeln(42); end.'],
    ['Verilog', 'module test; reg a; endmodule'],
    ['VHDL', 'entity test is end test;'],
    ['Zig', 'const std = @import("std"); pub fn main() void {}'],
  ]) {
    await language(page, lang);
    await replaceCode(page, text);
    await expect(source(page).locator('.token.keyword').first()).toBeVisible();
  }
  await language(page, 'plain text');
  await expect(source(page).locator('.token')).toHaveCount(0);
});

test('wrap toggles long lines, grows vertically, and preserves long reverse selections', async ({ page }) => {
  const text = Array.from({ length: 70 }, (_, index) => `line_${index}: ${'long_text '.repeat(25)}`).join('\n');

  await insertCode(page, text);
  expect(await source(page).evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await source(page).evaluate((node) => node.clientHeight)).toBeGreaterThan(1300);
  await (await menu(page)).getByRole('menuitemcheckbox', { name: 'Wrap code' }).click();
  await page.keyboard.press('Escape');
  await expect(source(page)).toHaveCSS('white-space', 'pre-wrap');
  expect(await source(page).evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await source(page).click();
  await page.keyboard.press(`${mod}+ArrowDown`);
  await page.keyboard.press(`${mod}+Shift+ArrowUp`);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press(`${mod}+Shift+ArrowDown`);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
});

test('long code supports upward mouse drag and Shift-click selection (#4614)', async ({ page }) => {
  const text = Array.from({ length: 70 }, (_, index) => `line_${index}: code`).join('\n');

  await insertCode(page, text);
  await language(page, 'plain text');
  await expect(block(page)).toHaveAttribute('data-language', 'plaintext');
  await source(page).click();
  await page.keyboard.press(`${mod}+ArrowUp`);
  // Keyboard caret scrolling can leave the first line at the viewport edge.
  // Finish scrolling before measuring coordinates for the upward pointer drag.
  await page.mouse.wheel(0, -5000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const rect = await source(page).boundingBox();

  await page.mouse.move(rect!.x + 2, rect!.y + 210);
  await page.mouse.down();
  await page.mouse.move(rect!.x + 2, rect!.y + 10, { steps: 20 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    text.split('\n').slice(0, 10).join('\n') + '\n'
  );
  await page.keyboard.press(`${mod}+ArrowDown`);
  await page.mouse.wheel(0, -5000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const firstLine = await source(page).boundingBox();

  await page.keyboard.down('Shift');
  await page.mouse.click(firstLine!.x + 2, firstLine!.y + 10);
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
});

test('turn text into code, undo and redo preserve its content and identity (#8147)', async ({ page }) => {
  const text = 'const converted = 42;';

  await seed(page, {
    type: 'paragraph',
    data: {},
    children: [{ type: 'text', children: [{ text, bold: true }] }],
  });
  const original = JSON.parse((await snapshot(page).textContent()) ?? '[]')[0];

  await editor(page).getByText(text, { exact: true }).hover();
  await page.getByTestId('drag-block').click();
  await page.getByRole('button', { name: 'Turn into', exact: true }).click();
  await page.getByTestId('turn-into-menu').getByRole('button', { name: 'Code Block', exact: true }).click();
  await expect(source(page)).toHaveText(text);
  await expect(source(page).locator('strong,b')).toHaveCount(0);
  expect(JSON.parse((await snapshot(page).textContent()) ?? '[]')[0].blockId).toBe(original.blockId);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(block(page)).toHaveCount(0);
  await expect(editor(page)).toContainText(text);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(source(page)).toHaveText(text);
  expect(JSON.parse((await snapshot(page).textContent()) ?? '[]')[0].blockId).toBe(original.blockId);
});

test('triple click selects one code line and four clicks select the whole block', async ({ page }) => {
  const text = 'first line\nsecond line\nthird line';

  await insertCode(page, text);
  await language(page, 'plain text');
  await source(page).click({ position: { x: 25, y: 30 }, clickCount: 3 });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('second line');
  await source(page).click({ position: { x: 25, y: 30 }, clickCount: 4 });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.insertText('X');
  await expect(source(page)).toHaveText('first line\nXsecond line\nthird line');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.insertText('Y');
  await expect(source(page)).toHaveText('fYirst line\nXsecond line\nthird line');
});

test('code nested in callout, rich marks stay literal, read-only copy and saved data', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const nested = codeSeed('literal ** _ ~ @ https://example.com');

  nested.children[0].children[0] = {
    text: 'literal ** _ ~ @ https://example.com',
    bold: true,
    href: 'https://example.com',
  } as (typeof nested.children)[0]['children'][0];
  await seed(page, {
    type: 'callout',
    data: { icon: '💡' },
    children: [{ type: 'text', children: [{ text: 'Callout' }] }, nested],
  });
  await expect(block(page)).toHaveCount(1);
  await expect(source(page).locator('a,strong,b')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await block(page).hover();
  await expect(page.getByTestId('code-block-options')).toHaveCount(0);
  await expect(block(page).locator('.code-language-trigger')).toBeDisabled();
  await page.getByTestId('code-toolbar').getByRole('button', { name: 'Copy code' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('literal ** _ ~ @ https://example.com');
});

test('format, duplicate, copy block link and turn into text preserve content', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await insertCode(page, 'const x={a:1};');
  await language(page, 'javascript');
  await (await menu(page)).getByRole('menuitem', { name: 'Format code' }).click();
  await expect(source(page)).toHaveText('const x = { a: 1 };');
  await (await menu(page)).getByRole('menuitem', { name: 'Copy link to block' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('blockId=');
  await (await menu(page)).getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await expect(block(page)).toHaveCount(2);
  await expect(source(page).nth(1)).toHaveText('const x = { a: 1 };');
  await block(page).first().hover();
  await page.getByTestId('code-block-options').first().click();
  await page.getByTestId('code-block-menu').getByRole('menuitem', { name: 'Turn into' }).click();
  await page.getByTestId('code-block-submenu').getByRole('menuitem', { name: 'Text', exact: true }).click();
  await expect(block(page)).toHaveCount(1);
  await expect(editor(page)).toContainText('const x = { a: 1 };');
});

for (const sixDot of [false, true])
  for (const action of ['Explain code', 'Check code', 'Add inline code comments', 'Ask AI']) {
    test(`${sixDot ? 'Six-dot' : 'Floating'} AI ${action}: Flutter loading, Markdown response, retry and apply`, async ({
      page,
    }, testInfo) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requests: object[] = [];
      const result =
        action === 'Explain code'
          ? '# Explanation\n\n**Returns a value.**\n\n- First step\n- Second step\n\n| Name | Value |\n| --- | --- |\n| result | 42 |\n\n```javascript\nconst result = 42;\n```'
          : '```javascript\n// The answer\nconst result = 42;\n```';

      await page.route('**/api/ai/*/v2/complete/stream', async (route) => {
        requests.push(route.request().postDataJSON());
        await gate;
        await route.fulfill({
          contentType: 'text/plain',
          body: JSON.stringify({ '1': result.slice(0, 25) }) + JSON.stringify({ '1': result.slice(25) }),
        });
      });
      await insertCode(page, 'const result = 1;');
      const ai = await askAI(page, action, sixDot);

      if (action === 'Ask AI') {
        await expect(ai.getByRole('textbox')).toHaveValue(/Write an example/);
        await ai.getByRole('textbox').fill('Return forty two');
        await ai.getByRole('textbox').press('Enter');
      }
      const stop = ai.getByRole('button', { name: /Stop generating/ });

      await expect(stop).toBeVisible();
      await expect(stop).toHaveCSS('width', '32px');
      await expect(stop.locator('svg')).toHaveCSS('width', '24px');
      await expect(ai.locator('.code-ai-dots > span')).toHaveCount(3);
      release();
      await expect(stop).toHaveCount(0);
      await expect(page.getByTestId('code-response').locator('pre code')).toContainText('const result = 42;');
      if (action === 'Explain code') {
        await expect(ai.getByRole('heading', { name: 'Explanation' })).toBeVisible();
        await expect(ai.locator('li')).toHaveCount(2);
        await expect(ai.locator('table')).toBeVisible();
      }
      await page.screenshot({ path: testInfo.outputPath(`code-ai-${action}.png`), animations: 'disabled' });
      await ai.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect.poll(() => requests.length).toBe(2);
      await ai.getByRole('button', { name: action === 'Explain code' ? 'Insert below' : 'Keep', exact: true }).click();
      await expect(ai).toHaveCount(0);
      if (action === 'Explain code') {
        await expect(source(page).first()).toHaveText('const result = 1;');
        await expect(editor(page)).toContainText('Explanation');
      } else await expect(source(page)).toHaveText('// The answer\nconst result = 42;');
    });
  }

test('AI model selection preserves the prompt and applies only to Send and Try again', async ({ page }) => {
  const models: string[] = [];

  await page.route('**/api/ai/*/model/list', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: { models: [{ name: 'Auto', metadata: { is_default: true } }, { name: 'Code model' }] },
      },
    })
  );
  await page.route('**/api/ai/*/v2/complete/stream', (route) => {
    models.push(route.request().headers()['ai-model']);
    return route.fulfill({ json: { '1': '```javascript\nconst value = 2;\n```' } });
  });
  await insertCode(page, 'const value = 1;');
  const ai = await askAI(page, 'Ask AI');

  await ai.getByRole('textbox').fill('Refine this code');
  await ai.getByTestId('model-selector-button').click();
  await page.getByTestId('model-option-Code model').click();
  await expect(ai.getByRole('textbox')).toHaveValue('Refine this code');
  expect(models).toEqual([]);
  await ai.getByRole('textbox').press('Enter');
  await expect(ai.getByRole('button', { name: 'Keep', exact: true })).toBeEnabled();
  expect(models).toEqual(['Code model']);
  await ai.getByTestId('model-selector-button').click();
  await page.getByTestId('model-option-Auto').click();
  await expect(ai.getByRole('button', { name: 'Keep', exact: true })).toBeEnabled();
  expect(models).toEqual(['Code model']);
  await ai.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => models).toEqual(['Code model', 'Auto']);
  await expect(ai.getByRole('button', { name: 'Keep', exact: true })).toBeEnabled();
  await expect(source(page)).toHaveText('const value = 1;');
});

test('floating Ask AI, discard, insert below and undo preserve original code', async ({ page }) => {
  await insertCode(page, 'original');
  await page.route('**/api/ai/*/v2/complete/stream', (route) =>
    route.fulfill({
      json: { '1': '```python\nprint(42)\n```' },
    })
  );
  await source(page).hover();
  await page.getByTestId('code-toolbar').getByRole('button', { name: 'Ask AI', exact: true }).click();
  await page.getByTestId('code-block-menu').getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  const ai = page.getByTestId('code-block-ai');

  await ai.getByRole('textbox').fill('Generate an example');
  await ai.getByRole('textbox').press('Enter');
  await expect(ai.getByRole('button', { name: 'Keep', exact: true })).toBeEnabled();
  await expect(source(page)).toHaveText('original');
  await ai.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(ai).toHaveCount(0);
  await expect(source(page)).toHaveText('original');
  await askAI(page, 'Add inline code comments');
  await ai.getByRole('button', { name: 'Insert below', exact: true }).click();
  await expect(source(page)).toHaveCount(2);
  await expect(source(page).first()).toHaveText('original');
  await expect(source(page).nth(1)).toHaveText('print(42)');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(source(page)).toHaveCount(1);
  await expect(source(page)).toHaveText('original');
});

test('AI stop via Escape, late result and concurrent edit cannot overwrite source', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/api/ai/*/v2/complete/stream', async (route) => {
    await gate;
    await route.fulfill({ json: { '1': '```js\nchanged\n```' } }).catch(() => undefined);
  });
  await insertCode(page, 'original');
  const ai = await askAI(page, 'Check code');

  await expect(ai.getByRole('button', { name: /Stop generating/ })).toBeFocused();
  await page.keyboard.press('Escape');
  release();
  await expect(ai.getByRole('button', { name: /Stop generating/ })).toHaveCount(0);
  await expect(source(page)).toHaveText('original');
  await ai.getByRole('textbox').fill('Retry');
  await ai.getByRole('textbox').press('Enter');
  await expect(ai.getByRole('button', { name: 'Keep', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remote edit', exact: true }).click();
  await expect(ai.getByRole('alert')).toBeVisible();
  await expect(ai.getByRole('button', { name: 'Keep', exact: true })).toBeDisabled();
  await expect(source(page)).toHaveText('collaborator');
});

test('Mermaid invalid source recovers; sequence, class, state, ER and pie diagrams render locally', async ({ page }) => {
  await insertCode(page, 'invalid diagram language', true);
  await expect(page.getByTestId('mermaid-preview').getByRole('alert')).toBeVisible();
  for (const text of [
    'sequenceDiagram\nAlice->>Bob: Hello',
    'classDiagram\nAnimal <|-- Duck',
    'stateDiagram-v2\n[*] --> Ready',
    'erDiagram\nCUSTOMER ||--o{ ORDER : places',
    'pie title Counts\n"One" : 1\n"Two" : 2',
  ]) {
    await replaceCode(page, text);
    await expect(page.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
    await expect(page.getByTestId('mermaid-preview').getByRole('alert')).toHaveCount(0);
  }
  await replaceCode(
    page,
    '%%{init: {"securityLevel": "loose", "flowchart":{"htmlLabels":true}}}%%\ngraph TD\nA["<script>alert(1)</script>"] --> B[Safe]\nclick B "javascript:alert(1)"'
  );
  await expect(page.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
  await expect(
    page.getByTestId('mermaid-diagram').locator('script,foreignObject,[onclick],a[href^="javascript:"]')
  ).toHaveCount(0);
});

test('normal paragraphs retain Markdown formatting and slash commands', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.type('**bold** ');
  await expect(snapshot(page)).toContainText('"bold":true');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/code');
  await expect(page.getByTestId('slash-menu-code')).toBeVisible();
});

test('inline code suppresses mention, link, slash, emoji and formatting panels', async ({ page }) => {
  await seed(page, {
    type: 'paragraph',
    data: {},
    children: [{ type: 'text', children: [{ text: 'abcdef', code: true }] }],
  });
  await editor(page).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('@user + [[ / :smile:');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press(`${mod}+b`);
  await expect(page.getByTestId('selection-toolbar')).toHaveCSS('opacity', '0');
  await expect(snapshot(page)).not.toContainText('"bold":true');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(editor(page)).toContainText('@user + [[ / :smile:');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByTestId('slash-menu-code')).toHaveCount(0);
});

test('Flutter multiline clipboard preserves Unicode, tabs and literal URL credentials', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await insertCode(page);
  const text = '  const message = "你好 👋";\n\tconsole.log(message);\ncurl https://user_name:password@github.com\n';

  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press(`${mod}+v`);
  await expect(source(page)).toHaveText(text);
  await expect(block(page)).toHaveCount(1);
  await page.reload();
  await expect(source(page)).toHaveText(text);
  await expect(source(page).locator('a')).toHaveCount(0);
});

test('submenu keyboard focus, outside close and Mermaid menu downloads', async ({ page }) => {
  await insertCode(page, 'graph TD; A-->B', true);
  const root = await menu(page, true);
  const trigger = root.getByRole('menuitem', { name: 'Display', exact: true });

  await trigger.focus();
  await trigger.press('ArrowRight');
  await expect(
    page.getByTestId('code-block-submenu').getByRole('menuitemradio', { name: 'Code', exact: true })
  ).toBeFocused();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('code-block-submenu')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(trigger).toBeFocused();
  await root.getByRole('menuitem', { name: 'Download', exact: true }).click();
  const download = page.waitForEvent('download');

  await page.getByTestId('code-block-submenu').getByRole('menuitem', { name: 'SVG', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('diagram.svg');
  await menu(page);
  await page.mouse.click(10, 10);
  await expect(page.getByTestId('code-block-menu')).toHaveCount(0);
  await expect(block(page)).toHaveAttribute('data-selected', 'false');
  await expect(page.getByTestId('code-toolbar')).toBeHidden();
});

test('AI provider failure, missing code and informational check never erase source', async ({ page }) => {
  let response: object = { code: 500, message: 'Test provider failed' };

  await page.route('**/api/ai/*/v2/complete/stream', (route) => route.fulfill({ json: response }));
  await insertCode(page, 'original');
  const ai = await askAI(page, 'Check code');

  await expect(ai.getByRole('alert')).toContainText('Test provider failed');
  await expect(ai.getByRole('button', { name: 'Insert below', exact: true })).toBeDisabled();
  response = { '1': 'no change is required' };
  await ai.getByRole('button', { name: 'Try again', exact: true }).click();
  await ai.getByRole('button', { name: 'Insert below', exact: true }).click();
  await expect(source(page)).toHaveText('original');
  await expect(editor(page)).toContainText('no change is required');
});

test.describe('touch accessibility', () => {
  test.use({ hasTouch: true, viewport: { width: 430, height: 932 } });
  test('Mermaid Copy image is available without hover on touch devices', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await insertCode(page, '', true);
    await expect(page.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.locator('.mermaid-preview-actions')).toHaveCSS('opacity', '1');
    await page.getByTestId('mermaid-preview').getByRole('button', { name: 'Copy image', exact: true }).tap();
    await expect(page.getByText('Image copied to clipboard', { exact: true })).toBeVisible();
    expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toEqual(['image/png']);
  });

  test('language and copy controls are available without hover in both themes (#8126)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await insertCode(page, 'touch code');
    await page.mouse.move(0, 0);
    await expect(block(page).locator('.code-language-trigger')).toBeVisible();
    await expect(page.getByTestId('code-toolbar').getByRole('button', { name: 'Copy code' })).toBeVisible();
    await page.getByTestId('code-toolbar').getByRole('button', { name: 'Copy code' }).tap();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('touch code');
    await page.getByTestId('code-block-options').tap();
    await page.getByTestId('code-block-menu').getByRole('menuitem', { name: 'Language', exact: true }).tap();
    await page.waitForTimeout(300);
    await expect(page.getByRole('combobox', { name: 'Search for a language' })).toBeVisible();
    const submenuBox = await page.getByTestId('code-block-submenu').boundingBox();

    expect(submenuBox!.x).toBeGreaterThanOrEqual(0);
    expect(submenuBox!.x + submenuBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.getByRole('combobox').fill('rust');
    await page.getByRole('option', { name: 'Rust', exact: true }).tap();
    await expect(block(page)).toHaveAttribute('data-language', 'rust');
  });
});
