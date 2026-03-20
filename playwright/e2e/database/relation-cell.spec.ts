/**
 * Relation Cell Integration Tests
 *
 * Tests relation cell popup opening and configuration.
 * Migrated from: cypress/e2e/database/relation-cell.cy.ts
 *
 * NOTE: Several tests are skipped in the original Cypress file due to view sync
 * timing issues. The conditional check based on
 * APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT is preserved.
 */
import { test, expect } from '@playwright/test';
import {
  DatabaseGridSelectors,
  GridFieldSelectors,
  FieldType,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView, waitForGridReady, addPropertyColumn } from '../../support/database-ui-helpers';

const isRelationRollupEditEnabled = process.env.APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT === 'true';

test.describe('Relation Cell Type', () => {
  // Skip entire suite if relation/rollup edit is not enabled (matches Cypress conditional describe)
  test.skip(!isRelationRollupEditEnabled, 'APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT is not enabled');

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1600, height: 900 });
  });

  test('should open relation cell popup when clicking on a relation cell', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    // Given: a signed-in user with a grid database and a Relation column
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', { createWaitMs: 8000 });
    await waitForGridReady(page);
    await addPropertyColumn(page, FieldType.Relation);

    // When: clicking on a relation cell in the new column
    const lastHeader = GridFieldSelectors.allFieldHeaders(page).last();
    const testId = await lastHeader.getAttribute('data-testid');
    const fieldId = testId?.replace('grid-field-header-', '');

    if (fieldId) {
      await DatabaseGridSelectors.dataRowCellsForField(page, fieldId)
        .first()
        .click({ force: true });
      await page.waitForTimeout(1000);

      // Then: the relation popup should open
      await expect(page.locator('[data-radix-popper-content-wrapper]')).toBeVisible({
        timeout: 5000,
      });
    }
  });

  test('should open relation popup from row detail panel', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    // Given: a signed-in user with a grid database and a Relation column
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', { createWaitMs: 8000 });
    await waitForGridReady(page);
    await addPropertyColumn(page, FieldType.Relation);

    // When: hovering over the first row to reveal the expand button
    await DatabaseGridSelectors.dataRows(page).first().hover();
    await page.waitForTimeout(1000);

    // And: clicking the expand button to open the row detail panel
    const expandButton = page
      .locator('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])')
      .first()
      .locator('button.bg-surface-primary');
    await expect(expandButton).toBeVisible({ timeout: 5000 });
    await expandButton.click({ force: true });
    await page.waitForTimeout(2000);

    // And: clicking "Add Relation" in the row detail panel
    const bodyText = await page.locator('body').innerText();
    if (bodyText.includes('Relation')) {
      await page.getByText(/Add Relation/i).click({ force: true });
      await page.waitForTimeout(1000);

      // Then: the relation popup should open
      await expect(page.locator('[data-radix-popper-content-wrapper]')).toBeVisible({
        timeout: 5000,
      });
    }
  });

  // Skipped: flaky due to view sync timing issues when creating multiple grids (matches Cypress)
  test.skip('should link rows from another database', async () => {});

  // Skipped: flaky due to view sync timing issues (regression #7593, matches Cypress)
  test.skip('should open row detail when clicking relation link (regression #7593)', async () => {});

  // Skipped: flaky due to view sync timing issues (regression #6699, matches Cypress)
  test.skip('should update relation cell when related row is renamed (regression #6699)', async () => {});

  // Skipped: web does not auto-update relation field header on database rename (matches Cypress)
  test.skip('should update relation field header when related database is renamed', async () => {});
});
