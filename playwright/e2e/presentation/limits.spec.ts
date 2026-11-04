import { expect, test } from '@playwright/test';

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
      await page.goto(`/presentation-limits-fixture?theme=${theme}&remaining=4`);
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

for (const role of ['owner', 'member']) {
  test(`zero allowance uses the existing ${role} workspace-upgrade flow`, async ({ page }) => {
    await page.goto(`/presentation-limits-fixture?remaining=0&role=${role}`);
    await expect(page.getByText('Slide limit reached')).toBeVisible();
    await page.getByRole('textbox', { name: 'Additional instructions', exact: true }).fill('Keep my draft when upgrading');
    await page.getByRole('button', { name: 'Upgrade workspace' }).click();
    if (role === 'owner') await expect(page.getByTestId('plan-comparison')).toBeVisible();
    else await expect(page.getByText('Ask your workspace owner to upgrade to Pro.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Additional instructions', exact: true, includeHidden: true })).toHaveValue('Keep my draft when upgrading');
  });
}

test('a matching saved result opens with zero slides and no upgrade prompt', async ({ page }) => {
  await page.goto('/presentation-limits-fixture?remaining=0&cached=true');
  await expect(page.getByRole('button', { name: 'Upgrade workspace' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open presentation' }).click();
  await expect(page.getByText('Saved presentation opened')).toBeVisible();
});
