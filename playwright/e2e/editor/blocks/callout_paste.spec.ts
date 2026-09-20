import { expect, test } from '@playwright/test';

import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import { AddPageSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

const plainText =
  'Identity source: Entra ID\nTwo findings worth documenting:\n- Configure the SCIM route\n- Use supported user attributes\nGroups are visible';
const html =
  '<p>Identity source: <strong>Entra ID</strong></p><p>Two findings worth documenting:</p><ul><li>Configure the SCIM route</li><li>Use supported user attributes</li></ul><p>Groups are visible</p>';

for (const paste of ['rich text', 'plain text'] as const) {
  test(`pasting ${paste} keeps multiline content inside the callout in a document modal`, async ({ page, request }) => {
    await signInAndWaitForApp(page, request, generateRandomEmail());
    await AddPageSelectors.inlineAddButton(page).first().click();
    await AddPageSelectors.addDocumentButton(page).click();

    const dialog = page.getByRole('dialog').last();
    const editor = dialog.locator('[data-slate-editor="true"]');
    const callout = editor.locator('[data-block-type="callout"]');

    await editor.click();
    await page.keyboard.type('/callout');
    await page.getByTestId('slash-menu-callout').click();
    await expect(callout).toBeVisible();
    await callout.click({ position: { x: 100, y: 20 } });
    // Keep creation and paste in separate undo groups (the editor uses 200 ms).
    await page.waitForTimeout(250);

    await page.evaluate(
      async ({ html, plainText, richText }) => {
        // The browser's Paste and Match Style menu supplies only text/plain.
        // The app's keyboard shortcut has its own separate insertion handler.
        if (!richText) {
          await navigator.clipboard.writeText(plainText);
          return;
        }

        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ]);
      },
      { html, plainText, richText: paste === 'rich text' }
    );
    await page.keyboard.press('ControlOrMeta+v');

    await expect(callout).toContainText('Identity source: Entra ID');
    await expect(callout).toContainText('Two findings worth documenting:');
    await expect(callout).toContainText('Configure the SCIM route');
    await expect(callout).toContainText('Use supported user attributes');
    await expect(callout).toContainText('Groups are visible');
    await expect(callout.locator('[data-block-type="bulleted_list"]')).toHaveCount(2);
    await expect(editor.locator(':scope > [data-block-type]')).toHaveCount(1);
    if (paste === 'rich text') await expect(callout.locator('strong')).toHaveText('Entra ID');

    // Check the caret before undo, keeping the typing in a separate undo group.
    await page.waitForTimeout(250);
    await page.keyboard.type(' after paste');
    await expect(callout).toContainText('Groups are visible after paste');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(callout).not.toContainText(' after paste');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(callout).not.toContainText('Identity source:');
    await expect(editor.locator(':scope > [data-block-type]')).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+v');
    await expect(callout).toContainText('Identity source: Entra ID');
    await expect(callout).toContainText('Groups are visible');
    await expect(editor.locator(':scope > [data-block-type]')).toHaveCount(1);
  });
}
