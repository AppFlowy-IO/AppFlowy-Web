import { test as base, Page, APIRequestContext } from '@playwright/test';
import { signInTestUser, AuthTestUtils } from './auth-utils';
import { generateRandomEmail } from './test-config';

/**
 * Custom Playwright fixtures for AppFlowy E2E tests
 * Migrated from: cypress/support/e2e.ts + cypress/support/commands.ts
 *
 * Usage in tests:
 * ```typescript
 * import { test, expect } from '../support/fixtures';
 *
 * test('my test', async ({ signedInPage }) => {
 *   // Already signed in and on /app
 * });
 * ```
 */

type AppFlowyFixtures = {
  /**
   * A page that is already signed in with a random test user
   */
  signedInPage: Page;

  /**
   * Auth utilities for manual sign-in control
   */
  authUtils: AuthTestUtils;

  /**
   * Clear all IndexedDB databases (for clean state)
   */
  clearAllIndexedDB: () => Promise<void>;
};

export const test = base.extend<AppFlowyFixtures>({
  // Provide a signed-in page fixture
  signedInPage: async ({ page, request }, use) => {
    const email = generateRandomEmail();

    // Visit login page first (needed to set localStorage)
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Sign in
    await signInTestUser(page, request, email);

    // Use the signed-in page
    await use(page);
  },

  // Provide auth utilities
  authUtils: async ({}, use) => {
    await use(new AuthTestUtils());
  },

  // Provide IndexedDB clearing utility
  clearAllIndexedDB: async ({ page }, use) => {
    const clearFn = async () => {
      await page.evaluate(async () => {
        try {
          const databases = await indexedDB.databases();
          const deletePromises = databases.map((db) => {
            return new Promise<void>((resolve) => {
              if (db.name) {
                const request = indexedDB.deleteDatabase(db.name);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
              } else {
                resolve();
              }
            });
          });
          await Promise.all(deletePromises);
          console.log(`Cleared ${databases.length} IndexedDB databases`);
        } catch (e) {
          console.log('Failed to clear IndexedDB databases');
        }
      });
    };

    await use(clearFn);
  },
});

/**
 * Global beforeEach equivalent: mock billing endpoints
 * Apply this in test files that need billing mocks:
 *
 * ```typescript
 * test.beforeEach(async ({ page }) => {
 *   await mockBillingEndpoints(page);
 * });
 * ```
 */
export async function mockBillingEndpoints(page: Page): Promise<void> {
  await page.route('**/billing/api/v1/subscriptions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: [],
        message: 'success',
      }),
    })
  );

  await page.route('**/billing/api/v1/active-subscription/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: [],
        message: 'success',
      }),
    })
  );
}

/**
 * Setup page error handling (equivalent to Cypress uncaught:exception handler)
 * Apply in test files:
 *
 * ```typescript
 * test.beforeEach(async ({ page }) => {
 *   setupPageErrorHandling(page);
 * });
 * ```
 */
export function setupPageErrorHandling(page: Page): void {
  page.on('pageerror', (error) => {
    // Ignore known transient app bootstrap errors
    const ignoredPatterns = [
      'No workspace or service found',
      'Failed to fetch dynamically imported module',
      'Record not found',
      'unknown error',
      'Reduce of empty array with no initial value',
    ];

    const shouldIgnore = ignoredPatterns.some((pattern) =>
      error.message.toLowerCase().includes(pattern.toLowerCase())
    );

    if (!shouldIgnore) {
      console.error('Page error:', error.message);
    }
  });
}

export { expect } from '@playwright/test';
