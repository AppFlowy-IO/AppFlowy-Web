/**
 * Filter test helpers for database E2E tests
 * Provides utilities for creating, managing, and verifying filters
 */
import 'cypress-real-events';
import { AuthTestUtils } from './auth-utils';
import {
  AddPageSelectors,
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  waitForReactUpdate,
} from './selectors';
import { generateRandomEmail } from './test-config';

// Re-export for convenience
export { generateRandomEmail };

/**
 * Text filter condition enum values (matching TextFilterCondition)
 */
export enum TextFilterCondition {
  TextIs = 0,
  TextIsNot = 1,
  TextContains = 2,
  TextDoesNotContain = 3,
  TextStartsWith = 4,
  TextEndsWith = 5,
  TextIsEmpty = 6,
  TextIsNotEmpty = 7,
}

/**
 * Number filter condition enum values (matching NumberFilterCondition)
 */
export enum NumberFilterCondition {
  Equal = 0,
  NotEqual = 1,
  GreaterThan = 2,
  LessThan = 3,
  GreaterThanOrEqualTo = 4,
  LessThanOrEqualTo = 5,
  NumberIsEmpty = 6,
  NumberIsNotEmpty = 7,
}

/**
 * Checkbox filter condition enum values (matching CheckboxFilterCondition)
 */
export enum CheckboxFilterCondition {
  IsChecked = 0,
  IsUnchecked = 1,
}

/**
 * Common beforeEach setup for filter tests
 */
export const setupFilterTest = () => {
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
 * Login and create a new grid for filter testing
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
 * Type text into a cell at the specified index
 * NOTE: Uses Enter to save the value, not Escape.
 * This is important because NumberCell only saves on Enter/blur, not on Escape.
 */
export const typeTextIntoCell = (fieldId: string, cellIndex: number, text: string): void => {
  cy.log(`typeTextIntoCell: field=${fieldId}, dataRowIndex=${cellIndex}, text=${text}`);

  // Click to enter edit mode
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
 * Open the filter menu by clicking the filter button
 * If filters already exist, this toggles the filter panel
 */
export const openFilterMenu = (): void => {
  DatabaseFilterSelectors.filterButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Add a filter on a field by name
 * Opens the filter menu, searches for the field, and selects it
 */
export const addFilterByFieldName = (fieldName: string): void => {
  // Click add filter button if visible, otherwise the filter button opens a popover
  cy.get('body').then(($body) => {
    if ($body.find('[data-testid="database-add-filter-button"]:visible').length > 0) {
      DatabaseFilterSelectors.addFilterButton().click({ force: true });
    } else {
      // Filter button opens the properties popover directly when no filters exist
      DatabaseFilterSelectors.filterButton().click({ force: true });
    }
  });
  waitForReactUpdate(800);

  // Search for the field and click it
  DatabaseFilterSelectors.propertyItemByName(fieldName).click({ force: true });
  waitForReactUpdate(1000);

  // Wait for the filter panel to be visible (it auto-expands after adding a filter)
  cy.get('.database-conditions', { timeout: 10000 }).should('have.css', 'visibility', 'visible');
};

/**
 * Click on the active filter chip to open its menu
 */
export const clickFilterChip = (): void => {
  DatabaseFilterSelectors.filterCondition().first().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Change the filter condition by selecting from the dropdown
 */
export const changeFilterCondition = (conditionValue: number): void => {
  // The filter menu should already be open
  // Find the condition dropdown trigger button inside the filter popover
  // Use case-insensitive matching since button text may be capitalized
  cy.get('[data-radix-popper-content-wrapper]')
    .last() // Get the most recently opened popover
    .find('button')
    .then(($buttons) => {
      // Find button containing condition-related text (case-insensitive)
      // Include all possible condition texts: text filters, number filters, etc.
      const conditionTexts = [
        'is',
        'contains',
        'starts',
        'ends',
        'empty',
        'equals', // number filter
        'not equal', // number filter
        'greater',
        'less',
        '=',
        '>',
        '<',
      ];
      const $conditionButton = $buttons.filter((_, el) => {
        const text = el.textContent?.toLowerCase() || '';
        return conditionTexts.some((t) => text.includes(t));
      });
      if ($conditionButton.length > 0) {
        cy.wrap($conditionButton.first()).click({ force: true });
      }
    });
  waitForReactUpdate(500);

  // The dropdown menu items are rendered in a portal, find them
  cy.get(`[data-testid="filter-condition-${conditionValue}"]`, { timeout: 10000 })
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Change the checkbox filter condition ("Is checked" / "Is unchecked")
 */
export const changeCheckboxFilterCondition = (
  condition: CheckboxFilterCondition
): void => {
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('button')
    .filter((_, el) => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('checked') || text.includes('unchecked');
    })
    .first()
    .click({ force: true });
  waitForReactUpdate(500);

  cy.get(`[data-testid="filter-condition-${condition}"]`, { timeout: 10000 })
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Enter text into the filter input
 */
export const enterFilterText = (text: string): void => {
  DatabaseFilterSelectors.filterInput().clear().type(text, { delay: 30 });
  waitForReactUpdate(500);
};

/**
 * Delete the current filter
 * Handles both normal mode (filter chip menu) and advanced mode (filter panel)
 */
export const deleteFilter = (): void => {
  cy.get('body').then(($body) => {
    // Check if we're in advanced mode (has advanced filters badge or panel)
    const hasAdvancedBadge = $body.find('[data-testid="advanced-filters-badge"]').length > 0;
    const hasAdvancedPanel = $body.find('[data-testid="advanced-filter-row"]').length > 0;

    if (hasAdvancedBadge || hasAdvancedPanel) {
      // Advanced mode: open the panel if needed and delete from there
      if (!hasAdvancedPanel) {
        cy.get('[data-testid="advanced-filters-badge"]').click({ force: true });
        waitForReactUpdate(500);
      }

      // Click the delete button in the advanced filter panel
      cy.get('[data-testid="delete-advanced-filter-button"]').first().click({ force: true });
      waitForReactUpdate(500);
    } else {
      // Normal mode: use the filter chip menu
      // First, ensure the filter popover is open
      const hasFilterPopover = $body.find('[data-radix-popper-content-wrapper]').length > 0;

      if (!hasFilterPopover) {
        // Filter menu not open, click the filter chip to open it
        DatabaseFilterSelectors.filterCondition().first().click({ force: true });
        waitForReactUpdate(500);
      }

      // Check if delete button is directly visible (e.g., DateTimeFilterMenu)
      // or if we need to open the "more options" dropdown first
      cy.get('body').then(($body2) => {
        const hasDirectDeleteButton = $body2.find('[data-testid="delete-filter-button"]:visible').length > 0;

        if (hasDirectDeleteButton) {
          // Delete button is directly visible (DateTimeFilterMenu)
          DatabaseFilterSelectors.deleteFilterButton().click({ force: true });
          waitForReactUpdate(500);
        } else {
          // Need to open the "more options" dropdown first
          cy.get('[data-testid="filter-more-options-button"]').click({ force: true });
          waitForReactUpdate(300);
          // Now click the delete button in the dropdown
          cy.get('[data-testid="delete-filter-button"]').click({ force: true });
          waitForReactUpdate(500);
        }
      });
    }
  });
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
      return testId?.replace('grid-field-header-', '') || '';
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
      return testId?.replace('grid-field-header-', '') || '';
    });
};

/**
 * Select filter condition enum values (matching SelectOptionFilterCondition)
 */
export enum SelectFilterCondition {
  OptionIs = 0,
  OptionIsNot = 1,
  OptionContains = 2,
  OptionDoesNotContain = 3,
  OptionIsEmpty = 4,
  OptionIsNotEmpty = 5,
}

/**
 * Create a select option in the current cell/popover
 */
export const createSelectOption = (optionName: string): void => {
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('input')
    .first()
    .clear()
    .type(`${optionName}{enter}`, { delay: 30 });
  waitForReactUpdate(500);
};

/**
 * Click on a select cell to open the options popover
 */
export const clickSelectCell = (fieldId: string, rowIndex: number): void => {
  DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .eq(rowIndex)
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Select an existing option from the dropdown
 */
export const selectExistingOption = (optionName: string): void => {
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .contains(optionName)
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Select an option in the filter popover
 */
export const selectFilterOption = (optionName: string): void => {
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('[role="option"], [data-testid^="select-option-"]')
    .filter((_, el) => el.textContent?.includes(optionName))
    .first()
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Change the select filter condition
 */
export const changeSelectFilterCondition = (condition: SelectFilterCondition): void => {
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('button')
    .filter((_, el) => {
      const text = el.textContent?.toLowerCase() || '';
      return (
        text.includes('is') ||
        text.includes('contains') ||
        text.includes('empty')
      );
    })
    .first()
    .click({ force: true });
  waitForReactUpdate(500);

  cy.get(`[data-testid="filter-condition-${condition}"]`, { timeout: 10000 })
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Navigate away from the current page and then back to test persistence
 * This simulates closing and reopening the database view
 */
export const navigateAwayAndBack = (): void => {
  // Store the current URL
  cy.url().then((currentUrl) => {
    // Navigate to the app root (away from database)
    cy.visit('/app', { failOnStatusCode: false });
    waitForReactUpdate(2000);

    // Navigate back to the database
    cy.visit(currentUrl, { failOnStatusCode: false });
    waitForReactUpdate(3000);

    // Wait for the grid to load
    DatabaseGridSelectors.grid().should('exist');
    DatabaseGridSelectors.cells().should('have.length.greaterThan', 0);
  });
};
