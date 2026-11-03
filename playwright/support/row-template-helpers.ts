import { expect, type Locator, type Page } from '@playwright/test';

import { closeRowDetailWithEscape, getVisibleDataRowIds } from './row-detail-helpers';
import { RowDetailSelectors } from './selectors';

const TEMPLATE_MENU = 'database-template-menu';
const TEMPLATE_EDITOR = 'database-template-editor';

export async function openTemplateMenu(page: Page): Promise<Locator> {
  await page.getByTestId('database-template-menu-trigger').click();
  const menu = page.getByTestId(TEMPLATE_MENU);

  await expect(menu).toBeVisible();
  return menu;
}

export async function closeTemplateEditor(page: Page): Promise<void> {
  const editor = page.getByTestId(TEMPLATE_EDITOR);

  if (!(await editor.isVisible().catch(() => false))) return;
  const dialogRoot = page.locator('.MuiDialog-root').filter({ has: editor });
  const dialogContainer = dialogRoot.locator('.MuiDialog-container');

  await expect(dialogContainer).toBeVisible();
  await dialogContainer.click({ force: true, position: { x: 5, y: 5 } });
  await expect(editor).toBeHidden({ timeout: 15000 });
}

export async function createTemplate(page: Page, name: string): Promise<Locator> {
  const menu = await openTemplateMenu(page);

  await menu.getByTestId('database-template-create').click();
  const editor = page.getByTestId(TEMPLATE_EDITOR);

  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.getByTestId('row-title-input').fill(name);
  await expect(editor.getByTestId('row-title-input')).toHaveText(name);
  return editor;
}

export async function openTemplateActions(page: Page, name: string): Promise<void> {
  await openTemplateMenu(page);
  await page.getByLabel(`Actions for ${name}`, { exact: true }).click();
}

export async function editTemplate(page: Page, name: string): Promise<Locator> {
  await openTemplateActions(page, name);
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const editor = page.getByTestId(TEMPLATE_EDITOR);

  await expect(editor).toBeVisible({ timeout: 30000 });
  return editor;
}

export async function selectTemplate(page: Page, name: string): Promise<void> {
  const menu = await openTemplateMenu(page);

  await menu.getByText(name, { exact: true }).click();
  await expect(menu).toBeHidden();
}

export async function createRowAndGetId(page: Page, create: () => Promise<void>): Promise<string> {
  const before = await getVisibleDataRowIds(page);

  await create();
  let createdId = '';

  await expect
    .poll(
      async () => {
        const after = await getVisibleDataRowIds(page);

        createdId = after.find((rowId) => !before.includes(rowId)) ?? '';
        return createdId;
      },
      { timeout: 30000, message: 'Expected one newly visible database row' }
    )
    .not.toBe('');

  // Template-backed creation opens the new row after its document has been
  // materialized. Wait for the peek before closing it so the next template
  // action starts after row detail has finished opening.
  await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 30000 });
  await closeRowDetailWithEscape(page);

  return createdId;
}

export async function addDatabaseView(page: Page, block: Locator, layout: 'Board' | 'Calendar' | 'Chart' = 'Board') {
  const tabs = block.locator('[data-testid^="view-tab-"]');

  // The embedded block appears before its database finishes loading. Count the
  // existing tabs only after the initial view has rendered.
  await expect(tabs.first()).toBeVisible({ timeout: 30000 });
  const initialCount = await tabs.count();
  const addViewButton = block.getByTestId('add-view-button');
  const menu = page.locator('[data-slot="dropdown-menu-content"]:visible').last();

  await expect(addViewButton).toBeVisible({ timeout: 30000 });
  await addViewButton.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt++) {
    await addViewButton.click();
    if (
      await menu.waitFor({ state: 'visible', timeout: 3000 }).then(
        () => true,
        () => false
      )
    )
      break;
  }

  await expect(menu).toBeVisible({ timeout: 10000 });
  await menu
    .getByRole('menuitem')
    .filter({ hasText: new RegExp(`^\\s*${layout}\\s*$`) })
    .click({ force: true });
  await expect(tabs).toHaveCount(initialCount + 1, { timeout: 30000 });
  await tabs.first().click({ force: true });
  await expect(block.locator('[data-testid^="grid-cell-"]').first()).toBeVisible({ timeout: 30000 });
}

export async function expectDatabaseBlockViews(block: Locator, expectedCount: number): Promise<void> {
  await expect(block.locator('[data-testid^="view-tab-"]')).toHaveCount(expectedCount, { timeout: 30000 });
}

export async function setDefaultTemplate(page: Page, name: string): Promise<void> {
  await openTemplateActions(page, name);
  await page.getByRole('menuitem', { name: 'Set as default', exact: true }).click();
}
