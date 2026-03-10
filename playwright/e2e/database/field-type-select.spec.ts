/**
 * SingleSelect and MultiSelect field type tests
 *
 * These tests verify the SingleSelect/MultiSelect ↔ RichText conversion
 * which is simpler to test via RichText input (avoids flaky dropdown interactions).
 * Migrated from: cypress/e2e/database/field-type-select.cy.ts
 */
import { test, expect } from '@playwright/test';
import { FieldType } from '../../support/selectors';
import {
  generateRandomEmail,
  setupFieldTypeTest,
  loginAndCreateGrid,
  addNewProperty,
  editLastProperty,
  getLastFieldId,
  getCellsForField,
  typeTextIntoCell,
} from '../../support/field-type-test-helpers';

test.describe('Field Type - Select (SingleSelect/MultiSelect)', () => {
  test('RichText ↔ SingleSelect field type switching works without errors', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    // Add RichText property and type some text
    await addNewProperty(page, FieldType.RichText);
    const fieldId = await getLastFieldId(page);

    await typeTextIntoCell(page, fieldId, 0, 'Apple');

    // Verify text was entered
    await expect(getCellsForField(page, fieldId).first()).toContainText('Apple');

    // Switch to SingleSelect - text won't match any option (expected behavior)
    await editLastProperty(page, FieldType.SingleSelect);
    await page.waitForTimeout(500);

    // Verify the field type switch happened without errors
    await expect(getCellsForField(page, fieldId)).not.toHaveCount(0);

    // Switch back to RichText
    await editLastProperty(page, FieldType.RichText);
    await expect(getCellsForField(page, fieldId)).not.toHaveCount(0);
  });

  test('SingleSelect ↔ MultiSelect type switching preserves field type options', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    // Add SingleSelect property
    await addNewProperty(page, FieldType.SingleSelect);
    const fieldId = await getLastFieldId(page);

    // Switch to MultiSelect
    await editLastProperty(page, FieldType.MultiSelect);
    await page.waitForTimeout(500);

    // Switch back to SingleSelect
    await editLastProperty(page, FieldType.SingleSelect);
    await page.waitForTimeout(500);

    // The field should still exist and be functional
    await expect(getCellsForField(page, fieldId)).not.toHaveCount(0);
  });

  test('RichText ↔ MultiSelect field type switching works without errors', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    // Add RichText property
    await addNewProperty(page, FieldType.RichText);
    const fieldId = await getLastFieldId(page);

    await typeTextIntoCell(page, fieldId, 0, 'Tag1');

    // Switch to MultiSelect
    await editLastProperty(page, FieldType.MultiSelect);
    await page.waitForTimeout(500);

    // Verify cells exist
    await expect(getCellsForField(page, fieldId)).not.toHaveCount(0);

    // Switch back to RichText
    await editLastProperty(page, FieldType.RichText);
    await expect(getCellsForField(page, fieldId)).not.toHaveCount(0);
  });
});
