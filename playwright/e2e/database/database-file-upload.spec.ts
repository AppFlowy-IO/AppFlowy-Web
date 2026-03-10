/**
 * Database File Upload Tests
 *
 * Tests for file upload in database file/media field.
 * Migrated from: cypress/e2e/database/database-file-upload.cy.ts
 */
import { test, expect } from '@playwright/test';
import { FieldType } from '../../support/selectors';
import {
  generateRandomEmail,
  setupFieldTypeTest,
  loginAndCreateGrid,
  addNewProperty,
  getLastFieldId,
  getCellsForField,
} from '../../support/field-type-test-helpers';

test.describe('Database File Upload', () => {
  test('should upload file to database file/media field and track progress', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    // Step 1: Add a File & Media field
    await addNewProperty(page, FieldType.FileMedia);
    await page.waitForTimeout(1000);

    // Verify the field was added (at least 2 column headers)
    const headerCount = await page.locator('[data-testid^="grid-field-header-"]').count();
    expect(headerCount).toBeGreaterThanOrEqual(2);

    // Step 2: Click on a cell in the file/media column to open upload dialog
    const fieldId = await getLastFieldId(page);
    await getCellsForField(page, fieldId).first().click({ force: true });
    await page.waitForTimeout(2000);

    // The popover should open with the file dropzone
    await expect(page.getByTestId('file-dropzone')).toBeVisible({ timeout: 15000 });

    // Step 3: Upload multiple files using synthetic PNG buffers
    const fileInput = page.getByTestId('file-dropzone').locator('input[type="file"]');

    // Create minimal valid PNG buffers
    const buffer1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const buffer2 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64'
    );

    await fileInput.setInputFiles([
      { name: 'appflowy.png', mimeType: 'image/png', buffer: buffer1 },
      { name: 'test-icon.png', mimeType: 'image/png', buffer: buffer2 },
    ]);

    await page.waitForTimeout(8000);

    // Step 4: Verify the files were uploaded (image thumbnails)
    const cell = getCellsForField(page, fieldId).first();
    await expect(cell.locator('img')).toHaveCount(2, { timeout: 10000 });
  });
});
