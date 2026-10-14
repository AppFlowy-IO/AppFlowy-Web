import { test, expect } from '@playwright/test';

import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { waitForDocumentTextOnServer } from '../../support/duplicate-test-helpers';
import {
  getVisibleDataRowIds,
  openRowDetailByRowId,
} from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';

// The first failed attempt needs its network/navigation evidence, even if the retry passes.
test.use({ trace: 'retain-on-failure' });

test.describe('Duplicate row preserves document content', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Duplicated row has the same document content as the source', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const rowDocText = `test-content-${Date.now()}`;

    await page.addInitScript(() => {
      (window as Window & { Cypress?: boolean }).Cypress = true;
    });

    // Sign up and create a grid
    await signUpAndLoginWithPasswordViaUi(page, request, testEmail);
    await createDatabaseView(page, 'Grid', 6000);
    await waitForGridReady(page);

    const sourceRowIds = await getVisibleDataRowIds(page);
    const sourceRowId = sourceRowIds[0];

    expect(sourceRowId).toBeTruthy();
    await openRowDetailByRowId(page, sourceRowId);
    await RowDetailSelectors.openFullPageButton(page).click();
    await expect(page).toHaveURL((url) => url.searchParams.get('r') === sourceRowId);
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0);

    const editor = page.locator('.row-page-content [data-testid="editor-content"]');

    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type(rowDocText, { delay: 30 });
    await expect(editor).toContainText(rowDocText);
    const sourceEditorId = await editor.getAttribute('id');

    expect(sourceEditorId).toMatch(/^editor-.+/);
    // A local render does not prove the server can read the source body. Observe
    // its decoded document instead of assuming an eight-second sleep saved it.
    await waitForDocumentTextOnServer(page, TestConfig.apiUrl, sourceEditorId!.slice('editor-'.length), rowDocText);

    // Navigate back to the grid
    await page.goBack();
    await waitForGridReady(page);

    // Duplicate the row from row detail
    const rowIdsBeforeDuplicate = await getVisibleDataRowIds(page);

    await openRowDetailByRowId(page, sourceRowId);
    // Normal clicks wait for the peek's entrance transition and menu readiness.
    await RowDetailSelectors.moreActionsButton(page).click();
    await RowDetailSelectors.duplicateMenuItem(page).click();
    // The completed duplicate action closes its source row peek.
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0, { timeout: 10000 });

    // Verify 4 rows (3 default + 1 duplicate).
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(rowIdsBeforeDuplicate.length + 1);

    const rowIdsAfterDuplicate = await getVisibleDataRowIds(page);
    const duplicatedRowId = rowIdsAfterDuplicate.find((rowId) => !rowIdsBeforeDuplicate.includes(rowId));

    expect(duplicatedRowId).toBeTruthy();

    await openRowDetailByRowId(page, duplicatedRowId!);
    await RowDetailSelectors.openFullPageButton(page).click();
    await expect(page).toHaveURL((url) => url.searchParams.get('r') === duplicatedRowId);
    await expect(RowDetailSelectors.modal(page)).toHaveCount(0);

    // Observe the selected row's actual editor. Repeated reloads interrupt its
    // loading and can erase the navigation state that explains a failure.
    await expect(editor).toContainText(rowDocText, { timeout: 30_000 });
    const duplicatedEditorId = await editor.getAttribute('id');

    expect(duplicatedEditorId).toMatch(/^editor-.+/);
    expect(duplicatedEditorId).not.toBe(sourceEditorId);
    await waitForDocumentTextOnServer(page, TestConfig.apiUrl, duplicatedEditorId!.slice('editor-'.length), rowDocText);

    // One deliberate reload proves persistence without retrying the action.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL((url) => url.searchParams.get('r') === duplicatedRowId);
    await expect(editor).toHaveAttribute('id', duplicatedEditorId!);
    await expect(editor).toContainText(rowDocText, { timeout: 30_000 });
  });
});
