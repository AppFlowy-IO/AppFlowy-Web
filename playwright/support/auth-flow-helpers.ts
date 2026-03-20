import { Page, expect } from '@playwright/test';
import { AuthSelectors, SpaceSelectors, SidebarSelectors, PageSelectors } from './selectors';
import { signInTestUser } from './auth-utils';
import type { APIRequestContext } from '@playwright/test';

/**
 * Authentication flow helpers for Playwright E2E tests
 * Migrated from: cypress/support/auth-flow-helpers.ts
 */

interface VisitAuthPathOptions {
  waitMs?: number;
}

interface GoToPasswordStepOptions {
  waitMs?: number;
  assertEmailInUrl?: boolean;
}

/**
 * Visit an auth route and wait for the UI to stabilize.
 */
export async function visitAuthPath(
  page: Page,
  path: string,
  options?: VisitAuthPathOptions
): Promise<void> {
  const waitMs = options?.waitMs ?? 2000;
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }
}

/**
 * Visit the default login page.
 */
export async function visitLoginPage(page: Page, waitMs: number = 2000): Promise<void> {
  await visitAuthPath(page, '/login', { waitMs });
}

/**
 * Assert core login page elements are visible.
 */
export async function assertLoginPageReady(page: Page): Promise<void> {
  await expect(page.getByText('Welcome to AppFlowy')).toBeVisible();
  await expect(AuthSelectors.emailInput(page)).toBeVisible();
  await expect(AuthSelectors.passwordSignInButton(page)).toBeVisible();
}

/**
 * From login page, enter email and navigate to password step.
 */
export async function goToPasswordStep(
  page: Page,
  email: string,
  options?: GoToPasswordStepOptions
): Promise<void> {
  const waitMs = options?.waitMs ?? 1000;
  const assertEmailInUrl = options?.assertEmailInUrl ?? false;

  await expect(AuthSelectors.emailInput(page)).toBeVisible();
  await AuthSelectors.emailInput(page).fill(email);
  await expect(AuthSelectors.passwordSignInButton(page)).toBeVisible();
  await AuthSelectors.passwordSignInButton(page).click();
  await page.waitForTimeout(waitMs);
  await expect(page).toHaveURL(/action=enterPassword/);
  if (assertEmailInUrl) {
    await expect(page).toHaveURL(new RegExp(`email=${encodeURIComponent(email)}`));
  }
}

/**
 * Sign in with shared auth utils and wait until app page is loaded.
 * Also expands the first space so page names are visible in the sidebar.
 */
export async function signInAndWaitForApp(
  page: Page,
  request: APIRequestContext,
  email: string,
  waitMs: number = 3000
): Promise<void> {
  // Enable test-mode behaviors in the app (e.g. always-visible inline-add-page buttons)
  // The app checks 'Cypress' in window to toggle test-specific UI
  await page.addInitScript(() => {
    (window as any).Cypress = true;
  });

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await signInTestUser(page, request, email);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await page.waitForTimeout(waitMs);

  // Wait for sidebar to be ready
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

  // Expand first space if collapsed so page names become visible
  const firstSpace = SpaceSelectors.items(page).first();
  if (await firstSpace.count() > 0) {
    const expanded = firstSpace.locator('[data-testid="space-expanded"]');
    const isExpanded = await expanded.getAttribute('data-expanded').catch(() => null);
    if (isExpanded !== 'true') {
      await firstSpace.getByTestId('space-name').first().click({ force: true });
      await page.waitForTimeout(1000);
    }
  }
}
