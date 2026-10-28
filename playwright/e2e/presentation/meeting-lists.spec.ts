import { expect, test, type Page } from '@playwright/test';

async function openFixture(page: Page, query = '') {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.route('**/presentation-meeting-fixture*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body id="body"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/presentation-meeting.fixture.tsx');
    </script></body></html>`,
    })
  );
  await page.goto(`/presentation-meeting-fixture${query}`);
  await page.getByRole('button', { name: 'Present document', exact: true }).click();
  return page.getByRole('main', { name: /^Slide/ });
}

test('presents only the meeting summary, including the outline and fullscreen, in both themes', async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(request.url());
  });
  const main = await openFixture(page);
  await page.getByRole('button', { name: 'Next slide' }).click();
  await main.getByRole('button', { name: 'Meeting decisions', exact: true }).click();
  const meeting = main.locator('.ai-meeting-block');
  await expect(meeting).toHaveAttribute('data-ai-meeting-active', 'summary');
  await expect(meeting).toContainText('Weekly product sync');
  await expect(meeting.locator('.ai-meeting-tabs')).toHaveText('Summary');
  await expect(page.locator('.ps-presenter')).not.toContainText('TRANSCRIPT');
  await expect(page.locator('.ps-presenter')).not.toContainText('PRIVATE NOTES');
  await expect(page.locator('.ps-presenter .ps-doc-fallback')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/presentation/meeting-summary-light.png', animations: 'disabled' });
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', 'true');
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(meeting.locator('.ai-meeting-tabs')).toHaveText('Summary');
  await page.screenshot({ path: 'test-results/presentation/meeting-summary-dark.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Exit presentation' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-unchanged', 'true');
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

for (const standalone of [false, true]) {
  test(`keeps a short numbered list together ${standalone ? 'in the document' : 'inside a meeting summary'}`, async ({
    page,
  }) => {
    const main = await openFixture(page, standalone ? '?standalone' : '');
    const seen: string[][] = [];
    for (let i = 0; i < 20; i++) {
      const list = main.locator('.ps-doc-list');
      if (await list.count()) {
        seen.push(await list.locator('.ps-doc-marker').allTextContents());
        for (const item of await list.all()) await expect(item).toBeInViewport({ ratio: 1 });
      }
      await expect(main).not.toContainText('TRANSCRIPT');
      if (await page.getByRole('button', { name: 'Next slide' }).isDisabled()) break;
      await page.getByRole('button', { name: 'Next slide' }).click();
    }
    expect(seen).toEqual([['1.', '2.', '3.']]);
  });
}

test('splits a long numbered summary between complete items without resetting numbering', async ({ page }) => {
  const main = await openFixture(page, '?long');
  const seen: string[] = [];
  let listSlides = 0;
  for (let i = 0; i < 30; i++) {
    const list = main.locator('.ps-doc-list');
    if (await list.count()) {
      listSlides++;
      seen.push(...(await list.locator('.ps-doc-marker').allTextContents()));
      for (const item of await list.all()) await expect(item).toBeInViewport({ ratio: 1 });
    }
    await expect(main).not.toContainText('TRANSCRIPT');
    if (await page.getByRole('button', { name: 'Next slide' }).isDisabled()) break;
    await page.getByRole('button', { name: 'Next slide' }).click();
  }
  expect(listSlides).toBeGreaterThan(1);
  expect(seen).toEqual(Array.from({ length: 14 }, (_, index) => `${index + 1}.`));
});

test('does not fall back to transcript or notes when the summary is empty', async ({ page }) => {
  const main = await openFixture(page, '?empty');
  for (let i = 0; i < 5 && !(await main.locator('.ai-meeting-block').count()); i++)
    await page.getByRole('button', { name: 'Next slide' }).click();
  await expect(main).toContainText('No summary available.');
  await expect(page.locator('.ps-presenter')).not.toContainText('TRANSCRIPT');
  await expect(page.locator('.ps-presenter')).not.toContainText('PRIVATE NOTES');
});
