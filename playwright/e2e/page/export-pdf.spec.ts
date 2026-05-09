import { Page, expect, test } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { mockBillingEndpoints, setupPageErrorHandling } from '../../support/fixtures';
import {
  ExportSelectors,
  PageSelectors,
  ShareSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Export to PDF — BDD scenarios for the Share popover's "Export as" tab.
 *
 * The endpoint under test is POST /api/export/view/{ws}/{view}/pdf, which
 * returns a binary PDF/ZIP. The web client renders a small panel with:
 *   - "Export to PDF" button (always visible)
 *   - "Include linked pages" switch (Pro-gated; clicking on Free opens upgrade)
 *
 * Self-host (`isAppFlowyHosted()=false`) auto-enables Pro features. To force
 * "free cloud user" behavior in tests, we keep the default hosted detection and
 * mock the subscriptions endpoint to return an empty plan list.
 */
async function openSharePopover(page: Page): Promise<void> {
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
  // evaluate(click) avoids the sticky header overlay intercepting pointer events
  await ShareSelectors.shareButton(page).evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(1000);
}

async function switchToExportAsTab(page: Page): Promise<void> {
  const popover = ShareSelectors.sharePopover(page);

  await expect(popover.getByText('Export as', { exact: true })).toBeVisible();
  await popover.getByText('Export as', { exact: true }).click({ force: true });
  await page.waitForTimeout(500);
  await expect(ExportSelectors.panel(page)).toBeVisible();
}

test.describe('Feature: Export to PDF', () => {
  let testEmail: string;

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    testEmail = generateRandomEmail();
  });

  test('Scenario: Open share popover and switch to Export as tab', async ({ page, request }) => {
    await test.step('Given a signed-in user with the default workspace loaded', async () => {
      await signInAndWaitForApp(page, request, testEmail);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
    });

    await test.step('When the user opens the Share popover', async () => {
      await openSharePopover(page);
    });

    await test.step('Then the Share, Publish, and Export as tabs are visible', async () => {
      const popover = ShareSelectors.sharePopover(page);

      await expect(popover.getByText('Share', { exact: true })).toBeVisible();
      await expect(popover.getByText('Publish', { exact: true })).toBeVisible();
      await expect(popover.getByText('Export as', { exact: true })).toBeVisible();
    });

    await test.step('When switching to Export as', async () => {
      await switchToExportAsTab(page);
    });

    await test.step('Then the Export to PDF button and Include-linked-pages switch are present', async () => {
      await expect(ExportSelectors.pdfButton(page)).toBeVisible();
      await expect(ExportSelectors.pdfButton(page)).toBeEnabled();
      await expect(ExportSelectors.includeLinkedPagesSwitch(page)).toBeVisible();
    });
  });

  test('Scenario: Clicking Export to PDF triggers a download', async ({ page, request }) => {
    let exportRequestUrl: string | null = null;

    await test.step('Given the request to /api/export/view/.../pdf is observable', async () => {
      page.on('request', (req) => {
        if (req.url().includes('/api/export/view/') && req.url().includes('/pdf')) {
          exportRequestUrl = req.url();
        }
      });
    });

    await test.step('And a signed-in user with the default workspace', async () => {
      await signInAndWaitForApp(page, request, testEmail);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(2000);
    });

    await test.step('When the user opens Export as and clicks Export to PDF', async () => {
      await openSharePopover(page);
      await switchToExportAsTab(page);

      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });

      await ExportSelectors.pdfButton(page).click({ force: true });
      const download = await downloadPromise;

      await test.step('Then the browser receives a non-empty PDF download', async () => {
        const filename = download.suggestedFilename();

        expect(filename.length).toBeGreaterThan(0);
        // Server returns application/pdf or application/zip (multi-page)
        expect(filename).toMatch(/\.(pdf|zip)$/i);
      });
    });

    await test.step('And the request hit the view PDF endpoint with default query params', () => {
      expect(exportRequestUrl).not.toBeNull();
      expect(exportRequestUrl!).toContain('include_nested=');
      expect(exportRequestUrl!).toContain('include_database=');
      expect(exportRequestUrl!).toContain('include_images=true');
      expect(exportRequestUrl!).toContain('max_depth=2');
    });
  });

  test('Scenario: Free cloud user clicking Include-linked-pages opens the upgrade flow', async ({
    page,
    request,
  }) => {
    let upgradeLinkRequested = false;

    await test.step('Given billing endpoints report no active subscription (Free)', async () => {
      await mockBillingEndpoints(page);
      // Match the actual URL — `getSubscriptionLink` hits
      // /billing/api/v1/subscription-link?workspace_subscription_plan=...&workspace_id=...
      // (no path segments after `subscription-link`). Use a regex so query string is irrelevant.
      await page.route(/\/billing\/api\/v1\/subscription-link(\?|$)/, (route) => {
        upgradeLinkRequested = true;
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: 'https://example.com/checkout/test-session',
            message: 'success',
          }),
        });
      });
    });

    await test.step('And a signed-in user on the share Export-as tab', async () => {
      await signInAndWaitForApp(page, request, testEmail);
      await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
      await expect(PageSelectors.names(page).first()).toBeVisible({ timeout: 30000 });
      await openSharePopover(page);
      await switchToExportAsTab(page);
    });

    await test.step('When the user clicks the Include-linked-pages switch', async () => {
      // Stub window.open so the test environment doesn't actually open a tab
      await page.evaluate(() => {
        (window as unknown as { __opened: string[] }).__opened = [];
        const original = window.open;

        window.open = (url?: string | URL) => {
          (window as unknown as { __opened: string[] }).__opened.push(String(url ?? ''));
          return null as unknown as Window;
        };
        // Keep a reference so a later GC doesn't break the test cleanup
        (window as unknown as { __originalOpen: typeof original }).__originalOpen = original;
      });

      await ExportSelectors.includeLinkedPagesSwitch(page).click({ force: true });
      await page.waitForTimeout(1500);
    });

    await test.step('Then the subscription-link endpoint is hit and a checkout URL is opened', async () => {
      expect(upgradeLinkRequested).toBe(true);

      const opened = await page.evaluate(() =>
        ((window as unknown as { __opened?: string[] }).__opened ?? []).slice()
      );

      expect(opened.length).toBeGreaterThan(0);
      expect(opened[0]).toContain('checkout');
    });

    await test.step('And the toggle did NOT flip to checked (still Free)', async () => {
      await expect(ExportSelectors.includeLinkedPagesSwitch(page)).toHaveAttribute(
        'data-state',
        'unchecked',
      );
    });
  });
});
