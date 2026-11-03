import { expect, test } from '@playwright/test';

test.use({ viewport: null });

for (const role of ['owner', 'member']) {
  test(`Free Custom4 upgrade from fullscreen preserves the ${role}'s work`, async ({ page }) => {
    const errors: string[] = [];
    const apiCalls: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    // Any accidental business request fails the test rather than reaching a real service.
    await page.route('**/api/**', (route) => {
      apiCalls.push(route.request().url());
      return route.abort();
    });
    await page.route('**/presentation-paywall-fixture*', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<html><body id="body"><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import('/playwright/support/presentation-paywall.fixture.tsx');
      </script></body></html>`,
    }));
    await page.goto(`/presentation-paywall-fixture?role=${role}&keep=1`);
    await page.getByLabel('Instructions', { exact: true }).fill('Unsaved outline and settings');
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await page.getByRole('button', { name: 'Custom', exact: true }).click();
    await expect(page.getByText(/including counts below 12/)).toBeVisible();
    await expect(page.getByRole('menuitemradio')).toHaveCount(0);
    await page.getByRole('button', { name: 'Upgrade to Pro', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue('Unsaved outline and settings');
    await expect(page.locator('button[aria-label="Custom"]')).toHaveText('Custom · 4');
    expect(new URL(page.url()).pathname).toBe('/presentation-paywall-fixture');
    expect(new URL(page.url()).searchParams.get('keep')).toBe('1');
    if (role === 'owner') {
      await expect(page.getByTestId('plan-comparison')).toBeVisible();
      expect(new URL(page.url()).searchParams.get('action')).toBe('change_plan');
      await expect(page.getByText('AI presentation slides', { exact: true })).toBeVisible();
      await expect(page.getByTestId('pricing-plan-free')).toContainText('12 lifetime slides');
      await expect(page.getByTestId('pricing-plan-free')).toContainText('Up to 5 MiB');
      await expect(page.getByTestId('pricing-plan-pro')).toContainText('Uses shared AI responses');
      // Do not click Checkout: this is a real DOM regression over fixture billing data.
    } else {
      await expect(page.getByText('Ask your workspace owner to upgrade to Pro.')).toBeVisible();
      await expect(page.getByTestId('plan-comparison')).toHaveCount(0);
      expect(new URL(page.url()).searchParams.has('action')).toBe(false);
    }
    expect(apiCalls).toEqual([]);
    expect(errors).toEqual([]);
  });
}
