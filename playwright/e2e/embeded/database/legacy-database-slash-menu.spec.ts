/**
 * Legacy Database - Slash Menu Visibility Tests
 *
 * Verifies that legacy databases (created before Database Container feature)
 * appear in the slash menu's "Link to existing database" picker and do not
 * cause duplicate entries in the mention panel.
 *
 * Migrated from: cypress/e2e/embeded/database/legacy-database-slash-menu.cy.ts
 *
 * NOTE: These tests require a pre-existing account (legacy_db_links@appflowy.io)
 * with specific data (legacy databases "Trip" and "To-dos").
 * Skipped because this account requires password-based login and specific
 * pre-provisioned data that may not exist in all environments.
 */
import { test, expect } from '@playwright/test';

test.describe('Legacy Database - Slash Menu Visibility', () => {
  test.skip('should show legacy databases in slash menu linked grid picker', async () => {
    // Requires pre-existing account: legacy_db_links@appflowy.io
    // with legacy databases "Trip" and "To-dos"
    // This test uses password-based login which is not available in standard test flow.
  });

  test.skip('should not show duplicate database child views in mention panel', async () => {
    // Requires pre-existing account: legacy_db_links@appflowy.io
    // with "Document A" containing legacy database references
    // This test uses password-based login which is not available in standard test flow.
  });
});
