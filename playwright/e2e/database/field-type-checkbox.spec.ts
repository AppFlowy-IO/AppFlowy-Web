/**
 * Checkbox field type tests
 *
 * Tests for Checkbox field type conversions and interactions.
 * Migrated from: cypress/e2e/database/field-type-checkbox.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  DatabaseGridSelectors,
  CheckboxSelectors,
  FieldType,
} from '../../support/selectors';
import {
  generateRandomEmail,
  setupFieldTypeTest,
  loginAndCreateGrid,
  addNewProperty,
  editLastProperty,
  getLastFieldId,
  getCellsForField,
  getDataRowCellsForField,
} from '../../support/field-type-test-helpers';

test.describe('Field Type - Checkbox', () => {
  test('RichText to Checkbox parses truthy/falsy and preserves original text', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    // Add RichText property
    await addNewProperty(page, FieldType.RichText);

    const textFieldId = await getLastFieldId(page);

    // Type 'yes' into first DATA cell
    const firstCell = getDataRowCellsForField(page, textFieldId).nth(0);
    await firstCell.scrollIntoViewIfNeeded();
    await firstCell.click();
    await page.waitForTimeout(1500);
    const textarea1 = page.locator('textarea:visible').first();
    await expect(textarea1).toBeVisible({ timeout: 5000 });
    await textarea1.clear();
    await textarea1.pressSequentially('yes', { delay: 30 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Type 'no' into second DATA cell
    const secondCell = getDataRowCellsForField(page, textFieldId).nth(1);
    await secondCell.scrollIntoViewIfNeeded();
    await secondCell.click();
    await page.waitForTimeout(1500);
    const textarea2 = page.locator('textarea:visible').first();
    await expect(textarea2).toBeVisible({ timeout: 5000 });
    await textarea2.clear();
    await textarea2.pressSequentially('no', { delay: 30 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Switch to Checkbox
    await editLastProperty(page, FieldType.Checkbox);

    // Verify rendering shows checkbox icons
    await expect(page.getByTestId('checkbox-checked-icon').first()).toBeVisible();
    await expect(page.getByTestId('checkbox-unchecked-icon').first()).toBeVisible();

    // Switch back to RichText and ensure original raw text survives
    await editLastProperty(page, FieldType.RichText);
    const fieldId2 = await getLastFieldId(page);
    const cells = getCellsForField(page, fieldId2);
    const cellCount = await cells.count();
    const values: string[] = [];
    for (let i = 0; i < cellCount; i++) {
      const text = await cells.nth(i).textContent();
      values.push(text || '');
    }
    expect(values.some((v) => v.toLowerCase().includes('yes'))).toBe(true);
    expect(values.some((v) => v.toLowerCase().includes('no'))).toBe(true);
  });

  test('Checkbox click creates checked state that survives type switch', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    await addNewProperty(page, FieldType.Checkbox);
    const checkboxFieldId = await getLastFieldId(page);

    // Click the first checkbox to check it
    await getCellsForField(page, checkboxFieldId).first().click({ force: true });
    await page.waitForTimeout(500);

    // Verify it's checked
    const fieldId = await getLastFieldId(page);
    await expect(
      getCellsForField(page, fieldId).first().locator('[data-testid="checkbox-checked-icon"]')
    ).toBeVisible();

    // Switch to SingleSelect - should show "Yes"
    await editLastProperty(page, FieldType.SingleSelect);
    const fieldId2 = await getLastFieldId(page);
    await expect(getCellsForField(page, fieldId2).first()).toContainText('Yes');

    // Switch back to Checkbox - should still be checked
    await editLastProperty(page, FieldType.Checkbox);
    const fieldId3 = await getLastFieldId(page);
    await expect(
      getCellsForField(page, fieldId3).first().locator('[data-testid="checkbox-checked-icon"]')
    ).toBeVisible();
  });
});
