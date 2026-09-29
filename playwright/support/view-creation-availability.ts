import { expect, type Locator } from '@playwright/test';

/**
 * Opening a creation menu refreshes hosted workspace quotas. Until the server
 * confirms them, Form, Chart and Timeline items stay disabled, and an item with
 * a Pro crown opens checkout instead of creating a view. Wait until the item can
 * create before clicking it, like Desktop's integration helper. Call this before
 * a forced click, which skips Playwright's own enabled check.
 */
export async function expectViewCreationAvailable(item: Locator): Promise<void> {
  await expect(item, 'View creation should become available after the menu refreshes workspace quotas').toBeEnabled({
    timeout: 45_000,
  });
  await expect(item.getByLabel('Pro')).toHaveCount(0);
}
