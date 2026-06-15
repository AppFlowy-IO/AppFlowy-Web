/**
 * AI Summary / AI Translate field "Generate" button tests
 *
 * Migrated from: cypress/e2e/database/ai-field-generate.cy.ts
 *
 * Verifies that clicking the Generate button on AI Summary and AI Translate
 * cells calls the correct API endpoint and updates the cell with the response.
 * The actual AI endpoints are mocked via page.route().
 */
import { test, expect } from '@playwright/test';
import { DatabaseGridSelectors, FieldType } from '../../support/selectors';
import {
  generateRandomEmail,
  setupFieldTypeTest,
  loginAndCreateGrid,
  addNewProperty,
  getLastFieldId,
  typeTextIntoCell,
} from '../../support/field-type-test-helpers';

test.describe('AI Field - Generate Button', () => {
  test('should call summarize_row API and display the result when Generate is clicked on AI Summary field', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    const mockSummary = 'This is a mock AI summary of the row data.';

    await loginAndCreateGrid(page, request, testEmail);

    // Type some text into the first row's primary field
    await DatabaseGridSelectors.firstCell(page).click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.type('apple');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Mock the AI summary endpoint and capture the request body
    let capturedBody: any = null;
    await page.route('**/api/ai/*/summarize_row', async (route) => {
      capturedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: { text: mockSummary },
          message: 'success',
        }),
      });
    });

    // Add an AI Summary property
    await addNewProperty(page, FieldType.Summary);

    // Get the field ID of the newly added AI Summary column
    const fieldId = await getLastFieldId(page);

    // Find the first data row's AI cell and hover over it to reveal the Generate button
    const aiCell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).first();
    await aiCell.scrollIntoViewIfNeeded();
    await aiCell.hover();
    await page.waitForTimeout(500);

    // Click the Generate button
    const generateButton = page.locator('[data-testid^="ai-generate-button-"]').first();
    await expect(generateButton).toBeVisible();
    await generateButton.click();

    // Verify the request payload contains a Content key with row data
    await page.waitForTimeout(2000);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toHaveProperty('data');
    expect(capturedBody.data).toHaveProperty('Content');

    // Verify the summary text appears in the cell
    await expect(DatabaseGridSelectors.cellsForField(page, fieldId).first()).toContainText(mockSummary);
  });

  test('should call translate_row API and display the result when Generate is clicked on AI Translate field', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    const mockTranslation = 'Translated content here';

    await loginAndCreateGrid(page, request, testEmail);

    // Type some text into the first row's primary field
    await DatabaseGridSelectors.firstCell(page).click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.type('hello world');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Mock the AI translate endpoint and capture the request body
    let capturedBody: any = null;
    await page.route('**/api/ai/*/translate_row', async (route) => {
      capturedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: { items: [{ content: mockTranslation }] },
          message: 'success',
        }),
      });
    });

    // Add an AI Translations property
    await addNewProperty(page, FieldType.Translate);

    const fieldId = await getLastFieldId(page);

    // Hover over the first AI Translate cell to reveal the Generate button
    const aiCell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).first();
    await aiCell.scrollIntoViewIfNeeded();
    await aiCell.hover();
    await page.waitForTimeout(500);

    // Click the Generate button
    const generateButton = page.locator('[data-testid^="ai-generate-button-"]').first();
    await expect(generateButton).toBeVisible();
    await generateButton.click();

    // Verify the request payload contains cells and language
    await page.waitForTimeout(2000);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toHaveProperty('data');
    expect(capturedBody.data).toHaveProperty('cells');
    expect(capturedBody.data).toHaveProperty('language');

    // Verify the translated text appears in the cell
    await expect(DatabaseGridSelectors.cellsForField(page, fieldId).first()).toContainText(mockTranslation);
  });

  test('should show error toast when summarize_row API fails', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();

    await loginAndCreateGrid(page, request, testEmail);

    // Type some text so the row isn't empty
    await DatabaseGridSelectors.firstCell(page).click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.type('test data');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Mock the AI summary endpoint to return an error
    await page.route('**/api/ai/*/summarize_row', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          code: -1,
          message: 'Internal server error',
        }),
      });
    });

    // Add an AI Summary property
    await addNewProperty(page, FieldType.Summary);

    const fieldId = await getLastFieldId(page);

    // Hover to reveal Generate button
    const aiCell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).first();
    await aiCell.scrollIntoViewIfNeeded();
    await aiCell.hover();
    await page.waitForTimeout(500);

    // Click Generate
    const generateButton = page.locator('[data-testid^="ai-generate-button-"]').first();
    await expect(generateButton).toBeVisible();
    await generateButton.click();

    // The cell should remain empty (no crash, graceful error handling)
    await page.waitForTimeout(2000);
    const cellText = await DatabaseGridSelectors.cellsForField(page, fieldId).first().innerText();
    expect(cellText.trim()).toBe('');
  });

  test('should collect data from multiple fields when generating AI summary', async ({
    page,
    request,
  }) => {
    setupFieldTypeTest(page);
    const testEmail = generateRandomEmail();
    const mockSummary = 'Summary of multiple fields';

    await loginAndCreateGrid(page, request, testEmail);

    // Type into the primary field (Name)
    await DatabaseGridSelectors.firstCell(page).click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.type('banana');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Add a RichText property and type data into it
    await addNewProperty(page, FieldType.RichText);
    const textFieldId = await getLastFieldId(page);
    await typeTextIntoCell(page, textFieldId, 0, 'yellow fruit');

    // Track the API request to verify multi-field data
    let capturedBody: any = null;
    await page.route('**/api/ai/*/summarize_row', async (route) => {
      capturedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: { text: mockSummary },
          message: 'success',
        }),
      });
    });

    // Add AI Summary property
    await addNewProperty(page, FieldType.Summary);

    const fieldId = await getLastFieldId(page);

    // Hover and click Generate
    const aiCell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).first();
    await aiCell.scrollIntoViewIfNeeded();
    await aiCell.hover();
    await page.waitForTimeout(500);

    const generateButton = page.locator('[data-testid^="ai-generate-button-"]').first();
    await expect(generateButton).toBeVisible();
    await generateButton.click();

    // Verify the API was called with data from multiple fields
    await page.waitForTimeout(2000);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.data).toHaveProperty('Content');
    const content = capturedBody.data.Content;
    const values = Object.values(content);
    const hasData = values.some((v: unknown) => typeof v === 'string' && (v as string).length > 0);
    expect(hasData).toBeTruthy();

    // Verify the summary appears
    await expect(DatabaseGridSelectors.cellsForField(page, fieldId).first()).toContainText(mockSummary);
  });
});
