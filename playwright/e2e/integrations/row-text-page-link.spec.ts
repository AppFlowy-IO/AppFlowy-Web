import { expect } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

const route = '/app/2f8365f8-ce19-4376-8ba0-2b4948ed0f4a/d996a5f3-0bca-40ed-96b7-5938de6cdd5d';

// Local runs can pin Chrome for Testing; otherwise Playwright uses its managed
// testing browser. Both launch fresh profiles independent of everyday Chrome.
test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_FOR_TESTING_EXECUTABLE } });

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test('a page link pasted into a Text property renders and saves a mention', async ({ page, integrationsURL }, info) => {
      const errors: string[] = [];

      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(`**${route}`, (request) => request.fulfill({
        contentType: 'text/html', body: fixtureHTML('row-text-page-link'),
      }));
      await page.goto(new URL(route, integrationsURL).href);
      await expect(page.locator('html')).toHaveAttribute('data-dark-mode', colorScheme === 'dark' ? 'true' : 'false');
      const editor = page.getByTestId('rich-text-cell-editor');

      await expect(editor).toBeVisible({ timeout: 60_000 });
      await editor.click();
      // A real DOM paste event exercises Slate's input handler without
      // changing the developer's system clipboard or application state.
      await editor.evaluate((element) => {
        const data = new DataTransfer();

        data.setData('text/plain', location.href);
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      });
      await expect(editor.locator('.mention-inline')).toContainText('Mention target');
      await page.keyboard.press('Enter');
      await expect(editor).toHaveCount(0);
      await expect(page.getByTestId('saved-cell')).toContainText('"data":"Mention target"');
      const savedCell = JSON.parse(await page.getByTestId('saved-cell').innerText());

      expect(JSON.parse(savedCell.rich_text).delta).toEqual([
        expect.objectContaining({ attributes: expect.objectContaining({ mention: expect.objectContaining({ type: 'page' }) }) }),
      ]);
      await expect(page.getByTestId('notes-property').locator('.mention-inline')).toHaveText('Mention target');
      await expect(page.getByTestId('notes-property').locator('.mention-inline')).toHaveCSS('text-decoration-line', 'underline');

      await page.getByTestId('edit-notes').click();
      await expect(editor.locator('.mention-inline')).toContainText('Mention target');
      await page.keyboard.press('Enter');
      await page.reload();
      await expect(page.getByTestId('notes-property').locator('.mention-inline')).toHaveText('Mention target');
      await page.screenshot({ path: info.outputPath('row-text-page-mention.png') });
      expect(errors).toEqual([]);
    });
  });
}
