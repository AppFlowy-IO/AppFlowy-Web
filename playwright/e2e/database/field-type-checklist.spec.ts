/**
 * Checklist field type tests
 *
 * Tests for Checklist field type conversions.
 * Migrated from: cypress/e2e/database/field-type-checklist.cy.ts
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

test.describe('Field Type - Checklist', () => {
  test('RichText ↔ Checklist handles markdown/plain text and preserves content', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    await addNewProperty(page, FieldType.RichText);
    const fieldId = await getLastFieldId(page);

    await typeTextIntoCell(page, fieldId, 0, '[x] Done\n[ ] Todo\nPlain line');

    // Switch to Checklist
    await editLastProperty(page, FieldType.Checklist);

    // Switch back to RichText to view markdown text
    await editLastProperty(page, FieldType.RichText);
    const fieldId2 = await getLastFieldId(page);
    const cells = getCellsForField(page, fieldId2);
    const cellCount = await cells.count();
    const values: string[] = [];
    for (let i = 0; i < cellCount; i++) {
      const text = await cells.nth(i).textContent();
      values.push((text || '').trim());
    }
    const allText = values.join('\n');
    expect(allText).toMatch(/Done|Todo|Plain/i);
  });

  test('Checklist field type can be created directly', async ({ page, request }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    // Add Checklist property directly
    await addNewProperty(page, FieldType.Checklist);
    const fieldId = await getLastFieldId(page);

    // Verify cells exist
    await expect(getCellsForField(page, fieldId)).not.toHaveCount(0);

    // Switch to RichText and back to verify round-trip works
    await editLastProperty(page, FieldType.RichText);
    await editLastProperty(page, FieldType.Checklist);
    await expect(getCellsForField(page, fieldId)).not.toHaveCount(0);
  });
});
