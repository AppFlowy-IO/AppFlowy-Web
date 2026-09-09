import { test, expect, devices, type Page } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { mockServerInfo } from '../../support/server-info-helpers';
import { generateRandomEmail } from '../../support/test-config';

async function refreshServerInfo(page: Page) {
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/server-info');

  await page.clock.fastForward(5 * 60_000 + 1);
  await response;
}

test('compatibility warnings allow editing and follow server changes and tab-session dismissal', async ({ page, request, browser }, testInfo) => {
  test.setTimeout(180_000);
  await page.clock.install();
  const server = await mockServerInfo(page, { version: '0.18.0', min_web_client_version: '0.0.0' });
  let legacyWebProjection = true;

  await page.route('**/api/server-info', async (route) => {
    if (!legacyWebProjection || route.request().headers()['x-platform'] !== 'web') {
      await route.fallback();
      return;
    }

    const { version: _version, min_web_client_version: _floor, ...webInfo } = server.getServerInfo();

    await route.fulfill({ json: { code: 0, data: webInfo, message: 'success' } });
  });
  const banner = page.getByTestId('client-compatibility-banner');
  const reload = page.getByRole('button', { name: 'Reload web app' });
  const dismiss = page.getByRole('button', { name: 'Dismiss compatibility warning' });

  await signInAndWaitForApp(page, request, generateRandomEmail());
  await expect(banner).toContainText('AppFlowy Web 0.17.1 requires server 0.18.1');
  await expect(reload).toHaveCount(0);

  await createDocumentPageAndNavigate(page);
  const editor = page.locator('[data-slate-editor="true"]').first();

  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('Editing remains available during a compatibility warning.');
  await expect(editor).toContainText('Editing remains available');
  await expect(banner).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('compatibility-desktop.png') });

  await dismiss.click();
  await expect(banner).toHaveCount(0);
  await createDocumentPageAndNavigate(page);
  await expect(banner).toHaveCount(0);
  await refreshServerInfo(page);
  await expect(banner).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(banner).toBeVisible();
  // MobileMainLayout is selected by user agent, not desktop viewport width.
  const mobileContext = await browser.newContext({
    ...devices['iPhone 13'],
    storageState: await page.context().storageState(),
  });

  try {
    const mobilePage = await mobileContext.newPage();

    await mockServerInfo(mobilePage, { version: '0.18.0' });
    await mobilePage.goto(page.url(), { waitUntil: 'domcontentloaded' });
    await expect(mobilePage.locator('.appflowy-mobile-layout')).toBeVisible();
    const mobileBanner = mobilePage.getByTestId('client-compatibility-banner');

    await expect(mobileBanner).toContainText('AppFlowy Web 0.17.1 requires server 0.18.1');
    const bounds = await mobileBanner.boundingBox();

    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
    await mobilePage.screenshot({ path: testInfo.outputPath('compatibility-mobile.png') });
    await mobilePage.getByRole('button', { name: 'Dismiss compatibility warning' }).click();
    await expect(mobileBanner).toHaveCount(0);
  } finally {
    await mobileContext.close();
  }

  server.setServerInfo({ version: '0.18.1' });
  legacyWebProjection = false;
  await refreshServerInfo(page);
  await expect(banner).toHaveCount(0);

  server.setServerInfo({ min_web_client_version: '0.17.2' });
  await refreshServerInfo(page);
  await expect(banner).toContainText('requires AppFlowy Web 0.17.2');
  await expect(reload).toBeVisible();
  await dismiss.click();
  server.setServerInfo({ min_web_client_version: '0.17.3' });
  await refreshServerInfo(page);
  await expect(banner).toContainText('requires AppFlowy Web 0.17.3');

  server.setServerInfo({ version: '0.17.0' });
  await refreshServerInfo(page);
  await expect(banner).toContainText('update both');
  await expect(reload).toHaveCount(0);

  server.setServerInfo({ version: 'manual-build', min_web_client_version: '' });
  await refreshServerInfo(page);
  await expect(banner).toHaveCount(0);

  server.setServerInfo({ version: '0.18.1', min_web_client_version: '0.17.2' });
  await refreshServerInfo(page);
  await expect(reload).toBeVisible();
  // The updated deployment is ready; the action loads it into this tab.
  server.setServerInfo({ min_web_client_version: '' });
  const navigation = page.waitForEvent('domcontentloaded');

  await reload.click();
  await navigation;
  await expect(page.locator('[data-slate-editor="true"]').first()).toBeVisible();
  await expect(banner).toHaveCount(0);
});
