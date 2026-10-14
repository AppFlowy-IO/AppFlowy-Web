import { expect, test, type Page } from '@playwright/test';

import { createDocumentPageAndNavigate } from '../../support/page-utils';

// Model the navigation boundary only: the existing page remains mounted while
// the newly created document is in ViewModal. No backend or account is used.
async function mountPendingNavigation(page: Page) {
  await page.route('http://document-navigation.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `
        <div id="root"><div id="editor-existing" data-testid="editor-content">Existing document</div></div>
        <button data-testid="inline-add-page" hidden>Stale hidden add</button>
        <button data-testid="inline-add-page">Add</button>
        <button data-testid="add-document-button" hidden>Document</button>
        <div role="dialog" hidden>
          <button aria-label="Open as a Page">Expand</button>
          <div id="editor-created" data-testid="editor-content">New document</div>
        </div>
        <script>
          document.querySelector('[data-testid="inline-add-page"]:not([hidden])').onclick = () => {
            document.querySelector('[data-testid="add-document-button"]').hidden = false;
          };
          document.querySelector('[data-testid="add-document-button"]').onclick = () => {
            document.querySelector('[role="dialog"]').hidden = false;
          };
          document.querySelector('[aria-label="Open as a Page"]').onclick = (event) => {
            event.target.disabled = true;
          };
        </script>`,
    })
  );
  await page.goto('http://document-navigation.test/app/workspace/existing');
}

test('does not accept the previous document while expansion navigation is stalled', async ({ page }) => {
  await mountPendingNavigation(page);
  page.setDefaultNavigationTimeout(250);

  await expect(createDocumentPageAndNavigate(page)).rejects.toThrow(/waitForURL/);
  await expect(page.locator('#root #editor-existing')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('returns the created document only after expansion reaches its full-page editor', async ({ page }) => {
  await mountPendingNavigation(page);
  const navigation = createDocumentPageAndNavigate(page);

  await expect(page.getByRole('button', { name: 'Open as a Page' })).toBeDisabled();

  // Release the pending navigation explicitly, independently of elapsed time.
  await page.evaluate(() => {
    history.pushState({}, '', '/app/workspace/created');
    const editor = document.querySelector('#editor-created')!;

    document.querySelector('#root')!.replaceChildren(editor);
    document.querySelector('[role="dialog"]')!.remove();
  });

  expect(await navigation).toBe('created');
  await expect(page.locator('#root #editor-created')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
