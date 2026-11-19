import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';

async function openFixture(page: Page, query: string) {
  await page.goto(`/presentation-limits-fixture?${query}`);
  // A cold dev server must finish loading the fixture before checking its actions.
  await page.getByRole('region', { name: 'Create presentation settings' }).waitFor({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', () => { throw new Error('Presentation limit UI must not call business APIs.'); });
  await page.route('**/presentation-limits-fixture*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<html><body id="body"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/playwright/support/presentation-limits.fixture.tsx');
    </script></body></html>`,
  }));
});

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1280]) {
    test(`${theme} ${width}px: a count above the allowance offers Upgrade, then Generate after choosing fewer slides`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];

      page.on('pageerror', (error) => errors.push(error.message));
      await openFixture(page, `theme=${theme}&remaining=4`);
      await expect(page.getByRole('button', { name: 'Upgrade workspace' })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Find saved presentation' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(0);
      await page.getByTestId('presentation-upgrade-prompt').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('presentation-upgrade-prompt')).toContainText('4 slides remaining');
      await page.screenshot({ path: testInfo.outputPath('slide-limit.png') });
      const action = await page.getByRole('button', { name: 'Upgrade workspace' }).boundingBox();

      expect(action).not.toBeNull();
      expect(action!.x).toBeGreaterThanOrEqual(0);
      expect(action!.x + action!.width).toBeLessThanOrEqual(width);
      await page.getByRole('button', { name: '4', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Generate presentation' })).toBeEnabled();
      await expect(page.getByTestId('presentation-upgrade-prompt')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}

const SOURCE_TOO_LARGE = 'The source is too large for the AI model. Select fewer pages, a smaller view or shorter media.';

for (const theme of ['light', 'dark']) {
  for (const { width, message, actionOnFirstLine } of [
    // Short enough for Retry analysis to share the first line, which the button makes taller.
    { width: 1280, message: 'The source is too large for the AI model.', actionOnFirstLine: true },
    // Wraps over several lines: the icon stays on the first.
    { width: 390, message: SOURCE_TOO_LARGE, actionOnFirstLine: false },
  ]) {
    test(`${theme} ${width}px: a notice's icon is centred on its first line${actionOnFirstLine ? ', beside its action' : ''}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await openFixture(page, `theme=${theme}&remaining=4&analysisError=${encodeURIComponent(message)}`);
      await page.getByRole('button', { name: '4', exact: true }).click();
      await page.getByRole('button', { name: 'Generate presentation' }).click();
      const notice = page.locator('.ps-notice').filter({ hasText: message });

      await expect(notice.getByRole('button', { name: 'Retry analysis' })).toBeVisible();
      await notice.scrollIntoViewIfNeeded();
      await notice.screenshot({ path: testInfo.outputPath('notice.png') });
      const geometry = await notice.evaluate((element) => {
        const centre = (rect: DOMRect) => rect.top + rect.height / 2;
        const icon = element.querySelector('svg')!.getBoundingClientRect();
        const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => (node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
        }).nextNode()!;
        const range = document.createRange();

        range.selectNodeContents(text);
        const firstLine = range.getClientRects()[0];
        const action = element.querySelector('button')!.getBoundingClientRect();

        return {
          offset: centre(icon) - centre(firstLine),
          actionOnFirstLine: action.top < firstLine.bottom && action.bottom > firstLine.top,
        };
      });

      if (actionOnFirstLine) expect(geometry.actionOnFirstLine).toBe(true);
      expect(Math.abs(geometry.offset), 'icon centre against the first text line').toBeLessThanOrEqual(1);
    });
  }
}

for (const role of ['owner', 'member']) {
  test(`zero allowance uses the existing ${role} workspace-upgrade flow`, async ({ page }) => {
    await openFixture(page, `remaining=0&role=${role}`);
    await expect(page.getByText('Slide limit reached')).toBeVisible();
    await page.getByRole('textbox', { name: 'Additional instructions', exact: true }).fill('Keep my draft when upgrading');
    await page.getByRole('button', { name: 'Upgrade workspace' }).click();
    if (role === 'owner') await expect(page.getByTestId('plan-comparison')).toBeVisible();
    else await expect(page.getByText('Ask your workspace owner to upgrade to Pro.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Additional instructions', exact: true, includeHidden: true })).toHaveValue('Keep my draft when upgrading');
  });
}

test('a matching saved result opens with zero slides and no upgrade prompt', async ({ page }) => {
  await openFixture(page, 'remaining=0&cached=true');
  await expect(page.getByRole('button', { name: 'Upgrade workspace' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open presentation' }).click();
  await expect(page.getByText('Saved presentation opened')).toBeVisible();
});
