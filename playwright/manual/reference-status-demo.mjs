// Run with REF_PAGES_TEST_PASSWORD set: node playwright/manual/reference-status-demo.mjs
// This browser-only demo never edits workspace content or permissions.
import { chromium, expect } from '@playwright/test';

import { installPageReferenceNetworkFault } from '../support/page-reference-network-fault.ts';

const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const password = process.env.REF_PAGES_TEST_PASSWORD;

if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('The reference-state demo requires localhost');
}
if (!password) throw new Error('Set REF_PAGES_TEST_PASSWORD to the local test-account password');

const workspaceId = '997c87ed-1667-4a62-8c0a-a74ee1aadb4b';
const targetId = '534e2829-2c89-4360-a61c-aac3e6f9d93b';
const sharedPath = `/app/${workspaceId}/ca6b24a4-3e7b-4310-984c-e8e0bc412868`;
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ baseURL, locale: 'en-US', viewport: { width: 1440, height: 1000 } });

try {
  // Observe the real Retry click to release the network fault. Reloading resets
  // only this test harness flag, making the demonstration repeatable.
  await context.addInitScript((target) => {
    window.__referenceDemoRecovered = false;
    document.addEventListener('click', (event) => {
      const element = event.target instanceof Element ? event.target : null;
      const button = element?.closest('button');

      if (button?.textContent?.trim() === 'Retry' &&
        button.closest(`[data-mention-id="${target}"], [data-reference-page-id="${target}"]`)) {
        window.__referenceDemoRecovered = true;
      }
    }, true);
  }, targetId);
  const page = await context.newPage();

  await installPageReferenceNetworkFault(page, workspaceId, targetId,
    () => page.evaluate(() => !window.__referenceDemoRecovered));
  await page.goto(`/login?redirectTo=${encodeURIComponent(sharedPath)}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-email-input').fill('nathan@appflowy.io');
  await page.getByTestId('login-password-button').click();
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('password-submit-button').click();
  await expect(page.getByTestId('page-title-input')).toHaveText('Reference states - Nathan and Annie', { timeout: 30000 });
  const reference = page.getByTestId('editor-content').locator(`[data-mention-id="${targetId}"]`);

  await expect(reference.getByRole('button', { name: 'Couldn’t load page', exact: true })).toBeVisible({ timeout: 30000 });
  await reference.getByRole('button', { name: 'Couldn’t load page', exact: true }).hover();
  const popup = page.getByRole('dialog', { name: 'Couldn’t load page', exact: true });

  await expect(popup).toContainText('Check your connection and try again.');
  await popup.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(reference).toHaveText('Restricted ref target', { timeout: 30000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(reference.getByRole('button', { name: 'Couldn’t load page', exact: true })).toBeVisible({ timeout: 30000 });
  await reference.getByRole('button', { name: 'Couldn’t load page', exact: true }).hover();
  await expect(popup.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await page.bringToFront();
  console.log('Reference demo ready. Retry restores the real page title; reload reproduces the temporary request failure.');
  await page.waitForEvent('close', { timeout: 0 });
} finally {
  await browser.close();
}
