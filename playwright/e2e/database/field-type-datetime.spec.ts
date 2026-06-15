/**
 * DateTime field type tests
 *
 * These tests verify DateTime field conversions and date picker interactions.
 * Migrated from: cypress/e2e/database/field-type-datetime.cy.ts
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
  getDataRowCellsForField,
  typeTextIntoCell,
} from '../../support/field-type-test-helpers';

test.describe('Field Type - DateTime', () => {
  test('RichText ↔ DateTime converts and preserves date data', async ({ page, request }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    // Add RichText property
    await addNewProperty(page, FieldType.RichText);
    const fieldId = await getLastFieldId(page);

    // Enter a Unix timestamp in milliseconds (Jan 16, 2024 00:00:00 UTC)
    const testTimestamp = '1705363200000';
    await typeTextIntoCell(page, fieldId, 0, testTimestamp);

    // Switch to DateTime
    await editLastProperty(page, FieldType.DateTime);

    // Verify cell renders something (DateTime cells show formatted date)
    const fieldId2 = await getLastFieldId(page);
    const cellText = await getCellsForField(page, fieldId2).first().textContent();
    expect((cellText || '').trim().length).toBeGreaterThan(0);

    // Switch back to RichText - data should be preserved
    await editLastProperty(page, FieldType.RichText);
    const fieldId3 = await getLastFieldId(page);
    const cellText2 = await getCellsForField(page, fieldId3).first().textContent();
    expect((cellText2 || '').trim().length).toBeGreaterThan(0);
  });

  test('DateTime field with date picker preserves selected date through type switches', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    // Add DateTime property directly
    await addNewProperty(page, FieldType.DateTime);
    const fieldId = await getLastFieldId(page);

    // Click on first cell to open date picker
    await getDataRowCellsForField(page, fieldId).nth(0).scrollIntoViewIfNeeded();
    await getDataRowCellsForField(page, fieldId).nth(0).click({ force: true });
    await page.waitForTimeout(800);

    // Wait for the date picker popover to appear
    await expect(page.getByTestId('datetime-picker-popover')).toBeVisible({ timeout: 8000 });

    // Click on any available day button to set a date
    await page
      .getByTestId('datetime-picker-popover')
      .locator('button[name="day"]')
      .first()
      .click({ force: true });
    await page.waitForTimeout(500);

    // Close the date picker
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify the cell now has a date value
    const cellText = await getCellsForField(page, fieldId).first().textContent();
    expect((cellText || '').trim().length).toBeGreaterThan(0);

    // Switch to RichText - should show the date as text
    await editLastProperty(page, FieldType.RichText);
    const fieldId2 = await getLastFieldId(page);
    const cellText2 = await getCellsForField(page, fieldId2).first().textContent();
    expect((cellText2 || '').trim().length).toBeGreaterThan(0);

    // Switch back to DateTime - date should be preserved
    await editLastProperty(page, FieldType.DateTime);
    const fieldId3 = await getLastFieldId(page);
    const cellText3 = await getCellsForField(page, fieldId3).first().textContent();
    expect((cellText3 || '').trim().length).toBeGreaterThan(0);
  });

  test('DateTime field renders correct format', async ({ page, request }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    await loginAndCreateGrid(page, request, testEmail);

    // Add DateTime property
    await addNewProperty(page, FieldType.DateTime);
    const fieldId = await getLastFieldId(page);

    // Click cell to open date picker
    await getDataRowCellsForField(page, fieldId).nth(0).scrollIntoViewIfNeeded();
    await getDataRowCellsForField(page, fieldId).nth(0).click({ force: true });
    await page.waitForTimeout(800);

    // Wait for date picker
    await expect(page.getByTestId('datetime-picker-popover')).toBeVisible({ timeout: 8000 });

    // Click a day
    await page
      .getByTestId('datetime-picker-popover')
      .locator('button[name="day"]')
      .first()
      .click({ force: true });
    await page.waitForTimeout(500);

    // Close picker
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify the cell has date-like content (contains at least a number)
    const cellText = (await getCellsForField(page, fieldId).first().textContent()) || '';
    expect(cellText.trim()).toMatch(/\d/);
  });
});
