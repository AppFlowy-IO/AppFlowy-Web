/**
 * Shared helpers for field type E2E tests.
 * These helpers are used across multiple test files to avoid code duplication.
 */
import 'cypress-real-events';
import { AuthTestUtils } from './auth-utils';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  GridFieldSelectors,
  PropertyMenuSelectors,
  waitForReactUpdate,
} from './selectors';
import { generateRandomEmail } from './test-config';

// Re-export for convenience
export { generateRandomEmail };

/**
 * Helper to extract fieldId from a field header's data-testid
 * Format: grid-field-header-{fieldId}
 */
export const getLastFieldId = (): Cypress.Chainable<string> => {
  return GridFieldSelectors.allFieldHeaders()
    .last()
    .invoke('attr', 'data-testid')
    .then((testId) => {
      // Extract fieldId from "grid-field-header-{fieldId}"
      return testId?.replace('grid-field-header-', '') || '';
    });
};

/**
 * Helper to get all cells for a specific field (column)
 * Uses centralized selector from DatabaseGridSelectors
 */
export const getCellsForField = (fieldId: string) => {
  return DatabaseGridSelectors.cellsForField(fieldId);
};

/**
 * Helper to get the clickable row cell wrapper for a field (column) - DATA ROWS ONLY
 * Uses centralized selector from DatabaseGridSelectors
 */
export const getDataRowCellsForField = (fieldId: string) => {
  return DatabaseGridSelectors.dataRowCellsForField(fieldId);
};

/**
 * Helper to type text into a cell. Uses the centralized dataRowCellsForField selector.
 * NOTE: Uses Enter to save the value, not Escape.
 * This is important because NumberCell only saves on Enter/blur, not on Escape.
 */
export const typeTextIntoCell = (fieldId: string, cellIndex: number, text: string): void => {
  cy.log(`typeTextIntoCell: field=${fieldId}, dataRowIndex=${cellIndex}, text=${text}`);

  // Click to enter edit mode using centralized selector
  DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .eq(cellIndex)
    .should('be.visible')
    .scrollIntoView()
    .click()
    .click(); // Double click to enter edit mode

  // Replace newlines with Shift+Enter to insert actual newlines without triggering save
  // In Cypress, \n is interpreted as pressing Enter, which triggers cell save
  // Using {shift}{enter} inserts a newline character instead
  const textWithShiftEnter = text.replace(/\n/g, '{shift}{enter}');

  // Wait for textarea and type
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
 * Login and create a new grid for testing
 */
export const loginAndCreateGrid = (email: string) => {
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
 * Add a new property/field of the specified type
 */
export const addNewProperty = (fieldType: number) => {
  PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
  waitForReactUpdate(1200);
  // Radix UI DropdownMenuSub opens on hover, not click - use realHover to trigger submenu
  PropertyMenuSelectors.propertyTypeTrigger().first().realHover();
  waitForReactUpdate(600);
  // Scroll the option into view before clicking (for options at the bottom of the dropdown)
  PropertyMenuSelectors.propertyTypeOption(fieldType).scrollIntoView().click({ force: true });
  waitForReactUpdate(800);
  cy.get('body').type('{esc}');
  waitForReactUpdate(500);
};

/**
 * Edit the last property/field to change its type
 */
export const editLastProperty = (newType: number) => {
  GridFieldSelectors.allFieldHeaders().last().click({ force: true });
  waitForReactUpdate(600);
  PropertyMenuSelectors.editPropertyMenuItem().then(($edit) => {
    if ($edit.length > 0) {
      cy.wrap($edit).click({ force: true });
      waitForReactUpdate(500);
    }
  });
  // Radix UI DropdownMenuSub opens on hover, not click - use realHover to trigger submenu
  PropertyMenuSelectors.propertyTypeTrigger().first().realHover();
  waitForReactUpdate(600);
  // Scroll the option into view before clicking (for options at the bottom of the dropdown)
  PropertyMenuSelectors.propertyTypeOption(newType).scrollIntoView().click({ force: true });
  waitForReactUpdate(800);
  cy.get('body').type('{esc}{esc}');
  waitForReactUpdate(500);
};

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

  // Use a taller viewport to ensure all dropdown items (including Time at the bottom) are visible
  cy.viewport(1280, 900);
};
