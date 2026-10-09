import { expect, type Locator } from '@playwright/test';

/**
 * Opening a creation menu refreshes hosted workspace quotas in the background
 * while showing any previously confirmed values. Without a cached value, Form,
 * Chart and Timeline items wait for the server. A Pro crown opens plan selection
 * instead of creating a view. Wait until the item can create before clicking it.
 * Call this before a forced click, which skips Playwright's own enabled check.
 */
export async function expectViewCreationAvailable(item: Locator): Promise<void> {
  await expect(item, 'View creation should become available after the menu refreshes workspace quotas').toBeEnabled({
    timeout: 45_000,
  });
  await expect(item.getByLabel('Pro')).toHaveCount(0);
}
