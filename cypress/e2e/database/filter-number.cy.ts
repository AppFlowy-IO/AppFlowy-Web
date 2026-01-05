/**
 * Number Filter Tests
 * Migrated from desktop: grid_number_filter_test.dart
 *
 * Desktop test data (v020GridFileName):
 * - 10 rows total
 * - Number column: -1, -2, 0.1, 0.2, 1, 2, 10, 11, 12, (empty)
 * - 9 rows with numbers, 1 row empty
 *
 * Tests number field filtering with all conditions:
 * - Equal, NotEqual, GreaterThan, LessThan
 * - GreaterThanOrEqualTo, LessThanOrEqualTo
 * - NumberIsEmpty, NumberIsNotEmpty
 */
import {
  setupFilterTest,
  loginAndCreateGrid,
  addFilterByFieldName,
  clickFilterChip,
  changeFilterCondition,
  deleteFilter,
  assertRowCount,
  NumberFilterCondition,
  generateRandomEmail,
} from '../../support/filter-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  PropertyMenuSelectors,
  GridFieldSelectors,
  RowControlsSelectors,
  waitForReactUpdate,
  FieldType,
} from '../../support/selectors';

/**
 * Add a Number field and return its ID
 */
const addNumberField = (): Cypress.Chainable<string> => {
  PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
  waitForReactUpdate(1200);
  PropertyMenuSelectors.propertyTypeTrigger().first().realHover();
  waitForReactUpdate(600);
  PropertyMenuSelectors.propertyTypeOption(FieldType.Number).scrollIntoView().click({ force: true });
  waitForReactUpdate(800);
  cy.get('body').type('{esc}');
  waitForReactUpdate(500);

  return GridFieldSelectors.allFieldHeaders()
    .last()
    .invoke('attr', 'data-testid')
    .then((testId) => testId?.replace('grid-field-header-', '') || '');
};

/**
 * Type a number into a cell
 */
const typeNumberIntoCell = (fieldId: string, cellIndex: number, value: string): void => {
  DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .eq(cellIndex)
    .should('be.visible')
    .scrollIntoView()
    .click()
    .click();

  // Type the value and press Enter to save (Escape doesn't save in number cells)
  cy.get('input:visible, textarea:visible', { timeout: 8000 })
    .should('exist')
    .first()
    .clear()
    .type(`${value}{enter}`, { delay: 30 });
  cy.wait(500);
};

/**
 * Add more rows to the grid
 */
const addRows = (count: number): void => {
  for (let i = 0; i < count; i++) {
    DatabaseGridSelectors.dataRows().last().scrollIntoView();
    RowControlsSelectors.rowAccessoryButton().last().click({ force: true });
    waitForReactUpdate(300);
    RowControlsSelectors.rowMenuInsertBelow().click({ force: true });
    waitForReactUpdate(500);
  }
};

/**
 * Setup test data matching desktop v020 database:
 * Numbers: -1, -2, 0.1, 0.2, 1, 2, 10, 11, 12, (empty) - 10 rows
 */
const setupV020NumberData = (numberFieldId: string) => {
  const numbers = ['-1', '-2', '0.1', '0.2', '1', '2', '10', '11', '12'];

  // Add 7 more rows (default grid has 3 rows, we need 10)
  addRows(7);

  // Type numbers into the first 9 rows (row 10 stays empty)
  numbers.forEach((num, index) => {
    typeNumberIntoCell(numberFieldId, index, num);
  });
  // Row 10 (index 9) remains empty
};

describe('Database Number Filter Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupFilterTest();
  });

  it('number filter - Equal condition', () => {
    // Desktop test: grid_number_filter_test.dart:17-31
    // Expected: Filter for 1 with Equal should show 1 row
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    // Default condition is Equal
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('1', { delay: 30 });
    waitForReactUpdate(500);

    // Should show row with exactly 1
    assertRowCount(1);
  });

  it('number filter - NotEqual condition', () => {
    // Desktop test: grid_number_filter_test.dart:33-48
    // Expected: Filter for 1 with NotEqual should show 8 rows (not 1, not empty)
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    changeFilterCondition(NumberFilterCondition.NotEqual);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('1', { delay: 30 });
    waitForReactUpdate(500);

    // Should show all rows except the one with 1 (8 rows - excludes 1 and empty)
    assertRowCount(8);
  });

  it('number filter - GreaterThan condition', () => {
    // Desktop test: grid_number_filter_test.dart:50-65
    // Expected: Filter for >1 should show 4 rows (2, 10, 11, 12)
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    changeFilterCondition(NumberFilterCondition.GreaterThan);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('1', { delay: 30 });
    waitForReactUpdate(500);

    // Should show rows > 1: 2, 10, 11, 12 (4 rows)
    assertRowCount(4);
  });

  it('number filter - LessThan condition', () => {
    // Desktop test: grid_number_filter_test.dart:67-82
    // Expected: Filter for <1 should show 4 rows (-2, -1, 0.1, 0.2)
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    changeFilterCondition(NumberFilterCondition.LessThan);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('1', { delay: 30 });
    waitForReactUpdate(500);

    // Should show rows < 1: -2, -1, 0.1, 0.2 (4 rows)
    assertRowCount(4);
  });

  it('number filter - GreaterThanOrEqualTo condition', () => {
    // Desktop test: grid_number_filter_test.dart:84-101
    // Expected: Filter for >=1 should show 5 rows (1, 2, 10, 11, 12)
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    changeFilterCondition(NumberFilterCondition.GreaterThanOrEqualTo);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('1', { delay: 30 });
    waitForReactUpdate(500);

    // Should show rows >= 1: 1, 2, 10, 11, 12 (5 rows)
    assertRowCount(5);
  });

  it('number filter - LessThanOrEqualTo condition', () => {
    // Desktop test: grid_number_filter_test.dart:103-119
    // Expected: Filter for <=1 should show 5 rows (-2, -1, 0.1, 0.2, 1)
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    changeFilterCondition(NumberFilterCondition.LessThanOrEqualTo);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('1', { delay: 30 });
    waitForReactUpdate(500);

    // Should show rows <= 1: -2, -1, 0.1, 0.2, 1 (5 rows)
    assertRowCount(5);
  });

  it('number filter - NumberIsEmpty condition', () => {
    // Desktop test: grid_number_filter_test.dart:121-135
    // Expected: NumberIsEmpty should show 1 row
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    changeFilterCondition(NumberFilterCondition.NumberIsEmpty);

    // Should show rows with empty number (1 row in test database)
    assertRowCount(1);
  });

  it('number filter - NumberIsNotEmpty condition', () => {
    // Desktop test: grid_number_filter_test.dart:137-152
    // Expected: NumberIsNotEmpty should show 9 rows
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    changeFilterCondition(NumberFilterCondition.NumberIsNotEmpty);

    // Should show rows with non-empty number (9 rows)
    assertRowCount(9);
  });

  it('number filter - negative numbers', () => {
    // Desktop test: grid_number_filter_test.dart:154-169
    // Expected: Filter for <0 should show 2 rows (-1, -2)
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    changeFilterCondition(NumberFilterCondition.LessThan);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('0', { delay: 30 });
    waitForReactUpdate(500);

    // Should show negative numbers: -2, -1 (2 rows)
    assertRowCount(2);
  });

  it('number filter - decimal numbers', () => {
    // Desktop test: grid_number_filter_test.dart:171-187
    // Expected: Filter for <1 should show 4 rows (0.1, 0.2, -1, -2)
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    changeFilterCondition(NumberFilterCondition.LessThan);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('1', { delay: 30 });
    waitForReactUpdate(500);

    // Should show 0.1, 0.2, -1, -2 (4 rows with values < 1, not including empty)
    assertRowCount(4);
  });

  it('number filter - delete filter restores all rows', () => {
    // Desktop test: grid_number_filter_test.dart:189-214
    // Expected: After deleting filter, all 10 rows should be visible
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    addFilterByFieldName('Numbers');
    changeFilterCondition(NumberFilterCondition.GreaterThan);
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('100', { delay: 30 });
    waitForReactUpdate(500);

    // No rows match > 100
    assertRowCount(0);

    // Delete the filter
    clickFilterChip();
    deleteFilter();

    // All rows should be visible again
    assertRowCount(10);
  });

  it('number filter - change condition dynamically', () => {
    // Desktop test: grid_number_filter_test.dart:216-239
    // Tests changing filter condition on the fly
    const testEmail = generateRandomEmail();
    loginAndCreateGrid(testEmail);

    addNumberField().then((fieldId) => {
      setupV020NumberData(fieldId);
    });

    assertRowCount(10);

    // Add filter with Equal
    addFilterByFieldName('Numbers');
    DatabaseFilterSelectors.filterInput().should('be.visible').clear().type('1', { delay: 30 });
    waitForReactUpdate(500);
    assertRowCount(1);

    // Change to GreaterThan
    clickFilterChip();
    waitForReactUpdate(300);
    changeFilterCondition(NumberFilterCondition.GreaterThan);
    // Value is still 1, so should show 2, 10, 11, 12 (4 rows)
    assertRowCount(4);

    // Change to NumberIsEmpty (content should be ignored)
    clickFilterChip();
    waitForReactUpdate(300);
    changeFilterCondition(NumberFilterCondition.NumberIsEmpty);
    assertRowCount(1);
  });
});
