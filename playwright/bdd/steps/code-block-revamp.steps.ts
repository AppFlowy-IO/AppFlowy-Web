import { expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { BlockSelectors, EditorSelectors } from '../../support/selectors';

const { When, Then } = createBdd();

const codeBlock = (page: Page, index: number) => BlockSelectors.blockByType(page, 'code').nth(index);
const codeMenu = (page: Page) => page.getByTestId('code-block-menu');
const openedPage = (page: Page) => page.getByRole('dialog').filter({ has: page.getByTestId('view-modal-close') });

async function openCodeOptions(page: Page, index = 0) {
  const block = codeBlock(page, index);

  // The floating toolbar is revealed on hover; keep normal hit testing.
  await block.hover();
  await block.getByTestId('code-block-options').click();
  await expect(codeMenu(page)).toBeVisible();
}

/** Open a block's six-dot menu; the first layout pass can reset hover controls. */
async function openSixDotMenu(page: Page, target: Locator) {
  await expect(async () => {
    await page.mouse.move(0, 0);
    await target.hover();
    await expect(BlockSelectors.hoverControls(page)).toHaveCSS('opacity', '1', { timeout: 500 });
  }).toPass({ timeout: 10000 });
  await BlockSelectors.dragHandle(page).click();
}

When(
  'I choose code language {string} by searching {string}',
  async ({ page }, language: string, search: string) => {
    const block = codeBlock(page, 0);

    await block.hover();
    await block.getByRole('button', { name: /^Language: / }).click();
    const menu = page.getByTestId('code-language-menu');

    await expect(menu).toBeVisible();
    await menu.getByRole('combobox').fill(search);
    await menu.getByRole('option', { name: language, exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(block.locator('.code-language-trigger')).toHaveText(language);
  }
);

When('I toggle {string} in the code block options menu', async ({ page }, option: string) => {
  await openCodeOptions(page);
  const item = codeMenu(page).getByRole('menuitemcheckbox', { name: option, exact: true });
  const checked = (await item.getAttribute('aria-checked')) === 'true';

  await item.click();
  // Switches keep the menu open, matching Flutter.
  await expect(item).toHaveAttribute('aria-checked', String(!checked));
  await page.keyboard.press('Escape');
  await expect(codeMenu(page)).toBeHidden();
});

When('I choose {string} from the code block options menu', async ({ page }, option: string) => {
  await openCodeOptions(page);
  await codeMenu(page).getByRole('menuitem', { name: option, exact: true }).click();
  await expect(codeMenu(page)).toBeHidden();
});

When('I add the code block caption {string}', async ({ page }, caption: string) => {
  await openCodeOptions(page);
  await codeMenu(page).getByRole('menuitem', { name: 'Add caption', exact: true }).click();
  const input = codeBlock(page, 0).getByRole('textbox', { name: 'Caption', exact: true });

  await expect(input).toBeFocused();
  await page.keyboard.type(caption);
  await expect(input).toHaveValue(caption);
});

When('I type {string} in code block {int}', async ({ page }, text: string, index: number) => {
  await expect(codeBlock(page, index)).toBeVisible();
  await page.keyboard.type(text, { delay: 20 });
});

When('I reload the code block document', async ({ page }) => {
  // Allow the last local update to reach the server before the page unloads.
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(EditorSelectors.firstEditor(page)).toBeVisible({ timeout: 30000 });
  await expect(BlockSelectors.blockByType(page, 'code').first()).toBeVisible({ timeout: 30000 });
});

When('I set the Mermaid display mode to {string}', async ({ page }, mode: string) => {
  const block = codeBlock(page, 0);

  await block.hover();
  await block.getByTestId('code-toolbar').getByRole('button', { name: 'Display', exact: true }).click();
  await codeMenu(page).getByRole('menuitemradio', { name: mode, exact: true }).click();
  await expect(codeMenu(page)).toBeHidden();
});

When('I turn code block {int} into a page from its six-dot menu', async ({ page }, index: number) => {
  await openSixDotMenu(page, codeBlock(page, index).locator('code'));
  await codeMenu(page).getByRole('menuitem', { name: 'Turn into', exact: true }).click();
  await page.getByTestId('code-block-submenu').getByRole('menuitem', { name: 'Page', exact: true }).click();
});

When('I turn the callout {string} into a page from its six-dot menu', async ({ page }, title: string) => {
  // Hover the title row: the callout's centre can belong to a nested body block.
  await openSixDotMenu(page, page.getByTestId('callout').first().getByText(title, { exact: true }));
  await BlockSelectors.controlsMenu(page).getByRole('button', { name: 'Turn into', exact: true }).click();
  await page.getByTestId('turn-into-menu').getByRole('button', { name: 'Page', exact: true }).click();
});

When('I return to the document editor', async ({ page }) => {
  // The page modal does not restore focus; clicking the only block would open the new page.
  await EditorSelectors.firstEditor(page).focus();
  await expect(EditorSelectors.firstEditor(page)).toBeFocused();
});

When('I close the opened page', async ({ page }) => {
  await openedPage(page).getByTestId('view-modal-close').click();
  await expect(openedPage(page)).toBeHidden();
});

Then('code block {int} shows language {string}', async ({ page }, index: number, language: string) => {
  await expect(codeBlock(page, index).locator('.code-language-trigger')).toHaveText(language);
});

Then('code block {int} has its language pinned', async ({ page }, index: number) => {
  const trigger = codeBlock(page, index).locator('.code-language-trigger');

  await expect(trigger).toHaveAttribute('data-pinned', 'true');
  // A pinned language stays visible without hovering the block.
  await page.mouse.move(0, 0);
  await expect(trigger).toBeVisible();
});

Then('code block {int} wraps long lines', async ({ page }, index: number) => {
  await expect(codeBlock(page, index).locator('pre.code-block-source')).toHaveClass(/\bis-wrapped\b/);
});

Then('code block {int} has caption {string}', async ({ page }, index: number, caption: string) => {
  await expect(codeBlock(page, index).getByRole('textbox', { name: 'Caption', exact: true })).toHaveValue(caption);
});

Then('code block {int} has no rich text formatting', async ({ page }, index: number) => {
  // Mark renderers: bold/italic/underline/strike elements, inline code (.font-medium) and colors.
  await expect(
    codeBlock(page, index).locator('code').locator('strong, em, u, s, a, .font-medium, .text-color, .bg-color')
  ).toHaveCount(0);
});

Then('code block {int} renders a Mermaid diagram', async ({ page }, index: number) => {
  // Mermaid is loaded on demand; a production chunk failure would leave only the status text.
  await expect(codeBlock(page, index).getByTestId('mermaid-diagram').locator('svg')).toBeVisible({ timeout: 30000 });
});

Then('code block {int} shows only the Mermaid preview', async ({ page }, index: number) => {
  const block = codeBlock(page, index);

  // The source stays mounted for Slate selection but is visually removed.
  await expect(block.locator('pre.code-block-source')).toHaveClass(/\bcode-source-hidden\b/);
  await expect(block.locator('pre.code-block-source')).toHaveCSS('opacity', '0');
  await expect(block.getByTestId('mermaid-diagram')).toBeVisible({ timeout: 30000 });
});

Then(
  'the new page opens with a {string} code block containing:',
  async ({ page }, language: string, text: string) => {
    const dialog = openedPage(page);

    await expect(dialog).toBeVisible({ timeout: 30000 });
    const block = dialog.locator('[data-block-type="code"]');

    await expect(block).toHaveCount(1, { timeout: 30000 });
    await expect(block.locator('.code-language-trigger')).toHaveText(language);
    await expect.poll(() => block.locator('code').innerText()).toBe(text);
  }
);

Then(
  'the new page opens titled {string} with a callout containing {string}',
  async ({ page }, title: string, body: string) => {
    const dialog = openedPage(page);

    await expect(dialog).toBeVisible({ timeout: 30000 });
    await expect(dialog.locator('[id^="editor-title-"]')).toHaveText(title, { timeout: 30000 });
    const callout = dialog.getByTestId('callout');

    await expect(callout).toHaveCount(1, { timeout: 30000 });
    await expect(callout).toContainText(title);
    await expect(callout.locator('[data-block-type="paragraph"]')).toHaveText(body);
  }
);
