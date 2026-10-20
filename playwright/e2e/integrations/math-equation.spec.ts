import { expect, Page } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

const fixturePath = '/app/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
const block = (page: Page) => page.locator('[data-block-type="math_equation"]');
const editor = (page: Page) => page.getByTestId('editor-content');
const input = (page: Page) => page.getByTestId('math-equation-input');

async function insertEquation(page: Page, formula = 'E=mc^2') {
  await editor(page).click();
  await page.keyboard.type('/math');
  await page.getByTestId('slash-menu-math').click();
  await input(page).fill(formula);
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(block(page).locator('.katex')).toBeVisible();
}
async function openMenu(page: Page) {
  await block(page).first().hover();
  await page.getByTestId('math-equation-options').first().click();
  return page.getByTestId('math-equation-menu');
}

test.beforeEach(async ({ page, integrationsURL }) => {
  await page.route('**/api/ai/*/model/list', (route) =>
    route.fulfill({ json: { code: 0, data: { models: [{ name: 'Auto', metadata: { is_default: true } }] } } })
  );
  await page.route(`**${fixturePath}`, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('math-equation') })
  );
  await page.goto(new URL(fixturePath, integrationsURL).href);
  await expect(page.getByTestId('math-document-snapshot')).toHaveAttribute('data-ready', 'true');
});

test('slash insertion, compact and expanded editing, cancel, and persistence', async ({ page }, testInfo) => {
  await insertEquation(page);
  await block(page).getByRole('button', { name: 'Edit block equation', exact: true }).click();
  await input(page).fill('x^2');
  await expect(page.getByTestId('math-equation-editor').getByRole('button', { name: 'Ask AI', exact: true })).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('compact.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('math-document-snapshot')).toContainText('E=mc^2');
  await block(page).getByRole('button', { name: 'Edit block equation', exact: true }).click();
  await input(page).fill(String.raw`\int_a^b f(x)dx = F(b) - F(a)`);
  await page.getByRole('button', { name: /full screen/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Ask AI', exact: true })).toHaveCount(0);
  await expect(input(page)).toHaveValue(String.raw`\int_a^b f(x)dx = F(b) - F(a)`);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('expanded.png') });
  await input(page).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(block(page).locator('.katex')).toBeVisible();
  await expect(page.getByTestId('math-document-snapshot')).toContainText('F(b) - F(a)');
});

test('inline slash insertion, dollar shortcut, editing errors, and continued typing', async ({ page }, testInfo) => {
  await editor(page).click();
  await page.keyboard.type('/inline equation');
  await page.getByTestId('slash-menu-inlineMath').click();
  await page.getByRole('textbox', { name: 'Inline equation', exact: true }).fill('x^2 + y^2');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.type(' after $a+b$');
  await expect(page.locator('.formula-inline')).toHaveCount(2);
  await page.locator('.formula-inline').first().click();
  await page.getByRole('textbox', { name: 'Inline equation', exact: true }).fill(String.raw`\bc`);
  await expect(page.locator('.formula-inline').first()).toContainText('Undefined control sequence');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('inline.png') });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('math-document-snapshot')).toContainText('\\\\bc');
  await expect(editor(page)).toContainText(' after ');
});

test('$$ opens an empty block; menus disable empty AI actions and duplicate/delete preserve data', async ({
  page,
}, testInfo) => {
  await editor(page).click();
  await page.keyboard.type('$$');
  await expect(input(page)).toBeVisible();
  await expect(input(page)).toHaveAttribute('placeholder', String.raw`|x| = \begin{cases}
 x, &\quad x \geq 0 \\
-x, &\quad x < 0
\end{cases}`);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const menu = await openMenu(page);

  await menu.getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  await menu.getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  await expect(page.getByTestId('math-equation-submenu').getByRole('menuitem', { name: 'Ask AI', exact: true })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Explain equation', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Check equation', exact: true })).toBeDisabled();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('menu.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await block(page).getByRole('button', { name: 'Add a TeX equation', exact: true }).click();
  await input(page).fill('E=mc^2');
  await input(page).press('Enter');
  await (await openMenu(page)).getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await expect(block(page)).toHaveCount(2);
  await expect(block(page).nth(1).locator('.katex')).toBeVisible();
  await (await openMenu(page)).getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(block(page)).toHaveCount(1);
  await (await openMenu(page)).getByRole('menuitem', { name: 'Turn into', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Text', exact: true }).click();
  await expect(block(page)).toHaveCount(0);
  await expect(editor(page)).toContainText('E=mc^2');
});

test('canceling inline slash editing restores typing at the original position', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.type('before /inline equation');
  await page.getByTestId('slash-menu-inlineMath').click();
  await page.getByRole('textbox', { name: 'Inline equation', exact: true }).fill('discard me');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inline-equation-editor')).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('after');
  await expect(editor(page)).toHaveText('before after');
  await expect(page.locator('.formula-inline')).toHaveCount(0);
});

test('$$ focuses the TeX input so typing continues directly into the equation', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.type('$$E=mc^2');
  await expect(input(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue('E=mc^2');
  await page.keyboard.press('Enter');
  await expect(input(page)).toHaveCount(0);
  await expect(block(page).locator('.katex')).toBeVisible();
  await expect(page.getByTestId('math-document-snapshot')).toContainText('E=mc^2');
});

test('$$ opens the editor on new lines after existing equations using the physical keyboard', async ({ page }) => {
  await insertEquation(page);
  for (let i = 0; i < 3; i++) {
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Digit4');
    await page.keyboard.press('Digit4');
    await page.keyboard.up('Shift');
    await expect(input(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
    await page.keyboard.type(`x_${i}`);
    await expect(input(page)).toHaveValue(`x_${i}`);
    await page.keyboard.press('Enter');
    await expect(input(page)).toHaveCount(0);
  }
  await expect(block(page)).toHaveCount(4);
});

test('read-only equations render without editing controls', async ({ page }) => {
  await insertEquation(page);
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await block(page).click();
  await expect(input(page)).toHaveCount(0);
  await expect(page.getByTestId('math-equation-options')).toHaveCount(0);
  await expect(block(page).locator('.katex')).toBeVisible();
});

test('hover clears on mouseleave, including after closing the editor and menu', async ({ page }) => {
  await insertEquation(page);
  const surface = block(page).locator('.math-equation-surface');
  const hoverColor = await surface.evaluate((element) => getComputedStyle(element).getPropertyValue('--block-bg-color-20').trim());

  await surface.hover();
  const background = await surface.evaluate((element) => getComputedStyle(element).backgroundColor);

  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  expect(hoverColor).toBeTruthy();
  await page.mouse.move(5, 5);
  await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await surface.getByRole('button', { name: 'Edit block equation', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.mouse.move(5, 5);
  await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await openMenu(page);
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 5);
  await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(surface.locator('.math-equation-toolbar')).toHaveCSS('opacity', '0');
});

test('compact and expanded sizes stay bounded with long input and short viewports', async ({ page }) => {
  await insertEquation(page);
  await block(page).getByRole('button', { name: 'Edit block equation', exact: true }).click();
  const compact = page.getByTestId('math-equation-editor');

  await expect(compact).toHaveCSS('height', '180px');
  await expect(input(page)).toHaveCSS('height', '112px');
  await input(page).fill(Array.from({ length: 60 }, (_, i) => `x_${i} = ${i}`).join('\n'));
  await expect(compact).toHaveCSS('height', '180px');
  expect(await input(page).evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.getByRole('button', { name: /full screen/i }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('height', '360px');
  await expect(page.getByRole('dialog')).toHaveCSS('width', '560px');
  await expect(input(page)).toHaveCSS('height', '244px');
  await page.setViewportSize({ width: 375, height: 280 });
  const dialog = page.getByRole('dialog');

  await expect(dialog).toHaveCSS('height', '248px');
  await expect(dialog).toHaveCSS('width', '343px');
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeInViewport();
  await input(page).press('Escape');
  await expect(compact).toHaveCSS('height', '180px');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 375, height: 180 });
  await expect(compact).toHaveCSS('height', '148px');
  await expect(page.getByRole('button', { name: 'Insert', exact: true })).toBeInViewport();
  // AppFlowy #8312: neither the editor nor its input may extend past the viewport.
  for (const element of [compact, input(page)]) {
    await expect.poll(async () => (await element.boundingBox())!.x).toBeGreaterThanOrEqual(16);
    await expect.poll(async () => {
      const bounds = (await element.boundingBox())!;

      return bounds.x + bounds.width;
    }).toBeLessThanOrEqual(359);
  }
});

test('six-dot menu matches equation actions and places second-level menus beside it', async ({ page }, testInfo) => {
  await insertEquation(page);
  await block(page).hover();
  await page.getByTestId('drag-block').click();
  const menu = page.getByTestId('math-equation-menu');

  await expect(menu.getByRole('menuitem')).toHaveText(['Delete', 'Duplicate', 'Copy link to block', 'Turn into', 'Ask AI']);
  await expect(menu).toHaveCSS('width', '240px');
  await expect(menu).toHaveCSS('height', '223px');
  const handle = (await page.getByTestId('drag-block').boundingBox())!;

  await expect.poll(async () => {
    const bounds = (await menu.boundingBox())!;

    return Math.abs(bounds.x + bounds.width - handle.x);
  }).toBeLessThan(2);
  await expect.poll(async () => {
    const bounds = (await menu.boundingBox())!;
    const expectedTop = Math.max(16, handle.y + handle.height / 2 - bounds.height / 2);

    return Math.abs(bounds.y - expectedTop);
  }).toBeLessThan(2);
  const deleteRow = menu.getByRole('menuitem', { name: 'Delete', exact: true });
  const normalColor = await deleteRow.evaluate((row) => getComputedStyle(row).color);

  await deleteRow.hover();
  await expect(deleteRow).not.toHaveCSS('color', normalColor);
  const deleteColor = await deleteRow.evaluate((row) => getComputedStyle(row).color);

  await expect(deleteRow.locator('path')).toHaveCSS('stroke', deleteColor);
  const deleteBackground = await deleteRow.evaluate((row) => getComputedStyle(row).backgroundColor);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('delete-hover.png') });
  await menu.getByRole('menuitem', { name: 'Duplicate', exact: true }).hover();
  await expect(menu.getByRole('menuitem', { name: 'Duplicate', exact: true })).toHaveCSS('background-color', deleteBackground);
  await expect(deleteRow).toHaveCSS('color', normalColor);
  await expect(menu.getByRole('menuitem', { name: 'Comment', exact: true })).toHaveCount(0);
  for (const label of ['Ask AI', 'Turn into']) {
    const row = menu.getByRole('menuitem', { name: label, exact: true });

    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(row).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    if (label === 'Ask AI') {
      const icon = row.getByTestId('math-equation-menu-ai-icon');

      await expect(icon).toHaveCSS('width', '20px');
      await expect(icon).toHaveCSS('height', '20px');
      expect((await icon.locator('svg').boundingBox())!.width).toBeCloseTo(15.0013, 1);
      await expect(icon.locator('svg')).toHaveCSS('height', '16px');
    }
    const submenu = page.getByTestId('math-equation-submenu');

    for (let i = 0; i < 2; i++) {
      await row.click();
      await expect(row).toHaveAttribute('aria-expanded', 'true');
      if (label === 'Ask AI') {
        await expect(submenu.getByRole('menuitem')).toHaveText(['Ask AI', 'Explain equation', 'Check equation']);
      } else await expect(submenu.getByRole('menuitem', { name: 'Page', exact: true })).toBeVisible();
    }
    if (label === 'Ask AI') await expect(submenu).toHaveCSS('height', '112px');
    const parentRect = (await menu.boundingBox())!;
    const childRect = (await submenu.boundingBox())!;

    expect(childRect.x >= parentRect.x + parentRect.width || childRect.x + childRect.width <= parentRect.x).toBe(true);
    expect(Math.abs(childRect.y - (await row.boundingBox())!.y)).toBeLessThan(2);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`six-dot-${label}.png`) });
    await page.keyboard.press('Escape');
  }
});

for (const empty of [false, true]) {
  test(`six-dot whole-block selection clears after dismissing the menu (empty=${empty})`, async ({ page }, testInfo) => {
    if (empty) {
      await editor(page).click();
      await page.keyboard.type('$$');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    } else await insertEquation(page);
    const surface = block(page).locator('.math-equation-surface');

    await page.getByRole('checkbox', { name: 'Read only' }).hover();
    const idleBackground = await surface.evaluate((element) => getComputedStyle(element).backgroundColor);

    await block(page).hover();
    await page.getByTestId('drag-block').click();
    await expect(page.getByTestId('math-equation-menu')).toBeVisible();
    await expect(surface).toHaveClass(/is-selected/);
    await expect(surface).not.toHaveCSS('background-color', idleBackground);
    await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).hover();
    await expect(surface).not.toHaveCSS('background-color', idleBackground);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('block-selected.png') });
    if (empty) {
      const askAI = page.getByTestId('math-equation-menu').getByRole('menuitem', { name: 'Ask AI', exact: true });

      await askAI.click();
      await askAI.click();
      await expect(page.getByRole('menuitem', { name: 'Explain equation', exact: true })).toBeDisabled();
      await expect(page.getByRole('menuitem', { name: 'Check equation', exact: true })).toBeDisabled();
      await page.mouse.click(1100, 600);
    }
    else await page.keyboard.press('Escape');
    await expect(page.getByTestId('math-equation-menu')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Read only' }).hover();
    await expect(surface).not.toHaveClass(/is-selected/);
    await expect(surface).toHaveCSS('background-color', idleBackground);
  });
}

test('long equations scroll horizontally inside the block at the Figma font size', async ({ page }) => {
  await insertEquation(page, Array.from({ length: 80 }, (_, i) => `x_{${i}}`).join(' + '));
  const render = block(page).locator('.math-equation-render');

  await expect(render.locator('.katex')).toHaveCSS('font-size', '20px');
  const dimensions = await render.evaluate((element) => ({
    width: element.clientWidth,
    scroll: element.scrollWidth,
    pageWidth: document.documentElement.clientWidth,
    pageScroll: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scroll).toBeGreaterThan(dimensions.width);
  expect(dimensions.pageScroll).toBe(dimensions.pageWidth);
});

test('tall equations grow and shrink with the formula without vertical scrolling inside the block', async ({ page }) => {
  const formula = String.raw`\begin{aligned}
${Array.from({ length: 24 }, (_, i) => String.raw`F_${i}(x) &= \int_0^x \frac{t^${i} e^{-t^2}}{1+t^2}\,dt`).join(' \\\\\n')}
\end{aligned}`;

  await insertEquation(page, formula);
  await page.evaluate(() => document.fonts.ready);
  const render = block(page).locator('.math-equation-render');
  const tallHeight = await block(page).evaluate((element) => element.clientHeight);

  expect(tallHeight).toBeGreaterThan(page.viewportSize()!.height);
  await expect.poll(() => render.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
  const renderedBounds = await render.locator('.katex').boundingBox();
  const blockBounds = await block(page).boundingBox();

  expect(renderedBounds!.y + renderedBounds!.height).toBeLessThanOrEqual(blockBounds!.y + blockBounds!.height);
  await block(page).getByRole('button', { name: 'Edit block equation', exact: true }).click({ position: { x: 20, y: 20 } });
  await input(page).fill('x^2');
  await input(page).press('Enter');
  await expect.poll(() => block(page).evaluate((element) => element.clientHeight)).toBeLessThan(tallHeight / 2);
  await expect.poll(() => render.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
});

test('paste converts multiline Markdown equations and keeps their TeX after reload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const formula = '\\begin{bmatrix}\n1 & 2\\\\\n3 & 4\n\\end{bmatrix}';
  const markdown = `Before $a+b$\n\n$$\n${formula}\n$$\n\n\\[x^2+y^2\\]\n\nAfter`;

  await page.evaluate((text) => navigator.clipboard.writeText(text), markdown);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(block(page)).toHaveCount(2);
  await expect(block(page).first().locator('.katex')).toBeVisible();
  await expect(page.locator('.formula-inline')).toHaveCount(1);
  await expect(editor(page)).toContainText('Before');
  await expect(editor(page)).toContainText('After');
  await page.reload();
  await expect(block(page)).toHaveCount(2);
  const snapshot = JSON.parse((await page.getByTestId('math-document-snapshot').textContent()) || '[]');

  expect(snapshot.find((node: { type: string }) => node.type === 'math_equation').data.formula).toBe(formula);
});

test('paste strips Markdown wrappers in the equation editor without losing the formula', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await insertEquation(page);
  await block(page).getByRole('button', { name: 'Edit block equation', exact: true }).click();
  await page.evaluate(() => navigator.clipboard.writeText('$$\n\\frac{a}{b}\n$$'));
  await input(page).press('ControlOrMeta+a');
  await input(page).press('ControlOrMeta+v');
  await expect(input(page)).toHaveValue('\\frac{a}{b}');
  await input(page).press('Enter');
  await expect(block(page).locator('.katex')).toBeVisible();
});

for (const action of ['generate', 'explain', 'check'] as const) {
  test(`AI ${action}: streams, retries, and inserts the response`, async ({ page }, testInfo) => {
    const requests: Record<string, unknown>[] = [];
    const response = action === 'explain' ? 'The variable $x$ is the unknown.' : '$$x = 2$$';

    await page.route('**/api/ai/*/v2/complete/stream', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ contentType: 'text/event-stream', body: JSON.stringify({ '1': response }) });
    });
    await insertEquation(page, 'x+1=3');
    if (action === 'generate') {
      await (await openMenu(page)).getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
      await page.getByTestId('math-equation-submenu').getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
      await page.getByRole('textbox', { name: 'Ask AI', exact: true }).fill('Solve for x');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
    } else {
      await (await openMenu(page)).getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
      await page
        .getByRole('menuitem', { name: action === 'explain' ? 'Explain equation' : 'Check equation', exact: true })
        .click();
    }
    const panel = page.getByTestId('math-equation-ai');
    const apply = panel.getByRole('button', { name: action === 'explain' ? 'Insert below' : 'Insert', exact: true });

    await expect(apply).toBeEnabled();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('ai.png') });
    await panel.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(apply).toBeEnabled();
    expect(requests[0].completion_type).toBe(8);
    await apply.click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('math-document-snapshot')).toContainText(
      action === 'explain' ? 'The variable ' : 'x = 2'
    );
  });
}

test('submenus switch directly, stay open on repeated clicks, and dismiss from outside', async ({ page }) => {
  await insertEquation(page);
  const menu = await openMenu(page);
  const submenu = page.getByTestId('math-equation-submenu');

  for (const label of ['Ask AI', 'Turn into', 'Ask AI', 'Ask AI']) {
    await menu.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(submenu.getByRole('menuitem', { name: label === 'Ask AI' ? 'Explain equation' : 'Page', exact: true })).toBeEnabled();
    await expect(submenu.getByRole('menuitem', { name: label === 'Ask AI' ? 'Page' : 'Explain equation', exact: true })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await expect(submenu).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Ask AI', exact: true })).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Ask AI', exact: true }).press('Enter');
  await expect(submenu).toBeVisible();
  await page.mouse.click(1100, 600);
  await expect(submenu).toHaveCount(0);
  await expect(menu).toHaveCount(0);
});

test('pasting a copied equation block link uses its formula and the standard mention style', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const formula = String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`;

  await insertEquation(page, formula);
  await (await openMenu(page)).getByRole('menuitem', { name: 'Copy link to block', exact: true }).click();
  // Click the document's blank area below the equation to add a paragraph.
  const bounds = (await editor(page).boundingBox())!;

  await editor(page).click({ position: { x: 20, y: bounds.height - 200 } });
  await editor(page).locator('[data-block-type="paragraph"]').last().click();
  await page.keyboard.press('ControlOrMeta+v');
  const mention = editor(page).locator('.mention-inline');

  await expect(mention.locator('.mention-content')).toHaveText(formula);
  await expect(mention).toHaveCSS('text-decoration-line', 'underline');
  await expect(mention.locator('.mention-content')).toHaveCSS('max-width', '330px');
  await expect(mention.locator('.mention-content')).toHaveCSS('text-overflow', 'ellipsis');
  // AppFlowy #6986: a selected mention cannot become a link or inline equation.
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('selection-toolbar')).toHaveCSS('pointer-events', 'auto');
  await expect(page.getByTestId('toolbar-formula-button')).toBeDisabled();
  await expect(page.getByTestId('link-button')).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await mention.click();
  await expect(block(page)).toHaveClass(/highlight-block/);
  await page.getByRole('button', { name: 'Remote edit', exact: true }).click();
  await expect(mention.locator('.mention-content')).toHaveText('collaborator');
  await page.reload();
  await expect(mention.locator('.mention-content')).toHaveText('collaborator');
});

test('copies a block link and turns the equation into a child page', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await insertEquation(page);
  await (await openMenu(page)).getByRole('menuitem', { name: 'Copy link to block', exact: true }).click();
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  const snapshot = JSON.parse((await page.getByTestId('math-document-snapshot').textContent()) || '[]');

  expect(copied.searchParams.get('blockId')).toBe(snapshot[0].blockId);
  await (await openMenu(page)).getByRole('menuitem', { name: 'Turn into', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
  await expect(block(page)).toHaveCount(0);
  await expect(page.getByTestId('math-document-snapshot')).toContainText('equation-child-page');
});

test('keyboard toggling converts selected text to inline math and back', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.type('x^2');
  const modifier = await page.evaluate(() => (/Mac|iPod|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control'));

  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('x^2');
  await page.keyboard.press(`${modifier}+Shift+e`);
  await expect(page.locator('.formula-inline')).toHaveCount(1);
  await expect(page.locator('.formula-inline')).toHaveClass(/selected/);
  await page.keyboard.press(`${modifier}+Shift+e`);
  await expect(page.locator('.formula-inline')).toHaveCount(0);
  await expect(editor(page)).toContainText('x^2');
});

test('inline math scales with H3 text (AppFlowy #6053)', async ({ page }, testInfo) => {
  await editor(page).click();
  await page.keyboard.type('Body $x^2$');
  await expect(page.locator('.formula-inline .katex')).toBeVisible();
  const bodySize = await page.locator('.formula-inline').evaluate((element) => ({
    text: parseFloat(getComputedStyle(element).fontSize),
    math: parseFloat(getComputedStyle(element.querySelector('.katex')!).fontSize),
  }));

  await page.keyboard.press('Enter');
  await page.keyboard.type('/heading 3');
  await page.getByTestId('slash-menu-heading3').click();
  await page.keyboard.type('Heading $x^2$');
  const heading = page.locator('.heading.level-3');

  await expect(heading.locator('.formula-inline .katex')).toBeVisible();
  const headingSize = await heading.locator('.formula-inline').evaluate((element) => ({
    text: parseFloat(getComputedStyle(element).fontSize),
    math: parseFloat(getComputedStyle(element.querySelector('.katex')!).fontSize),
  }));

  expect(headingSize.text).toBeGreaterThan(bodySize.text);
  expect(headingSize.math / bodySize.math).toBeCloseTo(headingSize.text / bodySize.text, 2);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('heading-math.png') });
});

test('the reported multiline equation renders without an exception (AppFlowy #6411)', async ({ page }) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  const source = String.raw`M \times X = Y \\ M \times M^{-1} \times X = Y`;

  await insertEquation(page, source);
  await expect(block(page).getByRole('status')).toHaveCount(0);
  await block(page).getByRole('button', { name: 'Edit block equation', exact: true }).click();
  await expect(input(page)).toHaveValue(source);
  expect(errors).toEqual([]);
});

test('Flutter selection toolbar inserts and removes inline math without changing adjacent text', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.type('Before x^2', { delay: 20 });
  await expect(page.getByTestId('math-document-snapshot')).toContainText('Before x^2');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  const formulaButton = page.getByTestId('toolbar-formula-button');

  await expect(page.getByTestId('selection-toolbar')).toHaveCSS('pointer-events', 'auto');
  await formulaButton.click();
  await expect(page.locator('.formula-inline')).toHaveCount(1);
  await expect(editor(page)).toContainText('Before ');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' after');
  await expect(page.locator('.formula-inline')).toHaveCount(1);
  await expect(editor(page)).toContainText(' after');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  // Chrome first selects the zero-width boundary after the non-editable formula.
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(formulaButton).toHaveAttribute('aria-pressed', 'true');
  await formulaButton.click();
  await expect(page.locator('.formula-inline')).toHaveCount(0);
  await expect(editor(page)).toContainText('Before x^2 after');
});

test('a whole-string display shortcut preserves text, and editing supports undo/redo', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.insertText('before $$x^2$$ after');
  await expect(block(page)).toHaveCount(1);
  await expect(editor(page)).toContainText('before ');
  await expect(editor(page)).toContainText(' after');
  await block(page).getByRole('button', { name: 'Edit block equation', exact: true }).click();
  await input(page).fill('y^2');
  await input(page).press('Enter');
  await expect(page.getByTestId('math-document-snapshot')).toContainText('y^2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('math-document-snapshot')).toContainText('x^2');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByTestId('math-document-snapshot')).toContainText('y^2');
});

test('AI never overwrites an equation changed while reviewing the response', async ({ page }) => {
  await page.route('**/api/ai/*/v2/complete/stream', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: JSON.stringify({ '1': '$$x=2$$' }) })
  );
  await insertEquation(page, 'x+1=3');
  await (await openMenu(page)).getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Check equation', exact: true }).click();
  const panel = page.getByTestId('math-equation-ai');

  await expect(panel.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remote edit', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('math-document-snapshot')).toContainText('collaborator');
});
