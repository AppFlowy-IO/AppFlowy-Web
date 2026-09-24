import { expect, test } from '@playwright/test';

import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { createNamedDocumentPage, waitForDocumentTextOnServer } from '../../support/duplicate-test-helpers';
import { generateRandomEmail, TestConfig } from '../../support/test-config';

test('slash-created subpages persist, follow renames, and duplicate their content', async ({ page, request }) => {
  const childName = `Subpage-${Date.now()}`;
  const childContent = 'Content belonging to the child page';

  await signUpAndLoginWithPasswordViaUi(page, request, generateRandomEmail());
  const parentId = await createNamedDocumentPage(page, `Parent-${Date.now()}`);
  const parentUrl = page.url();
  const parentEditor = page.locator(`#editor-${parentId}`);

  await parentEditor.click();
  await page.keyboard.type('/subpage');
  await page.getByTestId('slash-menu-document').filter({ hasText: 'Subpage' }).click();
  const dialog = page.getByRole('dialog').last();

  await expect(dialog).toBeVisible();
  await dialog.getByTestId('page-title-input').fill(childName);
  await dialog.getByTestId('editor-content').click();
  await page.keyboard.type(childContent);
  const blocks = parentEditor.locator('[data-block-type="sub_page"]');

  await expect(blocks).toHaveText(childName);
  const originalId = await blocks.locator('[data-mention-id]').getAttribute('data-mention-id');

  expect(originalId).toBeTruthy();

  // Typing finishes locally before all edits have reached the server.
  await waitForDocumentTextOnServer(page, TestConfig.apiUrl, originalId!, childContent);

  // Return through a reload so rendering must resolve the persisted child ID.
  await page.goto(parentUrl);
  await expect(blocks).toHaveText(childName, { timeout: 30_000 });
  await expect(blocks.locator('[data-mention-id]')).toHaveAttribute('data-mention-id', originalId!);
  await blocks.hover();
  await page.getByTestId('drag-block').click();
  await page.getByTestId('controls-menu').getByTestId('duplicate').click();
  await expect(blocks).toHaveCount(2, { timeout: 30_000 });
  const copy = blocks.filter({ hasText: `${childName} (Copy)` });

  await expect(copy).toBeVisible();
  const copiedId = await copy.locator('[data-mention-id]').getAttribute('data-mention-id');

  expect(copiedId).toBeTruthy();
  expect(copiedId).not.toBe(originalId);
  await copy.getByText(`${childName} (Copy)`, { exact: true }).click();
  await expect(page.locator(`#editor-${copiedId}`)).toContainText(childContent);
});
