import { Page } from '@playwright/test';
import { WorkspaceSelectors } from '../selectors';

/**
 * Workspace utility functions for Playwright E2E tests
 * Migrated from: cypress/support/page/workspace.ts
 */

export async function openWorkspaceDropdown(page: Page): Promise<void> {
  await WorkspaceSelectors.dropdownTrigger(page).click();
  await page.waitForTimeout(500);
}

export async function getWorkspaceItems(page: Page) {
  return WorkspaceSelectors.item(page);
}

export async function getWorkspaceMemberCounts(page: Page) {
  return WorkspaceSelectors.memberCount(page);
}
