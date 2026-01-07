/**
 * Sort test helpers for database E2E tests
 * Provides utilities for creating, managing, and verifying sorts
 */
import 'cypress-real-events';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  waitForReactUpdate,
} from './selectors';

/**
 * Sort direction enum
 */
export enum SortDirection {
  Ascending = 'asc',
  Descending = 'desc',
}

/**
 * Sort selectors
 */
export const SortSelectors = {
  // Sort button in database actions toolbar
  sortButton: () => cy.get('[data-testid="database-actions-sort"]'),

  // Sort condition chip (shown when sorts are active)
  sortCondition: () => cy.get('[data-testid="database-sort-condition"]'),

  // Individual sort item in the sort menu
  sortItem: () => cy.get('[data-testid="sort-condition"]'),

  // Add sort button in sort menu
  addSortButton: () => cy.contains('button', /add.*sort/i),

  // Delete all sorts button
  deleteAllSortsButton: () => cy.contains('button', /delete.*all.*sort/i),

  // Sort direction toggle button (inside sort item)
  sortDirectionButton: () => cy.get('[data-testid="sort-direction-toggle"]'),

  // Sort field name text
  sortFieldName: () => cy.get('[data-testid="sort-field-name"]'),

  // Delete individual sort button
  deleteSortButton: () => cy.get('[data-testid="delete-sort-button"]'),
};

/**
 * Common beforeEach setup for sort tests
 */
export const setupSortTest = () => {
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
 * Click the sort button to open the sort menu or add first sort
 * If no sorts exist, this opens the field selection popover
 * If sorts exist, this toggles the sort panel
 */
export const clickSortButton = (): void => {
  SortSelectors.sortButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Add a sort on a field by name
 * Opens the sort menu, searches for the field, and selects it
 */
export const addSortByFieldName = (fieldName: string): void => {
  // Check if sorts already exist
  cy.get('body').then(($body) => {
    const hasSorts = $body.find('[data-testid="database-sort-condition"]').length > 0;

    if (hasSorts) {
      // Click the existing sort condition to open menu
      SortSelectors.sortCondition().first().click({ force: true });
      waitForReactUpdate(500);

      // Click add sort button
      SortSelectors.addSortButton().click({ force: true });
      waitForReactUpdate(500);
    } else {
      // Click sort button to open field selection
      SortSelectors.sortButton().click({ force: true });
      waitForReactUpdate(500);
    }
  });

  // Find and click the field by name
  DatabaseFilterSelectors.propertyItemByName(fieldName).click({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Open the sort menu by clicking on the sort condition chip
 */
export const openSortMenu = (): void => {
  SortSelectors.sortCondition().first().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Toggle sort direction (ascending/descending)
 * @param sortIndex - Index of the sort to toggle (0-based)
 */
export const toggleSortDirection = (sortIndex: number = 0): void => {
  // Find the sort item and click its direction toggle button
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('[data-testid="sort-condition"]')
    .eq(sortIndex)
    .find('button')
    .then(($buttons) => {
      // Find the button that shows Ascending or Descending
      const conditionButton = $buttons.filter((_, el) => {
        const text = el.textContent?.toLowerCase() || '';
        return text.includes('ascending') || text.includes('descending');
      });

      if (conditionButton.length > 0) {
        const currentText = conditionButton.first().text().toLowerCase();
        cy.wrap(conditionButton.first()).click({ force: true });
        waitForReactUpdate(500);

        // Select the OPPOSITE direction
        const targetText = currentText.includes('ascending') ? 'descending' : 'ascending';
        cy.get('[data-radix-popper-content-wrapper]')
          .last()
          .find('[role="menuitem"]')
          .filter((_, el) => el.textContent?.toLowerCase().includes(targetText))
          .first()
          .click({ force: true });
        waitForReactUpdate(500);
      }
    });
};

/**
 * Change sort direction for a specific sort
 * @param sortIndex - Index of the sort (0-based)
 * @param direction - Target direction
 */
export const changeSortDirection = (sortIndex: number, direction: SortDirection): void => {
  // Open the direction dropdown for the specified sort
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('[data-testid="sort-condition"]')
    .eq(sortIndex)
    .find('button')
    .filter((_, el) => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('ascending') || text.includes('descending');
    })
    .first()
    .click({ force: true });
  waitForReactUpdate(500);

  // Select the target direction
  const targetText = direction === SortDirection.Ascending ? 'ascending' : 'descending';
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('[role="menuitem"]')
    .filter((_, el) => el.textContent?.toLowerCase().includes(targetText))
    .first()
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Delete a specific sort by index
 * @param sortIndex - Index of the sort to delete (0-based)
 */
export const deleteSort = (sortIndex: number = 0): void => {
  // Find the sort item and click its delete button (last button in the sort row)
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('[data-testid="sort-condition"]')
    .eq(sortIndex)
    .find('button')
    .last()  // Delete button is the last button
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Delete all sorts
 */
export const deleteAllSorts = (): void => {
  SortSelectors.deleteAllSortsButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Assert the row order based on cell text content in primary field
 * @param primaryFieldId - The field ID of the primary column
 * @param expectedOrder - Array of expected text values in order
 */
export const assertRowOrder = (primaryFieldId: string, expectedOrder: string[]): void => {
  DatabaseGridSelectors.dataRowCellsForField(primaryFieldId).each(($cell, index) => {
    if (index < expectedOrder.length) {
      cy.wrap($cell).should('contain.text', expectedOrder[index]);
    }
  });
};

/**
 * Get all cell values from a column in order
 * @param fieldId - The field ID
 * @returns Array of cell text values
 */
export const getCellValuesInOrder = (fieldId: string): Cypress.Chainable<string[]> => {
  const values: string[] = [];
  return DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .each(($cell) => {
      values.push($cell.text().trim());
    })
    .then(() => values);
};

/**
 * Assert that a specific number of sorts are applied
 * @param count - Expected number of sorts
 */
export const assertSortCount = (count: number): void => {
  if (count === 0) {
    SortSelectors.sortCondition().should('not.exist');
  } else {
    // Open sort menu and count items
    openSortMenu();
    cy.get('[data-radix-popper-content-wrapper]')
      .last()
      .find('[data-testid="sort-condition"]')
      .should('have.length', count);
  }
};

/**
 * Reorder sorts by dragging
 * Note: This may need adjustment based on actual drag implementation
 * @param fromIndex - Source sort index
 * @param toIndex - Target sort index
 */
export const reorderSort = (fromIndex: number, toIndex: number): void => {
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('[data-testid="sort-condition"]')
    .eq(fromIndex)
    .find('[data-testid="sort-drag-handle"], .drag-handle')
    .first()
    .trigger('mousedown', { button: 0 })
    .trigger('mousemove', { clientY: 100 * (toIndex - fromIndex) });

  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('[data-testid="sort-condition"]')
    .eq(toIndex)
    .trigger('mousemove')
    .trigger('mouseup');

  waitForReactUpdate(500);
};

/**
 * Close the sort menu by pressing Escape
 */
export const closeSortMenu = (): void => {
  cy.get('body').type('{esc}');
  waitForReactUpdate(300);
};
