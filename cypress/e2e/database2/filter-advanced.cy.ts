/**
 * Database Advanced Filter Tests (Desktop Parity)
 *
 * Tests for advanced filter functionality.
 * Mirrors tests from: database_filter_advanced_test.dart
 *
 * Test organization:
 * 1. Normal Mode UI (inline chips)
 * 2. Advanced Mode UI (filter panel)
 * 3. AND/OR Operator Logic
 */
import 'cypress-real-events';
import {
  loginAndCreateGrid,
  setupFilterTest,
  typeTextIntoCell,
  getPrimaryFieldId,
  addFilterByFieldName,
  clickFilterChip,
  assertRowCount,
  navigateAwayAndBack,
  CheckboxFilterCondition,
  changeCheckboxFilterCondition,
  SelectFilterCondition,
  selectFilterOption,
  changeSelectFilterCondition,
} from '../../support/filter-test-helpers';
import { addFieldWithType, toggleCheckbox, FieldType } from '../../support/field-type-helpers';
import { DatabaseFilterSelectors, DatabaseGridSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Click the "more options" button (three dots) in filter menu
 */
const clickFilterMoreOptions = (): void => {
  DatabaseFilterSelectors.filterMoreOptionsButton().should('be.visible').click({ force: true });
  waitForReactUpdate(300);
};

/**
 * Click "Add to advanced filter" option in the more options menu
 */
const clickAddToAdvancedFilter = (): void => {
  cy.contains('[data-slot="dropdown-menu-item"]', /add to advanced filter/i)
    .should('be.visible')
    .click({ force: true });
  // Wait longer for Yjs changes to propagate and React to re-render
  waitForReactUpdate(2000);
};

/**
 * Click "Delete filter" option in the more options menu
 */
const clickDeleteFilterInMoreOptions = (): void => {
  cy.contains('[data-slot="dropdown-menu-item"]', /delete filter/i)
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Open the advanced filter panel by clicking the badge
 */
const openAdvancedFilterPanel = (): void => {
  DatabaseFilterSelectors.advancedFiltersBadge().should('be.visible').click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Get the count of filter rows in the advanced filter panel
 */
const getFilterRowCountInPanel = (): Cypress.Chainable<number> => {
  // Filter rows have a data-testid attribute
  return cy
    .get('[data-radix-popper-content-wrapper]')
    .last()
    .find('[data-testid="advanced-filter-row"]')
    .then(($rows) => $rows.length);
};

/**
 * Delete a filter in the panel by clicking its delete button (trash icon)
 */
const deleteFilterInPanelByIndex = (index: number): void => {
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('[data-testid="delete-advanced-filter-button"]')
    .eq(index)
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Click "Delete filter" button to delete all filters
 */
const deleteAllFilters = (): void => {
  cy.contains('button', /delete filter/i)
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Change the filter operator (And/Or) in the panel
 */
const changeFilterOperator = (operator: 'And' | 'Or'): void => {
  // Find the And/Or dropdown button (not the first row which has "Where")
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('[data-testid="advanced-filter-row"]')
    .eq(1) // Second row has the And/Or toggle
    .find('button')
    .filter((_, el) => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('and') || text.includes('or');
    })
    .first()
    .click({ force: true });
  waitForReactUpdate(300);

  // Select the operator
  cy.contains('[data-slot="dropdown-menu-item"]', new RegExp(`^${operator}$`, 'i'))
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Assert the filter badge text
 */
const assertFilterBadgeText = (expectedText: string): void => {
  DatabaseFilterSelectors.advancedFiltersBadge().should('contain.text', expectedText);
};

/**
 * Assert that inline filter chips are visible (normal mode)
 */
const assertInlineFiltersVisible = (count: number): void => {
  if (count === 0) {
    DatabaseFilterSelectors.filterCondition().should('not.exist');
  } else {
    DatabaseFilterSelectors.filterCondition().should('have.length', count);
  }
};

describe('Database Advanced Filter Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupFilterTest();
  });

  // =========================================================================
  // SECTION 1: Normal Mode UI Tests
  // =========================================================================

  describe('Normal Mode UI:', () => {
    it('filter displays as inline chip in normal mode', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add a Checkbox field
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          // Get the checkbox field ID
          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              // Enter names
              typeTextIntoCell(primaryFieldId, 0, 'Task One');
              typeTextIntoCell(primaryFieldId, 1, 'Task Two');
              typeTextIntoCell(primaryFieldId, 2, 'Task Three');
              waitForReactUpdate(500);

              // Check the first row
              toggleCheckbox(checkboxFieldId, 0);
              waitForReactUpdate(500);

              // Verify initial row count
              assertRowCount(3);

              // Add a filter - should show as inline chip (normal mode)
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);

              // Change condition to "Is Checked"
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);

              // Close the filter popover
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // Verify filter is applied (1 checked row)
              assertRowCount(1);

              // In normal mode, inline filter chip should be visible
              assertInlineFiltersVisible(1);

              // Advanced filters badge should NOT be visible
              DatabaseFilterSelectors.advancedFiltersBadge().should('not.exist');
            });
        });
      });
    });

    it('disclosure button shows delete and add to advanced options', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add a Checkbox field
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          // Enter names
          typeTextIntoCell(primaryFieldId, 0, 'Task One');
          waitForReactUpdate(500);

          // Add a filter
          addFilterByFieldName('Checkbox');
          waitForReactUpdate(500);

          // Tap the filter chip to open its editor
          clickFilterChip();
          waitForReactUpdate(500);

          // Find and tap the more options button (...)
          clickFilterMoreOptions();

          // Verify both options are visible
          cy.contains('[data-slot="dropdown-menu-item"]', /delete filter/i).should('be.visible');
          cy.contains('[data-slot="dropdown-menu-item"]', /add to advanced filter/i).should('be.visible');
        });
      });
    });

    it('transition from normal to advanced mode', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add Checkbox field
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          // Enter data
          typeTextIntoCell(primaryFieldId, 0, 'Task One');
          typeTextIntoCell(primaryFieldId, 1, 'Task Two');
          typeTextIntoCell(primaryFieldId, 2, 'Task Three');
          waitForReactUpdate(500);

          // Add first filter (Name)
          addFilterByFieldName('Name');
          waitForReactUpdate(500);
          cy.get('body').type('{esc}');
          waitForReactUpdate(500);

          // Add second filter (Checkbox)
          DatabaseFilterSelectors.addFilterButton().click({ force: true });
          waitForReactUpdate(500);
          DatabaseFilterSelectors.propertyItemByName('Checkbox').click({ force: true });
          waitForReactUpdate(1000);

          // Verify normal mode (inline chips visible)
          assertInlineFiltersVisible(2);

          // Now click on the filter chip to open the menu
          clickFilterChip();
          waitForReactUpdate(500);

          // Click the more options button
          clickFilterMoreOptions();

          // Click "Add to advanced filter"
          clickAddToAdvancedFilter();
          waitForReactUpdate(1000);

          // Verify advanced mode - badge should be visible
          DatabaseFilterSelectors.advancedFiltersBadge().should('exist').should('be.visible');

          // Verify inline chips are gone
          assertInlineFiltersVisible(0);

          // Verify badge text
          assertFilterBadgeText('2 rules');
        });
      });
    });
  });

  // =========================================================================
  // SECTION 2: Advanced Mode UI Tests
  // =========================================================================

  describe('Advanced Mode UI:', () => {
    it('filter panel shows all active filters', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add fields
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);
          addFieldWithType(FieldType.Number);
          waitForReactUpdate(1000);

          // Enter data
          typeTextIntoCell(primaryFieldId, 0, 'Task One');
          waitForReactUpdate(500);

          // Add 3 filters (Name/text, Checkbox, Number)
          addFilterByFieldName('Name');
          waitForReactUpdate(500);
          cy.get('body').type('{esc}');
          waitForReactUpdate(300);

          DatabaseFilterSelectors.addFilterButton().click({ force: true });
          waitForReactUpdate(500);
          DatabaseFilterSelectors.propertyItemByName('Checkbox').click({ force: true });
          waitForReactUpdate(500);
          cy.get('body').type('{esc}');
          waitForReactUpdate(300);

          DatabaseFilterSelectors.addFilterButton().click({ force: true });
          waitForReactUpdate(500);
          DatabaseFilterSelectors.propertyItemByName('Number').click({ force: true });
          waitForReactUpdate(500);

          // Convert to advanced mode
          clickFilterMoreOptions();
          clickAddToAdvancedFilter();

          // Open filter panel
          openAdvancedFilterPanel();

          // Verify all 3 filters are shown
          getFilterRowCountInPanel().should('eq', 3);
        });
      });
    });

    it('delete filters one by one from panel', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add Checkbox field
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          // Get the checkbox field ID and check a row
          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              typeTextIntoCell(primaryFieldId, 0, 'Task One');
              typeTextIntoCell(primaryFieldId, 1, 'Task Two');
              typeTextIntoCell(primaryFieldId, 2, 'Task Three');
              waitForReactUpdate(500);

              toggleCheckbox(checkboxFieldId, 0);
              waitForReactUpdate(500);

              assertRowCount(3);

              // Add 2 filters
              addFilterByFieldName('Name');
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Checkbox').click({ force: true });
              waitForReactUpdate(500);

              // Convert to advanced mode
              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              openAdvancedFilterPanel();
              getFilterRowCountInPanel().should('eq', 2);

              // Delete first filter
              deleteFilterInPanelByIndex(0);

              // Verify 1 filter row remains
              getFilterRowCountInPanel().should('eq', 1);

              // Delete remaining filter
              deleteFilterInPanelByIndex(0);

              // Close panel
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // All rows should be back
              assertRowCount(3);
            });
        });
      });
    });

    it('delete all filters button clears all filters', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add Checkbox field
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              typeTextIntoCell(primaryFieldId, 0, 'Task One');
              typeTextIntoCell(primaryFieldId, 1, 'Task Two');
              typeTextIntoCell(primaryFieldId, 2, 'Task Three');
              waitForReactUpdate(500);

              toggleCheckbox(checkboxFieldId, 0);
              toggleCheckbox(checkboxFieldId, 2);
              waitForReactUpdate(500);

              assertRowCount(3);

              // Add 2 filters
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              // Verify filtered to 2 rows (checked)
              assertRowCount(2);

              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Name').click({ force: true });
              waitForReactUpdate(500);

              // Convert to advanced mode
              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              openAdvancedFilterPanel();
              getFilterRowCountInPanel().should('eq', 2);

              // Delete all filters
              deleteAllFilters();

              // All 3 rows should be back
              assertRowCount(3);

              // No filter chips or badge should be visible
              assertInlineFiltersVisible(0);
              DatabaseFilterSelectors.advancedFiltersBadge().should('not.exist');
            });
        });
      });
    });
  });

  // =========================================================================
  // SECTION 3: AND/OR Operator Logic Tests
  // =========================================================================

  describe('AND/OR Operator Logic:', () => {
    it('AND operator combines filters with intersection logic', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add Checkbox field
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              // Enter data
              typeTextIntoCell(primaryFieldId, 0, 'Apple');
              typeTextIntoCell(primaryFieldId, 1, 'Banana');
              typeTextIntoCell(primaryFieldId, 2, 'Cherry');
              waitForReactUpdate(500);

              // Check first two rows
              toggleCheckbox(checkboxFieldId, 0);
              toggleCheckbox(checkboxFieldId, 1);
              waitForReactUpdate(500);

              assertRowCount(3);

              // Add Checkbox filter (is checked) - should show 2 rows
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              assertRowCount(2);

              // Add Name filter (contains "Apple")
              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Name').click({ force: true });
              waitForReactUpdate(500);

              // Type "Apple" in filter input
              cy.get('[data-testid="text-filter-input"]').clear().type('Apple', { delay: 30 });
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // With AND (default), only "Apple" row should be visible (checked AND contains Apple)
              assertRowCount(1);
              DatabaseGridSelectors.dataRowCellsForField(primaryFieldId).should('contain.text', 'Apple');
            });
        });
      });
    });

    it('OR operator combines filters with union logic', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add Checkbox field
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              // Enter data
              typeTextIntoCell(primaryFieldId, 0, 'Apple');
              typeTextIntoCell(primaryFieldId, 1, 'Banana');
              typeTextIntoCell(primaryFieldId, 2, 'Cherry');
              waitForReactUpdate(500);

              // Check only first row
              toggleCheckbox(checkboxFieldId, 0);
              waitForReactUpdate(500);

              assertRowCount(3);

              // Add Checkbox filter (is checked)
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              // Add Name filter (contains "Cherry")
              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Name').click({ force: true });
              waitForReactUpdate(500);

              cy.get('[data-testid="text-filter-input"]').clear().type('Cherry', { delay: 30 });
              waitForReactUpdate(500);

              // Convert to advanced mode
              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              // With AND, should show 0 rows (checked=Apple, contains Cherry - no intersection)
              assertRowCount(0);

              // Switch to OR
              openAdvancedFilterPanel();
              changeFilterOperator('Or');

              // Close panel
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // With OR, should show 2 rows (Apple is checked OR Cherry contains "Cherry")
              assertRowCount(2);
              DatabaseGridSelectors.dataRowCellsForField(primaryFieldId).should('contain.text', 'Apple');
              DatabaseGridSelectors.dataRowCellsForField(primaryFieldId).should('contain.text', 'Cherry');
            });
        });
      });
    });

    it('toggle AND to OR to AND maintains correct logic', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add Checkbox field
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              typeTextIntoCell(primaryFieldId, 0, 'Alpha');
              typeTextIntoCell(primaryFieldId, 1, 'Beta');
              typeTextIntoCell(primaryFieldId, 2, 'Gamma');
              waitForReactUpdate(500);

              toggleCheckbox(checkboxFieldId, 0);
              waitForReactUpdate(500);

              // Add 2 filters
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Name').click({ force: true });
              waitForReactUpdate(500);

              cy.get('[data-testid="text-filter-input"]').clear().type('Gamma', { delay: 30 });
              waitForReactUpdate(500);

              // Convert to advanced mode
              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              // AND: 0 rows (Alpha is checked, but "Gamma" is not)
              assertRowCount(0);

              // Switch to OR
              openAdvancedFilterPanel();
              changeFilterOperator('Or');
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // OR: 2 rows (Alpha checked OR Gamma contains "Gamma")
              assertRowCount(2);

              // Switch back to AND
              openAdvancedFilterPanel();
              changeFilterOperator('And');
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // AND again: 0 rows
              assertRowCount(0);
            });
        });
      });
    });

    it('AND is the default operator for multiple filters', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add Checkbox field
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              typeTextIntoCell(primaryFieldId, 0, 'Task A');
              typeTextIntoCell(primaryFieldId, 1, 'Task B');
              typeTextIntoCell(primaryFieldId, 2, 'Task C');
              waitForReactUpdate(500);

              toggleCheckbox(checkboxFieldId, 0);
              toggleCheckbox(checkboxFieldId, 1);
              waitForReactUpdate(500);

              assertRowCount(3);

              // Add first filter
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              // 2 checked rows
              assertRowCount(2);

              // Add second filter
              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Name').click({ force: true });
              waitForReactUpdate(500);

              cy.get('[data-testid="text-filter-input"]').clear().type('Task A', { delay: 30 });
              waitForReactUpdate(500);

              // Convert to advanced mode
              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              // With default AND, should be 1 row (checked AND contains "Task A")
              assertRowCount(1);

              // Open panel and verify AND operator is shown
              openAdvancedFilterPanel();
              cy.get('[data-radix-popper-content-wrapper]').last().should('contain.text', 'And');
            });
        });
      });
    });

    it('row count updates immediately after operator change', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              typeTextIntoCell(primaryFieldId, 0, 'Item X');
              typeTextIntoCell(primaryFieldId, 1, 'Item Y');
              typeTextIntoCell(primaryFieldId, 2, 'Item Z');
              waitForReactUpdate(500);

              toggleCheckbox(checkboxFieldId, 0);
              waitForReactUpdate(500);

              // Add 2 filters
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Name').click({ force: true });
              waitForReactUpdate(500);

              cy.get('[data-testid="text-filter-input"]').clear().type('Item Z', { delay: 30 });
              waitForReactUpdate(500);

              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              // AND: 0 rows
              assertRowCount(0);

              // Toggle to OR
              openAdvancedFilterPanel();
              changeFilterOperator('Or');
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              // OR: 2 rows
              assertRowCount(2);

              // Toggle back to AND
              openAdvancedFilterPanel();
              changeFilterOperator('And');
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              // AND: 0 rows again
              assertRowCount(0);

              // Toggle to OR again
              openAdvancedFilterPanel();
              changeFilterOperator('Or');
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              // OR: 2 rows again
              assertRowCount(2);
            });
        });
      });
    });

    it('delete filter maintains operator state', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);
          addFieldWithType(FieldType.Number);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .eq(1) // Checkbox field (second column)
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              typeTextIntoCell(primaryFieldId, 0, 'Row 1');
              typeTextIntoCell(primaryFieldId, 1, 'Row 2');
              typeTextIntoCell(primaryFieldId, 2, 'Row 3');
              waitForReactUpdate(500);

              toggleCheckbox(checkboxFieldId, 0);
              waitForReactUpdate(500);

              // Add 3 filters
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Name').click({ force: true });
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Number').click({ force: true });
              waitForReactUpdate(500);

              // Convert to advanced mode
              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              // Change to OR operator
              openAdvancedFilterPanel();
              changeFilterOperator('Or');
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // Verify badge shows 3 rules
              assertFilterBadgeText('3 rules');

              // Delete one filter
              openAdvancedFilterPanel();
              deleteFilterInPanelByIndex(1); // Delete the middle filter

              // Verify 2 filters remain
              getFilterRowCountInPanel().should('eq', 2);

              // Verify operator is still OR (check the panel still shows "Or")
              cy.get('[data-radix-popper-content-wrapper]').last().should('contain.text', 'Or');

              // Close panel
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // Verify badge shows 2 rules
              assertFilterBadgeText('2 rules');
            });
        });
      });
    });
  });

  // =========================================================================
  // SECTION 4: Persistence Tests
  // =========================================================================

  describe('Persistence Tests:', () => {
    it('advanced filter persists after close and reopen', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              typeTextIntoCell(primaryFieldId, 0, 'Persist One');
              typeTextIntoCell(primaryFieldId, 1, 'Persist Two');
              typeTextIntoCell(primaryFieldId, 2, 'Persist Three');
              waitForReactUpdate(500);

              toggleCheckbox(checkboxFieldId, 0);
              toggleCheckbox(checkboxFieldId, 2);
              waitForReactUpdate(500);

              assertRowCount(3);

              // Add 2 filters and convert to advanced mode
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Name').click({ force: true });
              waitForReactUpdate(500);

              cy.get('[data-testid="text-filter-input"]').clear().type('Persist One', { delay: 30 });
              waitForReactUpdate(500);

              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              // With AND: should show 1 row (checked AND contains "Persist One")
              assertRowCount(1);

              // Verify advanced badge exists
              DatabaseFilterSelectors.advancedFiltersBadge().should('exist');
              assertFilterBadgeText('2 rules');

              // Navigate away and back
              navigateAwayAndBack();

              // Verify filter is still applied (1 row)
              assertRowCount(1);

              // Verify advanced badge still exists
              DatabaseFilterSelectors.advancedFiltersBadge().should('exist');
              assertFilterBadgeText('2 rules');

              // Open panel and verify both filters are still there
              openAdvancedFilterPanel();
              getFilterRowCountInPanel().should('eq', 2);
            });
        });
      });
    });

    it('OR operator persists after close and reopen', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              typeTextIntoCell(primaryFieldId, 0, 'OR Test One');
              typeTextIntoCell(primaryFieldId, 1, 'OR Test Two');
              typeTextIntoCell(primaryFieldId, 2, 'OR Test Three');
              waitForReactUpdate(500);

              toggleCheckbox(checkboxFieldId, 0);
              waitForReactUpdate(500);

              assertRowCount(3);

              // Add 2 filters
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Name').click({ force: true });
              waitForReactUpdate(500);

              cy.get('[data-testid="text-filter-input"]').clear().type('OR Test Three', { delay: 30 });
              waitForReactUpdate(500);

              // Convert to advanced mode
              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              // With AND: 0 rows (checked AND contains "OR Test Three" - no match)
              assertRowCount(0);

              // Change to OR
              openAdvancedFilterPanel();
              changeFilterOperator('Or');
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // With OR: 2 rows (checked OR contains "OR Test Three")
              assertRowCount(2);

              // Navigate away and back
              navigateAwayAndBack();

              // Verify OR filter still works (2 rows)
              assertRowCount(2);

              // Verify advanced badge exists
              DatabaseFilterSelectors.advancedFiltersBadge().should('exist');

              // Open panel and verify OR operator is still set
              openAdvancedFilterPanel();
              cy.get('[data-radix-popper-content-wrapper]').last().should('contain.text', 'Or');
            });
        });
      });
    });
  });

  // =========================================================================
  // SECTION 5: Combined Filter Tests (v069 Comprehensive Parity)
  // =========================================================================

  describe('Combined Filter Tests:', () => {
    /**
     * Create a select option in the current cell/popover
     * NOTE: This variant waits for [data-testid="select-option-menu"] unlike the shared helper.
     */
    const createSelectOption = (optionName: string): void => {
      // Wait for the select option menu to appear
      cy.get('[data-testid="select-option-menu"]', { timeout: 15000 })
        .should('be.visible')
        .find('input')
        .first()
        .clear()
        .type(`${optionName}{enter}`, { delay: 30 });
      waitForReactUpdate(500);
    };

    /**
     * Click on a single select cell to open the options popover
     * This mimics the approach from filter-select.cy.ts which passes
     */
    const clickSelectCell = (fieldId: string, rowIndex: number): void => {
      // Simple approach: click the cell and wait for the popover
      DatabaseGridSelectors.dataRowCellsForField(fieldId)
        .eq(rowIndex)
        .scrollIntoView()
        .click({ force: true });
      waitForReactUpdate(1000);

      // Wait for the select option menu popover to appear
      cy.get('[data-testid="select-option-menu"]', { timeout: 15000 }).should('be.visible');
    };

    /**
     * Select an existing option from the dropdown
     */
    const selectExistingOption = (optionName: string): void => {
      // Wait for the select option menu to appear
      cy.get('[data-testid="select-option-menu"]', { timeout: 15000 })
        .should('be.visible')
        .contains(optionName)
        .click({ force: true });
      waitForReactUpdate(500);
    };

    it('checkbox AND single select combined filter', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add Checkbox field first, then SingleSelect
          addFieldWithType(FieldType.Checkbox).then((checkboxFieldId) => {
            waitForReactUpdate(1000);

            addFieldWithType(FieldType.SingleSelect).then((selectFieldId) => {
              waitForReactUpdate(1500); // Extra wait for cells to render

              // Set up data:
              // Row 1: checked, High priority
              // Row 2: unchecked, High priority
              // Row 3: checked, Low priority
              typeTextIntoCell(primaryFieldId, 0, 'Checked High');
              typeTextIntoCell(primaryFieldId, 1, 'Unchecked High');
              typeTextIntoCell(primaryFieldId, 2, 'Checked Low');
              waitForReactUpdate(500);

              toggleCheckbox(checkboxFieldId, 0);
              toggleCheckbox(checkboxFieldId, 2);
              waitForReactUpdate(500);

              clickSelectCell(selectFieldId, 0);
              createSelectOption('High');
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              clickSelectCell(selectFieldId, 1);
              selectExistingOption('High');
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              clickSelectCell(selectFieldId, 2);
              createSelectOption('Low');
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              assertRowCount(3);

              // Add Checkbox filter (is checked)
              addFilterByFieldName('Checkbox');
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              // Add Select filter (option is High)
              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Select').click({ force: true });
              waitForReactUpdate(500);
              changeSelectFilterCondition(SelectFilterCondition.OptionIs);
              waitForReactUpdate(500);
              selectFilterOption('High');
              waitForReactUpdate(500);

              // Convert to advanced mode
              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              // With AND: Only "Checked High" matches (checked AND High priority)
              assertRowCount(1);
              DatabaseGridSelectors.dataRowCellsForField(primaryFieldId).should('contain.text', 'Checked High');

              // Change to OR
              openAdvancedFilterPanel();
              changeFilterOperator('Or');
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // With OR: "Checked High", "Unchecked High", "Checked Low" (2 checked OR 2 High)
              // = Checked High, Unchecked High, Checked Low = 3 rows
              assertRowCount(3);
            });
          });
        });
      });
    });

    it('three filters combined with AND/OR', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add Checkbox field first, then SingleSelect
          addFieldWithType(FieldType.Checkbox).then((checkboxFieldId) => {
            waitForReactUpdate(1000);

            addFieldWithType(FieldType.SingleSelect).then((selectFieldId) => {
              waitForReactUpdate(1500); // Extra wait for cells to render

              // Set up data:
              // Row 1: "Alpha", checked, Status: Active
              // Row 2: "Beta", unchecked, Status: Active
              // Row 3: "Gamma", checked, Status: Inactive
              typeTextIntoCell(primaryFieldId, 0, 'Alpha');
              typeTextIntoCell(primaryFieldId, 1, 'Beta');
              typeTextIntoCell(primaryFieldId, 2, 'Gamma');
              waitForReactUpdate(500);

              toggleCheckbox(checkboxFieldId, 0);
              toggleCheckbox(checkboxFieldId, 2);
              waitForReactUpdate(500);

              clickSelectCell(selectFieldId, 0);
              createSelectOption('Active');
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              clickSelectCell(selectFieldId, 1);
              selectExistingOption('Active');
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              clickSelectCell(selectFieldId, 2);
              createSelectOption('Inactive');
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              assertRowCount(3);

              // Filter 1: Name contains "Alpha"
              addFilterByFieldName('Name');
              waitForReactUpdate(500);
              cy.get('[data-testid="text-filter-input"]').clear().type('Alpha', { delay: 30 });
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              // Filter 2: Checkbox is checked
              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Checkbox').click({ force: true });
              waitForReactUpdate(500);
              changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
              waitForReactUpdate(500);
              cy.get('body').type('{esc}');
              waitForReactUpdate(300);

              // Filter 3: Select option is Active
              DatabaseFilterSelectors.addFilterButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Select').click({ force: true });
              waitForReactUpdate(500);
              changeSelectFilterCondition(SelectFilterCondition.OptionIs);
              waitForReactUpdate(500);
              selectFilterOption('Active');
              waitForReactUpdate(500);

              // Convert to advanced mode
              clickFilterMoreOptions();
              clickAddToAdvancedFilter();

              // Verify 3 filters in panel
              openAdvancedFilterPanel();
              getFilterRowCountInPanel().should('eq', 3);

              // With AND: Only "Alpha" matches all 3 conditions
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);
              assertRowCount(1);
              DatabaseGridSelectors.dataRowCellsForField(primaryFieldId).should('contain.text', 'Alpha');

              // Change to OR
              openAdvancedFilterPanel();
              changeFilterOperator('Or');
              cy.get('body').type('{esc}');
              waitForReactUpdate(500);

              // With OR: All 3 rows match at least one condition
              // Alpha: matches all
              // Beta: matches "Active" condition
              // Gamma: matches "checked" condition
              assertRowCount(3);
            });
          });
        });
      });
    });
  });
});
