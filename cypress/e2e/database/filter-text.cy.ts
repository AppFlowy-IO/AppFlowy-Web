/**
 * Text Filter Tests
 * Migrated from desktop: grid_text_filter_test.dart
 *
 * Desktop test data (v020GridFileName):
 * - 10 rows total
 * - Name column: A, B, C, D, E, (empty), (empty), (empty), (empty), (empty)
 * - 5 rows with names (A-E), 5 rows with empty names
 *
 * Tests text field filtering with all conditions:
 * - TextIs, TextIsNot, TextContains, TextDoesNotContain
 * - TextStartsWith, TextEndsWith, TextIsEmpty, TextIsNotEmpty
 */
import {
  setupFilterTest,
  loginAndCreateGrid,
  addFilterByFieldName,
  clickFilterChip,
  changeFilterCondition,
  deleteFilter,
  assertRowCount,
  getPrimaryFieldId,
  TextFilterCondition,
  generateRandomEmail,
} from '../../support/filter-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  RowControlsSelectors,
  waitForReactUpdate,
} from '../../support/selectors';

/**
 * Setup test data matching desktop v020 database:
 * Names: A, B, C, D, E, and 5 empty rows (10 total)
 */
const setupV020TestData = (primaryFieldId: string) => {
  // First, add 7 more rows (default grid has 3 rows, we need 10 total)
  for (let i = 0; i < 7; i++) {
    DatabaseGridSelectors.dataRows().last().scrollIntoView();
    RowControlsSelectors.rowAccessoryButton().last().click({ force: true });
    waitForReactUpdate(300);
    RowControlsSelectors.rowMenuInsertBelow().click({ force: true });
    waitForReactUpdate(500);
  }

  // Now type text into the first 5 rows (rows 6-10 stay empty)
  const names = ['A', 'B', 'C', 'D', 'E'];

  names.forEach((name, index) => {
    DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
      .eq(index)
      .should('be.visible')
      .scrollIntoView()
      .click()
      .click();

    cy.get('textarea:visible', { timeout: 8000 })
      .should('exist')
      .first()
      .clear()
      .type(name, { delay: 30 });
    cy.get('body').type('{esc}');
    cy.wait(300);
  });
};

describe('Database Text Filter Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupFilterTest();
  });

  it('text filter - TextIs condition', () => {
    // Desktop test: grid_text_filter_test.dart:14-31
    // Expected: Filter for "A" with TextIs should show 1 row
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    getPrimaryFieldId().then((fieldId) => {
      setupV020TestData(fieldId);
    });

    // Verify we have 10 rows like v020
    assertRowCount(10);

    // Add filter on Name field
    addFilterByFieldName('Name');

    // Change condition to TextIs
    changeFilterCondition(TextFilterCondition.TextIs);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('A', { delay: 30 });
    waitForReactUpdate(500);

    // Should only show the row with exactly "A"
    assertRowCount(1);
  });

  it('text filter - TextIsNot condition', () => {
    // Desktop test: grid_text_filter_test.dart:33-48
    // Expected: Filter for "A" with TextIsNot should show 9 rows
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    getPrimaryFieldId().then((fieldId) => {
      setupV020TestData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Name');
    changeFilterCondition(TextFilterCondition.TextIsNot);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('A', { delay: 30 });
    waitForReactUpdate(500);

    // Should show all rows except the one with "A" (9 rows)
    assertRowCount(9);
  });

  it('text filter - TextContains condition (default)', () => {
    // Desktop test: grid_text_filter_test.dart:50-64
    // Expected: Filter for "A" with TextContains should show 1 row
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    getPrimaryFieldId().then((fieldId) => {
      setupV020TestData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Name');
    // Default condition is TextContains
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('A', { delay: 30 });
    waitForReactUpdate(500);

    // Should show row with "A" (case-sensitive)
    assertRowCount(1);
  });

  it('text filter - TextDoesNotContain condition', () => {
    // Desktop test: grid_text_filter_test.dart:66-82
    // Expected: Filter for "A" with TextDoesNotContain should show 9 rows
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    getPrimaryFieldId().then((fieldId) => {
      setupV020TestData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Name');
    changeFilterCondition(TextFilterCondition.TextDoesNotContain);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('A', { delay: 30 });
    waitForReactUpdate(500);

    // Should show all rows that don't contain "A" (9 rows)
    assertRowCount(9);
  });

  it('text filter - TextStartsWith condition', () => {
    // Desktop test: grid_text_filter_test.dart:84-99
    // Expected: Filter for "A" with TextStartsWith should show 1 row
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    getPrimaryFieldId().then((fieldId) => {
      setupV020TestData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Name');
    changeFilterCondition(TextFilterCondition.TextStartsWith);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('A', { delay: 30 });
    waitForReactUpdate(500);

    // Should show rows starting with "A"
    assertRowCount(1);
  });

  it('text filter - TextEndsWith condition', () => {
    // Desktop test: grid_text_filter_test.dart:101-116
    // Expected: Filter for "A" with TextEndsWith should show 1 row
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    getPrimaryFieldId().then((fieldId) => {
      setupV020TestData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Name');
    changeFilterCondition(TextFilterCondition.TextEndsWith);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('A', { delay: 30 });
    waitForReactUpdate(500);

    // Should show rows ending with "A"
    assertRowCount(1);
  });

  it('text filter - TextIsEmpty condition', () => {
    // Desktop test: grid_text_filter_test.dart:118-131
    // Expected: TextIsEmpty should show 5 rows (empty name rows)
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    getPrimaryFieldId().then((fieldId) => {
      setupV020TestData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Name');
    changeFilterCondition(TextFilterCondition.TextIsEmpty);

    // Should show rows with empty Name field (5 rows in test database)
    assertRowCount(5);
  });

  it('text filter - TextIsNotEmpty condition', () => {
    // Desktop test: grid_text_filter_test.dart:133-147
    // Expected: TextIsNotEmpty should show 5 rows (A, B, C, D, E)
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    getPrimaryFieldId().then((fieldId) => {
      setupV020TestData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Name');
    changeFilterCondition(TextFilterCondition.TextIsNotEmpty);

    // Should show rows with non-empty Name field (5 rows: A, B, C, D, E)
    assertRowCount(5);
  });

  it('text filter - delete filter restores all rows', () => {
    // Desktop test: grid_text_filter_test.dart:149-171
    // Expected: After deleting filter, all 10 rows should be visible
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    getPrimaryFieldId().then((fieldId) => {
      setupV020TestData(fieldId);
    });

    // Verify initial row count
    assertRowCount(10);

    addFilterByFieldName('Name');
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('A', { delay: 30 });
    waitForReactUpdate(500);
    assertRowCount(1);

    // Delete the filter
    clickFilterChip();
    deleteFilter();

    // All rows should be visible again
    assertRowCount(10);
  });

  it('text filter - change condition dynamically', () => {
    // Desktop test: grid_text_filter_test.dart:173-194
    // Tests changing filter condition on the fly
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    getPrimaryFieldId().then((fieldId) => {
      setupV020TestData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Name');

    // Start with TextContains
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('A', { delay: 30 });
    waitForReactUpdate(500);
    assertRowCount(1);

    // Change to TextIsEmpty (content should be ignored)
    clickFilterChip();
    waitForReactUpdate(300);
    changeFilterCondition(TextFilterCondition.TextIsEmpty);
    assertRowCount(5);

    // Change to TextIsNotEmpty
    clickFilterChip();
    waitForReactUpdate(300);
    changeFilterCondition(TextFilterCondition.TextIsNotEmpty);
    assertRowCount(5);
  });
});
