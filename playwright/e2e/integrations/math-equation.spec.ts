import { expect, Page } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

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
  await page.route('**/math-equation-fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('math-equation') })
  );
  await page.goto(new URL('/math-equation-fixture', integrationsURL).href);
  await expect(page.getByTestId('math-document-snapshot')).toHaveAttribute('data-ready', 'true');
});

test('slash insertion, compact and expanded editing, cancel, and persistence', async ({ page }, testInfo) => {
  await insertEquation(page);
  await block(page).getByRole('button', { name: 'Edit Math Equation', exact: true }).click();
  await input(page).fill('x^2');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('compact.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('math-document-snapshot')).toContainText('E=mc^2');
  await block(page).getByRole('button', { name: 'Edit Math Equation', exact: true }).click();
  await input(page).fill(String.raw`\int_a^b f(x)dx = F(b) - F(a)`);
  await page.getByRole('button', { name: /full screen/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
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
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const menu = await openMenu(page);

  await menu.getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
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

test('read-only equations render without editing controls', async ({ page }) => {
  await insertEquation(page);
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await block(page).click();
  await expect(input(page)).toHaveCount(0);
  await expect(page.getByTestId('math-equation-options')).toHaveCount(0);
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
      await block(page).getByRole('button', { name: 'Edit Math Equation', exact: true }).click();
      await input(page).fill('Solve for x');
      await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Ask AI', exact: true })).toHaveValue('Solve for x');
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

test('copies a block link and turns the equation into a child page', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await insertEquation(page);
  await (await openMenu(page)).getByRole('menuitem', { name: 'Copy link to block', exact: true }).click();
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  const snapshot = JSON.parse((await page.getByTestId('math-document-snapshot').textContent()) || '[]');

  expect(copied.searchParams.get('blockId')).toBe(snapshot[0].blockId);
  await (await openMenu(page)).getByRole('menuitem', { name: 'Turn into', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Doc', exact: true }).click();
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

test('a whole-string display shortcut preserves text, and editing supports undo/redo', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.insertText('before $$x^2$$ after');
  await expect(block(page)).toHaveCount(1);
  await expect(editor(page)).toContainText('before ');
  await expect(editor(page)).toContainText(' after');
  await block(page).getByRole('button', { name: 'Edit Math Equation', exact: true }).click();
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
