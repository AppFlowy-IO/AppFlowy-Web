/**
 * Filter and Sort Combined Operations Tests
 *
 * These tests verify that filter and sort operations work correctly together,
 * mirroring the desktop Flutter integration tests from grid_filter_and_sort_test.dart.
 *
 * Data Structure (mirrors v020.afdb):
 * - Grid with Name (text) and Number fields
 * - 3 rows with values: Name (A, B, C) and Number (30, 10, 20)
 *
 * Focus: Single-grid operations with text/number fields to ensure stability.
 */
import { FieldType, waitForReactUpdate, DatabaseFilterSelectors, DatabaseGridSelectors } from '../../support/selectors';
import {
  generateRandomEmail,
  setupFilterSortTest,
  loginAndCreateGrid,
  addNewProperty,
  typeTextIntoCell,
  getLastFieldId,
  getFieldIdByName,
  getCellsForField,
  assertFilterExists,
  assertNoFilters,
  assertSortExists,
  assertNoSorts,
  assertRowCount,
} from '../../support/filter-sort-helpers';

/**
 * Helper to create a text filter with "Contains" condition (default)
 */
const createTextFilter = (fieldName: string, filterValue?: string) => {
  cy.log(`Creating text filter for field: ${fieldName}`);
  DatabaseFilterSelectors.filterButton().click({ force: true });
  waitForReactUpdate(500);

  cy.get('.appflowy-scroller')
    .contains(fieldName)
    .click({ force: true });
  waitForReactUpdate(800);

  if (filterValue) {
    DatabaseFilterSelectors.filterInput()
      .should('be.visible')
      .clear()
      .type(filterValue, { delay: 30 });
    waitForReactUpdate(500);
  }
};

/**
 * Helper to create a sort on a field
 */
const createFieldSort = (fieldName: string) => {
  cy.log(`Creating sort for field: ${fieldName}`);
  DatabaseFilterSelectors.sortButton().click({ force: true });
  waitForReactUpdate(500);

  cy.get('.appflowy-scroller')
    .contains(fieldName)
    .click({ force: true });
  waitForReactUpdate(800);
};

/**
 * Helper to open an existing filter's menu
 */
const openExistingFilter = () => {
  DatabaseFilterSelectors.filterCondition().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Helper to delete the current filter
 */
const deleteFilter = () => {
  DatabaseFilterSelectors.deleteFilterButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Helper to open the sort menu
 */
const openSortMenu = () => {
  DatabaseFilterSelectors.sortCondition().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Helper to delete the current sort
 */
const deleteSort = () => {
  DatabaseFilterSelectors.deleteSortButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Close any open popover
 */
const closePopover = () => {
  cy.get('body').type('{esc}');
  waitForReactUpdate(300);
};

/**
 * Helper to set up test data matching v020 fixture pattern:
 * - Name field: A, B, C
 * - Number field: values passed as parameter
 */
const setupTestData = (numberValues: string[]) => {
  // Get the Name field ID (first/primary field)
  getFieldIdByName('Name').as('nameFieldId');

  // Add a Number field
  addNewProperty(FieldType.Number);
  getLastFieldId().as('numberFieldId');

  // Fill in the Name column with A, B, C (like v020 fixture)
  cy.get<string>('@nameFieldId').then((nameFieldId) => {
    typeTextIntoCell(nameFieldId, 0, 'A');
    typeTextIntoCell(nameFieldId, 1, 'B');
    typeTextIntoCell(nameFieldId, 2, 'C');
  });

  // Fill in the Number column
  cy.get<string>('@numberFieldId').then((numberFieldId) => {
    numberValues.forEach((value, index) => {
      typeTextIntoCell(numberFieldId, index, value);
    });
  });

  // Wait for all values to be saved
  waitForReactUpdate(1000);
};

/**
 * Helper to get cell values for a field with retry support
 */
const verifyCellValues = (fieldId: string, expectedValues: string[]) => {
  // Use retrying assertion to wait for values
  getCellsForField(fieldId).should(($cells) => {
    const values: string[] = [];
    $cells.each((_i, el) => values.push((el.textContent || '').trim()));
    expect(values.length).to.be.at.least(expectedValues.length);
    expectedValues.forEach((expected, i) => {
      expect(values[i], `Cell at index ${i}`).to.equal(expected);
    });
  });
};

/**
 * Helper to verify the first cell value (most common case for sort verification)
 */
const verifyFirstCellValue = (fieldId: string, expectedValue: string) => {
  getCellsForField(fieldId).first().should(($cell) => {
    const value = ($cell.text() || '').trim();
    expect(value).to.equal(expectedValue);
  });
};

describe('Filter and Sort Combined Operations', () => {
  beforeEach(() => {
    setupFilterSortTest();
  });

  describe('Sequential filter and sort operations', () => {
    /**
     * Test: delete sort with active filter
     * Desktop equivalent: grid_filter_and_sort_test.dart - "delete sort with active filter"
     *
     * Creates a filter, then a sort, then deletes the sort.
     * Verifies the filter remains active after sort deletion.
     */
    it('should delete sort while filter remains active', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Set up test data matching v020 fixture
      setupTestData(['30', '10', '20']);

      // Create a text filter on the Name column - filter for names containing "A" or "B" or "C"
      // Use empty filter value to match all (or use a common character)
      createTextFilter('Name', 'A');
      closePopover();

      // Verify filter exists
      assertFilterExists();

      // Create a sort on the Number field
      createFieldSort('Number');
      closePopover();

      // Verify sort exists
      assertSortExists();

      // Delete the sort
      openSortMenu();
      deleteSort();

      // Verify sort is gone but filter remains
      assertNoSorts();
      assertFilterExists();
    });

    /**
     * Test: delete filter with active sort
     * Desktop equivalent: grid_filter_and_sort_test.dart - "delete filter with active sort"
     */
    it('should delete filter while sort remains active', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Set up test data
      setupTestData(['30', '10', '20']);

      // Create sort first
      createFieldSort('Number');
      closePopover();
      assertSortExists();

      // Create filter - use a filter that matches at least one row
      createTextFilter('Name', 'A');
      closePopover();
      assertFilterExists();

      // Delete the filter
      openExistingFilter();
      deleteFilter();

      // Verify filter is gone but sort remains
      assertNoFilters();
      assertSortExists();
    });

    /**
     * Test: apply filter then sort
     * Desktop equivalent: grid_filter_and_sort_test.dart - "apply filter then sort"
     *
     * First applies a filter, then adds a sort.
     * Verifies both remain active and row count is unchanged.
     */
    it('should apply filter first then add sort', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Set up test data
      setupTestData(['100', '50', '75']);

      // Create a text filter on Name - match all rows by using empty string (Contains is default)
      // Or use a character that appears in all names
      createTextFilter('Name'); // Empty filter matches all
      closePopover();

      // All 3 rows should still be visible
      assertRowCount(3);
      assertFilterExists();

      // Now add a sort on Number
      createFieldSort('Number');
      closePopover();

      // Both filter and sort should be active
      assertFilterExists();
      assertSortExists();

      // Row count should still be 3 (filter unchanged by adding sort)
      assertRowCount(3);
    });

    /**
     * Test: apply sort then filter
     * Desktop equivalent: grid_filter_and_sort_test.dart - "apply sort then filter"
     */
    it('should apply sort first then add filter', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Set up test data
      setupTestData(['30', '10', '20']);

      // Create sort first
      createFieldSort('Number');
      waitForReactUpdate(1000);

      // Verify ascending order (default): 10, 20, 30
      cy.get<string>('@numberFieldId').then((fieldId) => {
        verifyFirstCellValue(fieldId, '10');
      });

      closePopover();
      assertSortExists();

      // Now add a text filter - empty filter keeps all rows
      createTextFilter('Name');
      closePopover();

      // All rows should still be visible
      assertRowCount(3);

      // Both should be active
      assertFilterExists();
      assertSortExists();
    });
  });

  describe('Modifying conditions', () => {
    /**
     * Test: filter with sort maintains row count
     * Desktop equivalent: grid_filter_and_sort_test.dart - "filter with sort maintains row count"
     */
    it('should maintain row count when adding sort to filtered view', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Set up test data
      setupTestData(['100', '25', '50']);

      // Create filter on Name - empty filter keeps all
      createTextFilter('Name');
      closePopover();

      // Should show all 3 rows
      assertRowCount(3);

      // Add sort - should not change row count
      createFieldSort('Number');
      closePopover();

      assertRowCount(3);
    });

    /**
     * Test: change sort direction with active filter
     * Desktop equivalent: grid_filter_and_sort_test.dart - "change sort direction with active filter"
     */
    it('should change sort direction without affecting filter', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Set up test data
      setupTestData(['30', '10', '20']);

      // Create filter - empty filter keeps all rows
      createTextFilter('Name');
      closePopover();

      assertRowCount(3);

      // Create sort ascending
      createFieldSort('Number');
      waitForReactUpdate(1000);

      // Verify ascending order
      cy.get<string>('@numberFieldId').then((fieldId) => {
        verifyFirstCellValue(fieldId, '10');
      });

      // Change to descending - first open the sort menu
      openSortMenu();
      waitForReactUpdate(500);

      // Now click the sort condition button to access the direction options
      DatabaseFilterSelectors.sortConditionButton().click({ force: true });
      waitForReactUpdate(300);
      DatabaseFilterSelectors.sortConditionDesc().click({ force: true });
      waitForReactUpdate(1000);

      // Verify descending order
      cy.get<string>('@numberFieldId').then((fieldId) => {
        verifyFirstCellValue(fieldId, '30');
      });

      closePopover();

      // Filter should still be active
      assertFilterExists();
      assertRowCount(3);
    });
  });

  describe('Combined filter and sort verification', () => {
    /**
     * Test: verify sorted order with filter active
     * Desktop equivalent: grid_filter_and_sort_test.dart - "text filter with number sort"
     */
    it('should correctly sort numbers in ascending order with filter active', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Set up test data
      setupTestData(['30', '10', '20']);

      // Create filter first - empty filter keeps all
      createTextFilter('Name');
      closePopover();

      // Create sort
      createFieldSort('Number');
      waitForReactUpdate(1000);

      // Verify sorted order: 10, 20, 30
      cy.get<string>('@numberFieldId').then((fieldId) => {
        verifyCellValues(fieldId, ['10', '20', '30']);
      });

      closePopover();

      assertFilterExists();
      assertSortExists();
    });

    /**
     * Test: verify descending sort with filter active
     */
    it('should correctly sort numbers in descending order with filter active', () => {
      const testEmail = generateRandomEmail();
      loginAndCreateGrid(testEmail);

      // Set up test data
      setupTestData(['30', '10', '20']);

      // Create filter - empty filter keeps all
      createTextFilter('Name');
      closePopover();

      assertRowCount(3);

      // Create sort
      createFieldSort('Number');
      waitForReactUpdate(1000);

      // Change to descending - first open the sort menu
      openSortMenu();
      waitForReactUpdate(500);

      DatabaseFilterSelectors.sortConditionButton().click({ force: true });
      waitForReactUpdate(300);
      DatabaseFilterSelectors.sortConditionDesc().click({ force: true });
      waitForReactUpdate(1000);

      // Verify descending order: 30, 20, 10
      cy.get<string>('@numberFieldId').then((fieldId) => {
        verifyCellValues(fieldId, ['30', '20', '10']);
      });

      closePopover();

      assertFilterExists();
      assertSortExists();
    });
  });
});
