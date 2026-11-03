import { expect, Page } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

// The code-block fixture is a plain document editor on a local Y.Doc. Its
// snapshot output is the saved document model, not the rendered DOM.
const fixturePath = '/app/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
const editor = (page: Page) => page.getByTestId('editor-content');
const snapshot = (page: Page) => page.getByTestId('code-document-snapshot');
const lastLine = (page: Page) => editor(page).locator('.text-element').last();

type DocumentNode = { text?: string; children?: DocumentNode[] };

/** The text of each top-level block in the saved document. */
async function documentLines(page: Page) {
  const text = (node: DocumentNode): string => node.text ?? (node.children ?? []).map(text).join('');

  return (JSON.parse((await snapshot(page).textContent()) || '[]') as DocumentNode[]).map(text);
}

async function expectCaretOnEmptyLastLine(page: Page) {
  await expect(lastLine(page).locator('.text-placeholder')).toHaveAttribute(
    'data-placeholder',
    "Type '/' to insert a block, or start typing"
  );
}

test.beforeEach(async ({ page, integrationsURL }) => {
  await page.route('**/api/ai/*/model/list', (route) =>
    route.fulfill({ json: { code: 0, data: { models: [{ name: 'Auto', metadata: { is_default: true } }] } } })
  );
  await page.route(`**${fixturePath}*`, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('code-block') })
  );
  // Firefox fires `load` only after the whole unbundled editor graph has loaded
  // (about 20s on the dev server), so wait for the fixture's own readiness.
  await page.goto(new URL(fixturePath, integrationsURL).href, { waitUntil: 'commit' });
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
});

// Firefox moves the caret from an empty line into any editable element inside
// the line's block that is not part of the document. Slate cannot map input
// there, so the browser used to insert the text natively: it showed over the
// placeholder and was never saved. Chromium and WebKit keep the caret in the line.
test('text typed after leaving an empty line is saved, and the AI writer preview cannot take the caret', async ({
  page,
}) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));

  await test.step('pressing ArrowDown on an empty line', async () => {
    await lastLine(page).click();
    // The editor overlay (panels, toolbars and the AI writer) loads lazily.
    // Opening the slash menu shows it is mounted before the caret moves.
    await page.keyboard.type('/');
    await expect(page.getByTestId('slash-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('slash-panel')).toHaveCount(0);
    await page.keyboard.press('Backspace');
    await expectCaretOnEmptyLastLine(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('First line');
    await expect.poll(() => documentLines(page)).toEqual(['First line']);
  });

  await test.step('clicking below an empty line', async () => {
    await page.keyboard.press('Enter');
    await expectCaretOnEmptyLastLine(page);
    const line = (await lastLine(page).boundingBox())!;

    await page.mouse.click(line.x + 200, line.y + line.height + 120);
    await page.keyboard.type('Second line');
    await expect.poll(() => documentLines(page)).toEqual(['First line', 'Second line']);
  });

  await test.step('the AI writer over an empty line', async () => {
    await page.route('**/api/ai/*/v2/complete/stream', (route) =>
      route.fulfill({ json: { '1': 'An answer from AppFlowy AI.' } })
    );
    // The writer's source picker loads the workspace's pages.
    await page.route('**/api/workspace/*/view/*{,?**}', (route) =>
      route.fulfill({ json: { code: 0, data: { view_id: 'workspace', name: 'Workspace', children: [] } } })
    );
    await page.keyboard.press('Enter');
    await expectCaretOnEmptyLastLine(page);
    await page.keyboard.type('/ask');
    await page.getByTestId('slash-menu-askAIAnything').click();
    await page.getByPlaceholder('Ask AppFlowy AI').fill('Write one sentence');
    await page.keyboard.press('Enter');

    // The preview is rendered inside the editable document, in the empty line's block.
    const preview = editor(page).locator('#appflowy-ai-writer');

    await expect(preview).toContainText('An answer from AppFlowy AI.');
    await expect(preview).toHaveJSProperty('isContentEditable', false);
    await page.getByRole('button', { name: 'Keep', exact: true }).click();
    await expect
      .poll(() => documentLines(page))
      .toEqual(['First line', 'Second line', 'An answer from AppFlowy AI.']);
    await expect(page.locator('#appflowy-ai-writer')).toHaveCount(0);
  });

  expect(errors).toEqual([]);
});
