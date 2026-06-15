/**
 * Time field type tests
 *
 * Tests for Time field type conversions.
 * Migrated from: cypress/e2e/database/field-type-time.cy.ts
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

test.describe('Field Type - Time', () => {
  test('RichText ↔ Time parses HH:MM / milliseconds and round-trips', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    await addNewProperty(page, FieldType.RichText);
    const fieldId = await getLastFieldId(page);

    await typeTextIntoCell(page, fieldId, 0, '09:30');
    await typeTextIntoCell(page, fieldId, 1, '34200000');

    // Switch to Time
    await editLastProperty(page, FieldType.Time);

    // Expect parsed milliseconds shown (either raw ms or formatted)
    const fieldId2 = await getLastFieldId(page);
    const cells = getCellsForField(page, fieldId2);
    const cellCount = await cells.count();
    const values: string[] = [];
    for (let i = 0; i < cellCount; i++) {
      const text = await cells.nth(i).textContent();
      values.push((text || '').trim());
    }
    expect(values.some((v) => v.includes('34200000') || v.includes('09:30'))).toBe(true);

    // Round-trip back to RichText
    await editLastProperty(page, FieldType.RichText);
    const fieldId3 = await getLastFieldId(page);
    const cells2 = getCellsForField(page, fieldId3);
    const cellCount2 = await cells2.count();
    const values2: string[] = [];
    for (let i = 0; i < cellCount2; i++) {
      const text = await cells2.nth(i).textContent();
      values2.push((text || '').trim());
    }
    expect(values2.some((v) => v.includes('09:30') || v.includes('34200000'))).toBe(true);
  });

  test('Time field can be created directly', async ({ page, request }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    // Add Time property directly
    await addNewProperty(page, FieldType.Time);
    const fieldId = await getLastFieldId(page);

    // Verify cells exist
    await expect(getCellsForField(page, fieldId)).not.toHaveCount(0);

    // Switch to RichText and back
    await editLastProperty(page, FieldType.RichText);
    await editLastProperty(page, FieldType.Time);
    await expect(getCellsForField(page, fieldId)).not.toHaveCount(0);
  });
});
