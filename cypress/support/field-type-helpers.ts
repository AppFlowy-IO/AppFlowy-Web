/**
 * Field Type Switch test helpers for database E2E tests
 * Provides utilities for changing field types and verifying data transformations
 */
import 'cypress-real-events';
import { AuthTestUtils } from './auth-utils';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  GridFieldSelectors,
  PropertyMenuSelectors,
  waitForReactUpdate,
  FieldType,
} from './selectors';
import { generateRandomEmail } from './test-config';

// Re-export for convenience
export { generateRandomEmail, FieldType };

/**
 * Common beforeEach setup for field type tests
 */
export const setupFieldTypeTest = () => {
  cy.on('uncaught:exception', (err) => {
    if (
      err.message.includes('Minified React error') ||
      err.message.includes('View not found') ||
      err.message.includes('No workspace or service found')
    ) {
      return false;
    }
    return true;
  });

  cy.viewport(1280, 900);
};

/**
 * Login and create a new grid for field type testing
 */
export const loginAndCreateGrid = (email: string): Cypress.Chainable => {
  cy.visit('/login', { failOnStatusCode: false });
  cy.wait(1500);
  const authUtils = new AuthTestUtils();
  return authUtils.signInWithTestUrl(email).then(() => {
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.wait(4000);

    // Create a new grid
    AddPageSelectors.inlineAddButton().first().click({ force: true });
    waitForReactUpdate(800);
    AddPageSelectors.addGridButton().should('exist').click({ force: true });
    cy.wait(7000);
    DatabaseGridSelectors.grid().should('exist');
    DatabaseGridSelectors.cells().should('have.length.greaterThan', 0);
  });
};

/**
 * Get field ID by header name
 */
export const getFieldIdByName = (fieldName: string): Cypress.Chainable<string> => {
  return cy
    .contains('[data-testid^="grid-field-header-"]', fieldName)
    .invoke('attr', 'data-testid')
    .then((testId) => {
      const fieldId = testId?.replace('grid-field-header-', '') || '';
      return cy.wrap(fieldId);
    });
};

/**
 * Click on a field header by field ID to open the field menu
 * Uses .last() because there can be both sticky and regular headers - the last one typically has the menu
 */
export const clickFieldHeaderById = (fieldId: string): void => {
  cy.get(`[data-testid="grid-field-header-${fieldId}"]`).last().click({ force: true });
  waitForReactUpdate(800);
};

/**
 * Click on a field header to open the field menu (legacy - by name)
 */
export const clickFieldHeader = (fieldName: string): void => {
  cy.contains('[data-testid^="grid-field-header-"]', fieldName).click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Change a field's type by field ID
 * Opens the field menu, clicks edit, changes the type
 */
export const changeFieldTypeById = (fieldId: string, newFieldType: FieldType): void => {
  // Click on the field header to open field menu
  clickFieldHeaderById(fieldId);

  // Wait for and click "Edit property" button
  PropertyMenuSelectors.editPropertyMenuItem().should('be.visible').first().click({ force: true });
  waitForReactUpdate(800);

  // Click on the type trigger to open the type selection menu
  PropertyMenuSelectors.propertyTypeTrigger().should('be.visible').first().click({ force: true });
  waitForReactUpdate(500);

  // Select the new field type
  PropertyMenuSelectors.propertyTypeOption(newFieldType).first().click({ force: true });
  waitForReactUpdate(1000);

  // Close by pressing Escape
  cy.get('body').type('{esc}');
  waitForReactUpdate(500);
};

/**
 * Change a field's type by name (legacy)
 * Opens the field menu, clicks edit, changes the type
 */
export const changeFieldType = (fieldName: string, newFieldType: FieldType): void => {
  // Click on the field header to open field menu
  clickFieldHeader(fieldName);
  waitForReactUpdate(500);

  // Click "Edit property" button
  PropertyMenuSelectors.editPropertyMenuItem().click({ force: true });
  waitForReactUpdate(500);

  // Click on the type trigger to open the type selection menu
  PropertyMenuSelectors.propertyTypeTrigger().click({ force: true });
  waitForReactUpdate(500);

  // Select the new field type
  PropertyMenuSelectors.propertyTypeOption(newFieldType).click({ force: true });
  waitForReactUpdate(800);

  // Close by pressing Escape
  cy.get('body').type('{esc}');
  waitForReactUpdate(500);
};

/**
 * Add a new field with specific type
 * Returns field ID via alias - use cy.get('@fieldId') to access
 */
export const addFieldWithType = (fieldType: FieldType): Cypress.Chainable<string> => {
  PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
  waitForReactUpdate(1200);
  PropertyMenuSelectors.propertyTypeTrigger().first().realHover();
  waitForReactUpdate(600);
  PropertyMenuSelectors.propertyTypeOption(fieldType).first().scrollIntoView().click({ force: true });
  waitForReactUpdate(800);
  cy.get('body').type('{esc}');
  waitForReactUpdate(500);

  return GridFieldSelectors.allFieldHeaders()
    .last()
    .invoke('attr', 'data-testid')
    .then((testId) => {
      const fieldId = testId?.replace('grid-field-header-', '') || '';
      // Wrap and return properly for chaining
      return cy.wrap(fieldId);
    });
};

/**
 * Type text into a cell at the specified index
 * Uses realClick from cypress-real-events for reliable cell activation
 * NOTE: Uses Enter to save the value, not Escape.
 * This is important because NumberCell only saves on Enter/blur, not on Escape.
 */
export const typeTextIntoCell = (fieldId: string, cellIndex: number, text: string): void => {
  cy.log(`typeTextIntoCell: field=${fieldId}, dataRowIndex=${cellIndex}, text=${text}`);

  // Click to enter edit mode using realClick for reliable activation
  DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .eq(cellIndex)
    .should('be.visible')
    .scrollIntoView()
    .realClick();

  // Wait for the cell to become active and render the textarea
  cy.wait(1500);

  // Replace newlines with Shift+Enter to insert actual newlines without triggering save
  // In Cypress, \n is interpreted as pressing Enter, which triggers cell save
  // Using {shift}{enter} inserts a newline character instead
  const textWithShiftEnter = text.replace(/\n/g, '{shift}{enter}');

  // The textarea should appear when the cell becomes active
  cy.get('textarea:visible', { timeout: 8000 })
    .should('exist')
    .first()
    .clear()
    .type(textWithShiftEnter, { delay: 30 });

  // Press Enter to save the value and close the cell
  // Note: Both TextCellEditing and NumberCellEditing save on Enter
  // Using Escape would NOT save for NumberCell
  cy.get('textarea:visible').first().type('{enter}');
  cy.wait(500);
};

/**
 * Get text content of a cell by field ID and row index
 */
export const getCellTextContent = (fieldId: string, rowIndex: number): Cypress.Chainable<string> => {
  return DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .eq(rowIndex)
    .invoke('text')
    .then((text) => cy.wrap(text.trim()));
};

/**
 * Get all cell contents for a field
 */
export const getAllCellContents = (fieldId: string): Cypress.Chainable<string[]> => {
  return DatabaseGridSelectors.dataRowCellsForField(fieldId).then(($cells) => {
    const contents: string[] = [];
    $cells.each((_, cell) => {
      contents.push(Cypress.$(cell).text().trim());
    });
    return cy.wrap(contents);
  });
};

/**
 * Click a checkbox cell to toggle it
 */
export const toggleCheckbox = (fieldId: string, rowIndex: number): void => {
  DatabaseGridSelectors.dataRowCellsForField(fieldId).eq(rowIndex).click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Add more rows to the grid
 */
export const addRows = (count: number): void => {
  const RowControlsSelectors = {
    rowAccessoryButton: () => cy.get('[data-testid="row-accessory-button"]'),
    rowMenuInsertBelow: () => cy.get('[data-testid="row-menu-insert-below"]'),
  };

  for (let i = 0; i < count; i++) {
    DatabaseGridSelectors.dataRows().last().scrollIntoView();
    RowControlsSelectors.rowAccessoryButton().last().click({ force: true });
    waitForReactUpdate(300);
    RowControlsSelectors.rowMenuInsertBelow().click({ force: true });
    waitForReactUpdate(500);
  }
};

/**
 * Assert the number of visible data rows in the grid
 */
export const assertRowCount = (expectedCount: number): void => {
  DatabaseGridSelectors.dataRows().should('have.length', expectedCount);
};

/**
 * Get the primary field ID (first column, Name field)
 */
export const getPrimaryFieldId = (): Cypress.Chainable<string> => {
  return cy
    .get('[data-testid^="grid-field-header-"]')
    .first()
    .invoke('attr', 'data-testid')
    .then((testId) => {
      const fieldId = testId?.replace('grid-field-header-', '') || '';
      return cy.wrap(fieldId);
    });
};

/**
 * Field type display names for logging
 */
export const FieldTypeNames: Record<number, string> = {
  [FieldType.RichText]: 'RichText',
  [FieldType.Number]: 'Number',
  [FieldType.DateTime]: 'DateTime',
  [FieldType.SingleSelect]: 'SingleSelect',
  [FieldType.MultiSelect]: 'MultiSelect',
  [FieldType.Checkbox]: 'Checkbox',
  [FieldType.URL]: 'URL',
  [FieldType.Checklist]: 'Checklist',
  [FieldType.LastEditedTime]: 'LastEditedTime',
  [FieldType.CreatedTime]: 'CreatedTime',
  [FieldType.Relation]: 'Relation',
  [FieldType.Summary]: 'Summary',
  [FieldType.Translate]: 'Translate',
  [FieldType.Time]: 'Time',
  [FieldType.Media]: 'Media',
};
