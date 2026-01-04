/**
 * Shared helpers for filter and sort E2E tests.
 * These helpers handle common filter/sort operations to avoid code duplication.
 */
import 'cypress-real-events';
import { AuthTestUtils } from './auth-utils';
import {
  AddPageSelectors,
  DatabaseFilterSelectors,
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
 * Common beforeEach setup for filter/sort tests
 */
export const setupFilterSortTest = () => {
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

  // Use a taller viewport for dropdown visibility
  cy.viewport(1280, 900);
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
 * Helper to extract fieldId from a field header's data-testid
 * Format: grid-field-header-{fieldId}
 */
export const getLastFieldId = (): Cypress.Chainable<string> => {
  return GridFieldSelectors.allFieldHeaders()
    .last()
    .invoke('attr', 'data-testid')
    .then((testId) => {
      return testId?.replace('grid-field-header-', '') || '';
    });
};

/**
 * Get field ID by field name
 */
export const getFieldIdByName = (name: string): Cypress.Chainable<string> => {
  return GridFieldSelectors.allFieldHeaders()
    .contains(name)
    .closest('[data-testid^="grid-field-header-"]')
    .invoke('attr', 'data-testid')
    .then((testId) => {
      return testId?.replace('grid-field-header-', '') || '';
    });
};

/**
 * Helper to get all cells for a specific field (column)
 */
export const getCellsForField = (fieldId: string) => {
  return DatabaseGridSelectors.cellsForField(fieldId);
};

/**
 * Helper to get the clickable row cell wrapper for a field (column) - DATA ROWS ONLY
 */
export const getDataRowCellsForField = (fieldId: string) => {
  return DatabaseGridSelectors.dataRowCellsForField(fieldId);
};

/**
 * Add a new property/field of the specified type
 */
export const addNewProperty = (fieldType: number) => {
  PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
  waitForReactUpdate(1200);
  PropertyMenuSelectors.propertyTypeTrigger().first().realHover();
  waitForReactUpdate(600);
  PropertyMenuSelectors.propertyTypeOption(fieldType).scrollIntoView().click({ force: true });
  waitForReactUpdate(800);
  cy.get('body').type('{esc}');
  waitForReactUpdate(500);
};

/**
 * Type text into a cell and save it.
 * Uses Enter to save (works for both text and number cells).
 */
export const typeTextIntoCell = (fieldId: string, cellIndex: number, text: string): void => {
  cy.log(`typeTextIntoCell: field=${fieldId}, dataRowIndex=${cellIndex}, text=${text}`);

  DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .eq(cellIndex)
    .should('be.visible')
    .scrollIntoView()
    .click()
    .click();

  cy.get('textarea:visible', { timeout: 8000 })
    .should('exist')
    .first()
    .clear()
    .type(text, { delay: 30 })
    .type('{enter}'); // Use Enter to save the value (works for text and number cells)
  cy.wait(500);
};

/**
 * Click a checkbox cell to toggle it
 */
export const clickCheckboxCell = (fieldId: string, cellIndex: number): void => {
  cy.log(`clickCheckboxCell: field=${fieldId}, dataRowIndex=${cellIndex}`);

  DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .eq(cellIndex)
    .should('be.visible')
    .scrollIntoView()
    .click({ force: true });
  waitForReactUpdate(500);
};

// ============== FILTER HELPERS ==============

/**
 * Create a filter by clicking the filter button and selecting a field.
 * This opens the PropertiesMenu, selects the field, then the filter menu opens.
 */
export const createFilter = (fieldName: string) => {
  cy.log(`Creating filter for field: ${fieldName}`);

  // Click filter button to show field picker
  DatabaseFilterSelectors.filterButton().click({ force: true });
  waitForReactUpdate(500);

  // Select the field from the picker - find by field name in the popover
  cy.get('.appflowy-scroller')
    .contains(fieldName)
    .click({ force: true });
  waitForReactUpdate(800);
};

/**
 * Add another filter when filters already exist
 */
export const addAnotherFilter = (fieldName: string) => {
  cy.log(`Adding another filter for field: ${fieldName}`);

  // Click the add filter button
  DatabaseFilterSelectors.addFilterButton().click({ force: true });
  waitForReactUpdate(500);

  // Select the field from the picker
  cy.get('.appflowy-scroller')
    .contains(fieldName)
    .click({ force: true });
  waitForReactUpdate(800);
};

/**
 * Open an existing filter's menu by clicking on its condition pill
 */
export const openFilterMenu = (index = 0) => {
  cy.log(`Opening filter menu at index: ${index}`);
  DatabaseFilterSelectors.filterCondition().eq(index).click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Change the filter condition by selecting from the dropdown.
 * Assumes the filter menu is already open.
 * @param conditionText - The visible text of the condition (e.g., "contains", "is empty")
 */
export const selectFilterCondition = (conditionText: string) => {
  cy.log(`Selecting filter condition: ${conditionText}`);

  // Find the condition dropdown trigger and click it
  cy.get('[data-testid="text-filter"]')
    .find('button')
    .first()
    .click({ force: true });
  waitForReactUpdate(300);

  // Select the condition from dropdown
  cy.get('[role="menuitem"]')
    .contains(conditionText)
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Set the filter value in the text input.
 * Assumes the filter menu is already open.
 */
export const setFilterValue = (value: string) => {
  cy.log(`Setting filter value: ${value}`);

  DatabaseFilterSelectors.filterInput()
    .should('be.visible')
    .clear()
    .type(value, { delay: 30 });
  waitForReactUpdate(500);
};

/**
 * Delete a filter by clicking the delete button in the filter menu.
 * Assumes the filter menu is already open.
 */
export const deleteCurrentFilter = () => {
  cy.log('Deleting current filter');
  DatabaseFilterSelectors.deleteFilterButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Close the filter menu by pressing Escape
 */
export const closeFilterMenu = () => {
  cy.get('body').type('{esc}');
  waitForReactUpdate(300);
};

// ============== SORT HELPERS ==============

/**
 * Create a sort by clicking the sort button and selecting a field.
 */
export const createSort = (fieldName: string) => {
  cy.log(`Creating sort for field: ${fieldName}`);

  // Click sort button to show field picker
  DatabaseFilterSelectors.sortButton().click({ force: true });
  waitForReactUpdate(500);

  // Select the field from the picker
  cy.get('.appflowy-scroller')
    .contains(fieldName)
    .click({ force: true });
  waitForReactUpdate(800);
};

/**
 * Add another sort when sorts already exist
 */
export const addAnotherSort = (fieldName: string) => {
  cy.log(`Adding another sort for field: ${fieldName}`);

  // Click the sort condition to open the menu
  DatabaseFilterSelectors.sortCondition().click({ force: true });
  waitForReactUpdate(500);

  // Click the add sort button
  DatabaseFilterSelectors.addSortButton().click({ force: true });
  waitForReactUpdate(500);

  // Select the field from the picker
  cy.get('.appflowy-scroller')
    .contains(fieldName)
    .click({ force: true });
  waitForReactUpdate(800);
};

/**
 * Open the sort menu by clicking on the sort condition pill
 */
export const openSortMenu = () => {
  cy.log('Opening sort menu');
  DatabaseFilterSelectors.sortCondition().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Change the sort direction to ascending
 */
export const setSortAscending = () => {
  cy.log('Setting sort to ascending');
  DatabaseFilterSelectors.sortConditionButton().click({ force: true });
  waitForReactUpdate(300);
  DatabaseFilterSelectors.sortConditionAsc().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Change the sort direction to descending
 */
export const setSortDescending = () => {
  cy.log('Setting sort to descending');
  DatabaseFilterSelectors.sortConditionButton().click({ force: true });
  waitForReactUpdate(300);
  DatabaseFilterSelectors.sortConditionDesc().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Delete the current sort by clicking the delete button
 */
export const deleteCurrentSort = () => {
  cy.log('Deleting current sort');
  DatabaseFilterSelectors.deleteSortButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Delete all sorts
 */
export const deleteAllSorts = () => {
  cy.log('Deleting all sorts');
  // Open sort menu first
  DatabaseFilterSelectors.sortCondition().click({ force: true });
  waitForReactUpdate(300);
  DatabaseFilterSelectors.deleteAllSortsButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Close the sort menu by pressing Escape
 */
export const closeSortMenu = () => {
  cy.get('body').type('{esc}');
  waitForReactUpdate(300);
};

// ============== ASSERTION HELPERS ==============

/**
 * Assert the number of visible data rows in the grid
 */
export const assertRowCount = (expectedCount: number) => {
  cy.log(`Asserting row count: ${expectedCount}`);
  DatabaseGridSelectors.dataRows().should('have.length', expectedCount);
};

/**
 * Assert that a filter condition pill is visible
 */
export const assertFilterExists = () => {
  DatabaseFilterSelectors.filterCondition().should('exist').and('be.visible');
};

/**
 * Assert that no filter condition pills are visible
 */
export const assertNoFilters = () => {
  DatabaseFilterSelectors.filterCondition().should('not.exist');
};

/**
 * Assert that a sort condition pill is visible
 */
export const assertSortExists = () => {
  DatabaseFilterSelectors.sortCondition().should('exist').and('be.visible');
};

/**
 * Assert that no sort condition pills are visible
 */
export const assertNoSorts = () => {
  DatabaseFilterSelectors.sortCondition().should('not.exist');
};

/**
 * Get the text content of cells in a column and return as array
 */
export const getCellValues = (fieldId: string): Cypress.Chainable<string[]> => {
  return getCellsForField(fieldId).then(($cells) => {
    const values: string[] = [];
    $cells.each((_i, el) => values.push((el.textContent || '').trim()));
    return values;
  });
};

/**
 * Assert that the rows are sorted in a specific order based on primary column text
 */
export const assertRowOrder = (expectedOrder: string[]) => {
  cy.log(`Asserting row order: ${expectedOrder.join(', ')}`);

  // Get the primary column (first field) values
  GridFieldSelectors.allFieldHeaders()
    .first()
    .invoke('attr', 'data-testid')
    .then((testId) => {
      const fieldId = testId?.replace('grid-field-header-', '') || '';
      getCellsForField(fieldId).then(($cells) => {
        const actualValues: string[] = [];
        $cells.each((_i, el) => actualValues.push((el.textContent || '').trim()));

        expectedOrder.forEach((expected, index) => {
          expect(actualValues[index]).to.include(expected);
        });
      });
    });
};
