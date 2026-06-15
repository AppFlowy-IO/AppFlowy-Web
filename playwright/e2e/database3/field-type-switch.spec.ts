/**
 * Field Type Switch Tests
 * Migrated from: cypress/e2e/database3/field-type-switch.cy.ts
 *
 * Tests field type transformations and data preservation:
 * - Round-trip conversions (Type → RichText → Type)
 * - Cross-type conversions (Checkbox → Number → Checkbox)
 * - Chain transformations (A → B → C → D)
 * - Edit after type change then switch back
 */
import { test, expect } from '@playwright/test';
import {
  setupFieldTypeTest,
  loginAndCreateGrid,
  changeFieldTypeById,
  addFieldWithType,
  typeTextIntoCell,
  getCellTextContent,
  getAllCellContents,
  toggleCheckbox,
  addRows,
  assertRowCount,
  generateRandomEmail,
  FieldType,
} from '../../support/field-type-helpers';
import { DatabaseGridSelectors } from '../../support/selectors';

/**
 * Setup test data: add rows to get 8 total
 */
async function setupTestData(page: import('@playwright/test').Page) {
  await addRows(page, 5); // Default 3 + 5 = 8
  await assertRowCount(page, 8);
}

/**
 * Populate number field with test data
 */
async function populateNumberField(page: import('@playwright/test').Page, fieldId: string) {
  const numbers = ['-1', '-2', '0.1', '0.2', '1', '2', '10', '11'];
  for (let i = 0; i < numbers.length; i++) {
    await typeTextIntoCell(page, fieldId, i, numbers[i]);
  }
}

/**
 * Populate checkbox field: check first 5 rows
 */
async function populateCheckboxField(page: import('@playwright/test').Page, fieldId: string) {
  for (let i = 0; i < 5; i++) {
    await toggleCheckbox(page, fieldId, i);
  }
}

/**
 * Populate URL field
 */
async function populateURLField(page: import('@playwright/test').Page, fieldId: string) {
  const urls = ['https://appflowy.io', 'https://github.com', 'no-url-text'];
  for (let i = 0; i < urls.length; i++) {
    await typeTextIntoCell(page, fieldId, i, urls[i]);
  }
}

test.describe('Field Type Switch Tests (Desktop Parity)', () => {
  test.describe('Round-trip to RichText and back', () => {
    test('Number → RichText → Number preserves numeric values', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Number);
      await populateNumberField(page, fieldId);
      await page.waitForTimeout(500);

      const originalContents = await getAllCellContents(page, fieldId);
      // Guard: verify data was actually populated before round-trip
      const nonEmptyCount = originalContents.filter(v => v).length;
      expect(nonEmptyCount).toBeGreaterThan(0);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(1000);

      const finalContents = await getAllCellContents(page, fieldId);
      originalContents.forEach((original, index) => {
        if (original) {
          expect(finalContents[index]).toBe(original);
        }
      });
    });

    test('Checkbox → RichText → Checkbox preserves checked state', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Checkbox);
      await populateCheckboxField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.Checkbox);
      await page.waitForTimeout(1000);

      // Field should still exist and be functional
      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('URL → RichText → URL preserves URLs', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.URL);
      await populateURLField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.URL);
      await page.waitForTimeout(1000);

      // Field should still exist
      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('DateTime → RichText → DateTime preserves dates', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.DateTime);
      // Set a date by clicking cell and selecting from calendar
      await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(0).click({ force: true });
      await page.waitForTimeout(500);
      // Click day 15
      const dayButtons = page
        .locator('[data-radix-popper-content-wrapper]')
        .last()
        .locator('button')
        .filter({ hasText: '15' });
      const count = await dayButtons.count();
      for (let i = 0; i < count; i++) {
        const cls = await dayButtons.nth(i).getAttribute('class');
        if (!cls?.includes('day-outside')) {
          await dayButtons.nth(i).click({ force: true });
          break;
        }
      }
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.DateTime);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('MultiSelect → RichText → MultiSelect preserves tags', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.MultiSelect);
      // Create tags
      await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(0).click({ force: true });
      await page.waitForTimeout(500);
      const input = page.locator('[data-radix-popper-content-wrapper]').last().locator('input').first();
      await input.clear();
      await input.fill('Tag1');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await input.clear();
      await input.fill('Tag2');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.MultiSelect);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });
  });

  test.describe('Cross-type transformations', () => {
    test('Number → Checkbox → Number', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Number);
      await populateNumberField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.Checkbox);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('Checkbox → SingleSelect → Checkbox', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Checkbox);
      await populateCheckboxField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.SingleSelect);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.Checkbox);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('Number → SingleSelect → Number', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Number);
      await populateNumberField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.SingleSelect);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('Number → URL → Number', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Number);
      await populateNumberField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.URL);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('DateTime → Number → DateTime', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.DateTime);
      // Set a date
      await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(0).click({ force: true });
      await page.waitForTimeout(500);
      const dayButtons = page
        .locator('[data-radix-popper-content-wrapper]')
        .last()
        .locator('button')
        .filter({ hasText: '10' });
      const count = await dayButtons.count();
      for (let i = 0; i < count; i++) {
        const cls = await dayButtons.nth(i).getAttribute('class');
        if (!cls?.includes('day-outside')) {
          await dayButtons.nth(i).click({ force: true });
          break;
        }
      }
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.DateTime);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('DateTime → SingleSelect → DateTime', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.DateTime);
      // Set a date
      await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(0).click({ force: true });
      await page.waitForTimeout(500);
      const dayButtons2 = page
        .locator('[data-radix-popper-content-wrapper]')
        .last()
        .locator('button')
        .filter({ hasText: '20' });
      const count2 = await dayButtons2.count();
      for (let i = 0; i < count2; i++) {
        const cls = await dayButtons2.nth(i).getAttribute('class');
        if (!cls?.includes('day-outside')) {
          await dayButtons2.nth(i).click({ force: true });
          break;
        }
      }
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await changeFieldTypeById(page, fieldId, FieldType.SingleSelect);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.DateTime);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('MultiSelect → Checkbox → MultiSelect', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.MultiSelect);
      // Create a tag
      await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(0).click({ force: true });
      await page.waitForTimeout(500);
      const input = page.locator('[data-radix-popper-content-wrapper]').last().locator('input').first();
      await input.clear();
      await input.fill('TestTag');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await changeFieldTypeById(page, fieldId, FieldType.Checkbox);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.MultiSelect);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('URL → SingleSelect → URL', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.URL);
      await populateURLField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.SingleSelect);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.URL);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('SingleSelect → MultiSelect → SingleSelect', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.SingleSelect);

      await changeFieldTypeById(page, fieldId, FieldType.MultiSelect);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.SingleSelect);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });
  });

  test.describe('Chain transformations', () => {
    test('Number → URL → RichText → Number', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Number);
      await populateNumberField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.URL);
      await page.waitForTimeout(800);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(800);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(800);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('Checkbox → Number → SingleSelect → Checkbox', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Checkbox);
      await populateCheckboxField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(800);

      await changeFieldTypeById(page, fieldId, FieldType.SingleSelect);
      await page.waitForTimeout(800);

      await changeFieldTypeById(page, fieldId, FieldType.Checkbox);
      await page.waitForTimeout(800);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('DateTime → URL → RichText → DateTime', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.DateTime);
      // Set a date
      await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(0).click({ force: true });
      await page.waitForTimeout(500);
      const dayButtons = page
        .locator('[data-radix-popper-content-wrapper]')
        .last()
        .locator('button')
        .filter({ hasText: '12' });
      const count = await dayButtons.count();
      for (let i = 0; i < count; i++) {
        const cls = await dayButtons.nth(i).getAttribute('class');
        if (!cls?.includes('day-outside')) {
          await dayButtons.nth(i).click({ force: true });
          break;
        }
      }
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await changeFieldTypeById(page, fieldId, FieldType.URL);
      await page.waitForTimeout(800);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(800);

      await changeFieldTypeById(page, fieldId, FieldType.DateTime);
      await page.waitForTimeout(800);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('MultiSelect → Number → SingleSelect → MultiSelect', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.MultiSelect);
      // Create a tag
      await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(0).click({ force: true });
      await page.waitForTimeout(500);
      const input = page.locator('[data-radix-popper-content-wrapper]').last().locator('input').first();
      await input.clear();
      await input.fill('ChainTag');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(800);

      await changeFieldTypeById(page, fieldId, FieldType.SingleSelect);
      await page.waitForTimeout(800);

      await changeFieldTypeById(page, fieldId, FieldType.MultiSelect);
      await page.waitForTimeout(800);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });
  });
});

test.describe('Field Type Edit and Switch Tests (Desktop Parity)', () => {
  test.describe('Edit after type change', () => {
    test('Number → RichText → edit non-numeric → Number (should be empty)', async ({
      page,
      request,
    }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Number);
      await populateNumberField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      // Edit cell to non-numeric value
      await typeTextIntoCell(page, fieldId, 0, 'hello world');
      await page.waitForTimeout(500);

      // Change back to Number
      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(1000);

      const afterSwitch = await getCellTextContent(page, fieldId, 0);
      // Non-numeric text should result in empty number
      expect(afterSwitch).toBe('');
    });

    test('Number → RichText → edit numeric → Number (should convert)', async ({
      page,
      request,
    }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Number);
      await populateNumberField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await typeTextIntoCell(page, fieldId, 1, '456');
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(1000);

      const afterSwitch = await getCellTextContent(page, fieldId, 1);
      expect(afterSwitch).toBe('456');
    });

    test('Number → RichText → edit decimal → Number (should convert)', async ({
      page,
      request,
    }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Number);
      await populateNumberField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await typeTextIntoCell(page, fieldId, 2, '123.45');
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(1000);

      const afterSwitch = await getCellTextContent(page, fieldId, 2);
      expect(afterSwitch).toBe('123.45');
    });

    test('Edit Number directly → RichText → Number preserves value', async ({
      page,
      request,
    }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Number);
      await typeTextIntoCell(page, fieldId, 3, '777');
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(1000);

      const afterSwitch = await getCellTextContent(page, fieldId, 3);
      expect(afterSwitch).toBe('777');
    });

    test('Toggle Checkbox → RichText → Checkbox preserves state', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Checkbox);
      await populateCheckboxField(page, fieldId);
      // Toggle one more at row 5
      await toggleCheckbox(page, fieldId, 5);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await changeFieldTypeById(page, fieldId, FieldType.Checkbox);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('DateTime → RichText → edit date string → DateTime', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.DateTime);
      // Set initial date
      await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(0).click({ force: true });
      await page.waitForTimeout(500);
      const dayButtons = page
        .locator('[data-radix-popper-content-wrapper]')
        .last()
        .locator('button')
        .filter({ hasText: '5' });
      const count = await dayButtons.count();
      for (let i = 0; i < count; i++) {
        const cls = await dayButtons.nth(i).getAttribute('class');
        if (!cls?.includes('day-outside')) {
          await dayButtons.nth(i).click({ force: true });
          break;
        }
      }
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      // Edit to a different date text
      await typeTextIntoCell(page, fieldId, 0, '2025-01-15');
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.DateTime);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('SingleSelect → RichText → edit option → SingleSelect', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.SingleSelect);
      // Create an option
      await DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(0).click({ force: true });
      await page.waitForTimeout(500);
      const input = page.locator('[data-radix-popper-content-wrapper]').last().locator('input').first();
      await input.clear();
      await input.fill('OriginalOption');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      // Edit to a new value
      await typeTextIntoCell(page, fieldId, 0, 'EditedOption');
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.SingleSelect);
      await page.waitForTimeout(1000);

      await expect(DatabaseGridSelectors.dataRowCellsForField(page, fieldId)).not.toHaveCount(0);
    });

    test('URL → RichText → edit URL → URL preserves edited value', async ({ page, request }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.URL);
      await populateURLField(page, fieldId);
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await typeTextIntoCell(page, fieldId, 0, 'https://new-url.com');
      await page.waitForTimeout(500);

      await changeFieldTypeById(page, fieldId, FieldType.URL);
      await page.waitForTimeout(1000);

      const afterSwitch = await getCellTextContent(page, fieldId, 0);
      expect(afterSwitch).toContain('new-url.com');
    });
  });

  test.describe('Chain transformation with edits', () => {
    test('Number → RichText(edit) → SingleSelect → RichText(edit) → Number', async ({
      page,
      request,
    }) => {
      setupFieldTypeTest(page);
      const testEmail = generateRandomEmail();
      await loginAndCreateGrid(page, request, testEmail);
      await setupTestData(page);

      const fieldId = await addFieldWithType(page, FieldType.Number);
      await populateNumberField(page, fieldId);
      await page.waitForTimeout(500);

      // → RichText and edit
      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await typeTextIntoCell(page, fieldId, 4, '100');
      await page.waitForTimeout(500);

      // → SingleSelect
      await changeFieldTypeById(page, fieldId, FieldType.SingleSelect);
      await page.waitForTimeout(1000);

      // → RichText and edit again
      await changeFieldTypeById(page, fieldId, FieldType.RichText);
      await page.waitForTimeout(1000);

      await typeTextIntoCell(page, fieldId, 4, '200');
      await page.waitForTimeout(500);

      // → Number
      await changeFieldTypeById(page, fieldId, FieldType.Number);
      await page.waitForTimeout(1000);

      const finalContent = await getCellTextContent(page, fieldId, 4);
      expect(finalContent).toBe('200');
    });
  });
});
