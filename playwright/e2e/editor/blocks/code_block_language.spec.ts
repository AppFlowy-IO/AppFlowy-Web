import { expect, test } from '@playwright/test';

import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';
import { generateRandomEmail, setupPageErrorHandling } from '../../../support/test-config';

test('code block language can be changed by pointer and persists after reload', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await signInAndWaitForApp(page, request, generateRandomEmail());

  const viewId = await createDocumentPageAndNavigate(page);
  const editor = page.locator(`#editor-${viewId}`);
  const codeBlock = editor.locator('[data-block-type="code"]');
  const code = codeBlock.locator('code');
  const codeText = 'const message = "hello";\n  console.log(message);';

  await editor.locator('[data-block-type="paragraph"]').first().click();
  await page.keyboard.type('/');
  await expect(page.getByTestId('slash-panel')).toBeVisible();
  await page.keyboard.type('code');
  await page.getByTestId('slash-menu-code').click();
  await expect(codeBlock).toHaveCount(1);
  await code.click();
  await page.keyboard.insertText(codeText);
  await expect.poll(() => code.innerText()).toBe(codeText);

  for (const [currentLanguage, nextLanguage] of [
    ['Auto', 'JavaScript'],
    ['JavaScript', 'TypeScript'],
  ]) {
    await test.step(`Change ${currentLanguage} to ${nextLanguage}`, async () => {
      await codeBlock.hover();
      // Keep normal hit testing: forced clicks would hide the overlay regression from PR #358.
      await codeBlock.getByRole('button', { name: currentLanguage, exact: true }).click();

      const languageMenu = page.locator('.MuiPopover-paper').filter({
        has: page.getByPlaceholder('Search', { exact: true }),
      });

      await expect(languageMenu).toBeVisible();
      await languageMenu.getByRole('textbox').fill(nextLanguage);
      await languageMenu.getByText(nextLanguage, { exact: true }).click();
      await expect(languageMenu).not.toBeVisible();
      await codeBlock.hover();
      await expect(codeBlock.getByRole('button', { name: nextLanguage, exact: true })).toBeVisible();
      await expect.poll(() => code.innerText()).toBe(codeText);
    });
  }

  await page.reload();
  await expect(codeBlock).toHaveCount(1);
  await codeBlock.hover();
  await expect(codeBlock.getByRole('button', { name: 'TypeScript', exact: true })).toBeVisible();
  await expect.poll(() => code.innerText()).toBe(codeText);
});
