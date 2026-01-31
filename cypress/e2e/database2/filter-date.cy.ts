/**
 * Database Date Filter Tests (Desktop Parity)
 *
 * Tests for date/datetime field filtering.
 * Mirrors tests from: database_filter_test.dart (date filter section)
 */
import 'cypress-real-events';
import {
  loginAndCreateGrid,
  setupFilterTest,
  typeTextIntoCell,
  getPrimaryFieldId,
  addFilterByFieldName,
  clickFilterChip,
  deleteFilter,
  assertRowCount,
} from '../../support/filter-test-helpers';
import {
  addFieldWithType,
  FieldType,
} from '../../support/field-type-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Date filter condition enum values (matching DateFilterCondition)
 */
enum DateFilterCondition {
  DateIs = 0,
  DateBefore = 1,
  DateAfter = 2,
  DateOnOrBefore = 3,
  DateOnOrAfter = 4,
  DateWithin = 5,
  DateIsEmpty = 6,
  DateIsNotEmpty = 7,
}

/**
 * Click on a date cell to open the date picker
 */
const clickDateCell = (fieldId: string, rowIndex: number): void => {
  DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .eq(rowIndex)
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Select a date in the date picker by day number
 */
const selectDateByDay = (day: number): void => {
  // Find the calendar (react-day-picker) and click on the specified day
  // Look in the last popover content wrapper (the calendar popover)
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('button')
    .filter((_, el) => {
      const text = el.textContent?.trim();
      // Match day number exactly, excluding outside month days (they have day-outside class)
      return text === String(day) && !el.classList.contains('day-outside');
    })
    .first()
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Navigate to a specific month in the date picker
 */
const navigateToMonth = (monthsForward: number): void => {
  for (let i = 0; i < Math.abs(monthsForward); i++) {
    if (monthsForward > 0) {
      cy.get('.react-datepicker__navigation--next').click({ force: true });
    } else {
      cy.get('.react-datepicker__navigation--previous').click({ force: true });
    }
    waitForReactUpdate(200);
  }
};

/**
 * Change the date filter condition
 */
const changeDateFilterCondition = (condition: DateFilterCondition): void => {
  // Click the condition dropdown trigger
  cy.get('[data-testid="filter-condition-trigger"]', { timeout: 10000 })
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);

  // Select the target condition
  cy.get(`[data-testid="filter-condition-${condition}"]`, { timeout: 10000 })
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Set a date in the filter date picker
 */
const setFilterDate = (day: number): void => {
  // Click the date picker trigger button
  cy.get('[data-testid="date-filter-date-picker"]', { timeout: 10000 })
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);

  // Select the day from the calendar
  selectDateByDay(day);
};

describe('Database Date Filter Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupFilterTest();
  });

  it('filter by date is on specific date', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a DateTime field
        addFieldWithType(FieldType.DateTime);
        waitForReactUpdate(1000);

        // Get the date field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const dateFieldId = testId?.replace('grid-field-header-', '') || '';

            // Grid starts with 3 default rows, no need to add more

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Event on 15th');
            typeTextIntoCell(primaryFieldId, 1, 'Event on 20th');
            typeTextIntoCell(primaryFieldId, 2, 'Event on 15th too');
            waitForReactUpdate(500);

            // Set dates - first row: 15th
            clickDateCell(dateFieldId, 0);
            selectDateByDay(15);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Second row: 20th
            clickDateCell(dateFieldId, 1);
            selectDateByDay(20);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Third row: also 15th
            clickDateCell(dateFieldId, 2);
            selectDateByDay(15);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on DateTime field
            addFilterByFieldName('Date');
            waitForReactUpdate(500);

            // Change condition to "Date Is"
            changeDateFilterCondition(DateFilterCondition.DateIs);
            waitForReactUpdate(500);

            // Set filter date to 15th
            setFilterDate(15);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only rows on 15th are visible
            assertRowCount(2);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Event on 15th')
              .and('contain.text', 'Event on 15th too');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'Event on 20th');
          });
      });
    });
  });

  it('filter by date is before', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a DateTime field
        addFieldWithType(FieldType.DateTime);
        waitForReactUpdate(1000);

        // Get the date field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const dateFieldId = testId?.replace('grid-field-header-', '') || '';

            // Grid starts with 3 default rows, no need to add more

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Early Event');
            typeTextIntoCell(primaryFieldId, 1, 'Mid Event');
            typeTextIntoCell(primaryFieldId, 2, 'Late Event');
            waitForReactUpdate(500);

            // Set dates - first row: 5th
            clickDateCell(dateFieldId, 0);
            selectDateByDay(5);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Second row: 15th
            clickDateCell(dateFieldId, 1);
            selectDateByDay(15);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Third row: 25th
            clickDateCell(dateFieldId, 2);
            selectDateByDay(25);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on DateTime field
            addFilterByFieldName('Date');
            waitForReactUpdate(500);

            // Change condition to "Date Before"
            changeDateFilterCondition(DateFilterCondition.DateBefore);
            waitForReactUpdate(500);

            // Set filter date to 15th
            setFilterDate(15);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only rows before 15th are visible (only Early Event on 5th)
            assertRowCount(1);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Early Event');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'Mid Event')
              .and('not.contain.text', 'Late Event');
          });
      });
    });
  });

  it('filter by date is after', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a DateTime field
        addFieldWithType(FieldType.DateTime);
        waitForReactUpdate(1000);

        // Get the date field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const dateFieldId = testId?.replace('grid-field-header-', '') || '';

            // Grid starts with 3 default rows, no need to add more

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'First Week');
            typeTextIntoCell(primaryFieldId, 1, 'Second Week');
            typeTextIntoCell(primaryFieldId, 2, 'Fourth Week');
            waitForReactUpdate(500);

            // Set dates - first row: 7th
            clickDateCell(dateFieldId, 0);
            selectDateByDay(7);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Second row: 14th
            clickDateCell(dateFieldId, 1);
            selectDateByDay(14);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Third row: 28th
            clickDateCell(dateFieldId, 2);
            selectDateByDay(28);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on DateTime field
            addFilterByFieldName('Date');
            waitForReactUpdate(500);

            // Change condition to "Date After"
            changeDateFilterCondition(DateFilterCondition.DateAfter);
            waitForReactUpdate(500);

            // Set filter date to 14th
            setFilterDate(14);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only rows after 14th are visible (only Fourth Week on 28th)
            assertRowCount(1);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Fourth Week');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'First Week')
              .and('not.contain.text', 'Second Week');
          });
      });
    });
  });

  it('filter by date is empty', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a DateTime field
        addFieldWithType(FieldType.DateTime);
        waitForReactUpdate(1000);

        // Get the date field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const dateFieldId = testId?.replace('grid-field-header-', '') || '';

            // Grid starts with 3 default rows, no need to add more

            // Enter names (using distinct names without substring overlap)
            typeTextIntoCell(primaryFieldId, 0, 'Has Date');
            typeTextIntoCell(primaryFieldId, 1, 'Empty Date 1');
            typeTextIntoCell(primaryFieldId, 2, 'Empty Date 2');
            waitForReactUpdate(500);

            // Only set date for first row
            clickDateCell(dateFieldId, 0);
            selectDateByDay(10);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on DateTime field
            addFilterByFieldName('Date');
            waitForReactUpdate(500);

            // Change condition to "Date Is Empty"
            changeDateFilterCondition(DateFilterCondition.DateIsEmpty);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only rows without date are visible
            assertRowCount(2);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Empty Date 1')
              .and('contain.text', 'Empty Date 2');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'Has Date');
          });
      });
    });
  });

  it('filter by date is not empty', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a DateTime field
        addFieldWithType(FieldType.DateTime);
        waitForReactUpdate(1000);

        // Get the date field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const dateFieldId = testId?.replace('grid-field-header-', '') || '';

            // Grid starts with 3 default rows, no need to add more

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Has Date 1');
            typeTextIntoCell(primaryFieldId, 1, 'No Date');
            typeTextIntoCell(primaryFieldId, 2, 'Has Date 2');
            waitForReactUpdate(500);

            // Set dates for first and third rows
            clickDateCell(dateFieldId, 0);
            selectDateByDay(5);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            clickDateCell(dateFieldId, 2);
            selectDateByDay(20);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on DateTime field
            addFilterByFieldName('Date');
            waitForReactUpdate(500);

            // Change condition to "Date Is Not Empty"
            changeDateFilterCondition(DateFilterCondition.DateIsNotEmpty);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only rows with dates are visible
            assertRowCount(2);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Has Date 1')
              .and('contain.text', 'Has Date 2');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'No Date');
          });
      });
    });
  });

  it('filter by date is on or before', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a DateTime field
        addFieldWithType(FieldType.DateTime);
        waitForReactUpdate(1000);

        // Get the date field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const dateFieldId = testId?.replace('grid-field-header-', '') || '';

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Early Event');
            typeTextIntoCell(primaryFieldId, 1, 'Mid Event');
            typeTextIntoCell(primaryFieldId, 2, 'Late Event');
            waitForReactUpdate(500);

            // Set dates - first row: 5th
            clickDateCell(dateFieldId, 0);
            selectDateByDay(5);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Second row: 15th
            clickDateCell(dateFieldId, 1);
            selectDateByDay(15);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Third row: 25th
            clickDateCell(dateFieldId, 2);
            selectDateByDay(25);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on DateTime field
            addFilterByFieldName('Date');
            waitForReactUpdate(500);

            // Change condition to "Date On Or Before"
            changeDateFilterCondition(DateFilterCondition.DateOnOrBefore);
            waitForReactUpdate(500);

            // Set filter date to 15th
            setFilterDate(15);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify rows on or before 15th are visible (Early Event on 5th, Mid Event on 15th)
            assertRowCount(2);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Early Event')
              .and('contain.text', 'Mid Event');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'Late Event');
          });
      });
    });
  });

  it('filter by date is on or after', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a DateTime field
        addFieldWithType(FieldType.DateTime);
        waitForReactUpdate(1000);

        // Get the date field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const dateFieldId = testId?.replace('grid-field-header-', '') || '';

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Early Event');
            typeTextIntoCell(primaryFieldId, 1, 'Mid Event');
            typeTextIntoCell(primaryFieldId, 2, 'Late Event');
            waitForReactUpdate(500);

            // Set dates - first row: 5th
            clickDateCell(dateFieldId, 0);
            selectDateByDay(5);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Second row: 15th
            clickDateCell(dateFieldId, 1);
            selectDateByDay(15);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Third row: 25th
            clickDateCell(dateFieldId, 2);
            selectDateByDay(25);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on DateTime field
            addFilterByFieldName('Date');
            waitForReactUpdate(500);

            // Change condition to "Date On Or After"
            changeDateFilterCondition(DateFilterCondition.DateOnOrAfter);
            waitForReactUpdate(500);

            // Set filter date to 15th
            setFilterDate(15);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify rows on or after 15th are visible (Mid Event on 15th, Late Event on 25th)
            assertRowCount(2);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Mid Event')
              .and('contain.text', 'Late Event');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'Early Event');
          });
      });
    });
  });

  it('date filter - delete filter restores all rows', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a DateTime field
        addFieldWithType(FieldType.DateTime);
        waitForReactUpdate(1000);

        // Get the date field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const dateFieldId = testId?.replace('grid-field-header-', '') || '';

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Event One');
            typeTextIntoCell(primaryFieldId, 1, 'Event Two');
            typeTextIntoCell(primaryFieldId, 2, 'Event Three');
            waitForReactUpdate(500);

            // Set dates for all rows
            clickDateCell(dateFieldId, 0);
            selectDateByDay(5);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            clickDateCell(dateFieldId, 1);
            selectDateByDay(15);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            clickDateCell(dateFieldId, 2);
            selectDateByDay(25);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on DateTime field
            addFilterByFieldName('Date');
            waitForReactUpdate(500);

            // Change condition to "Date Is"
            changeDateFilterCondition(DateFilterCondition.DateIs);
            waitForReactUpdate(500);

            // Set filter date to 5th (should show only 1 row)
            setFilterDate(5);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only 1 row matches
            assertRowCount(1);

            // Delete the filter
            clickFilterChip();
            waitForReactUpdate(300);
            deleteFilter();
            waitForReactUpdate(500);

            // All rows should be visible again
            assertRowCount(3);
          });
      });
    });
  });

  it('date filter - change condition dynamically', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a DateTime field
        addFieldWithType(FieldType.DateTime);
        waitForReactUpdate(1000);

        // Get the date field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const dateFieldId = testId?.replace('grid-field-header-', '') || '';

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Has Date');
            typeTextIntoCell(primaryFieldId, 1, 'No Date');
            typeTextIntoCell(primaryFieldId, 2, 'Also Has Date');
            waitForReactUpdate(500);

            // Set dates for first and third rows only
            clickDateCell(dateFieldId, 0);
            selectDateByDay(10);
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            clickDateCell(dateFieldId, 2);
            selectDateByDay(20);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter with "Date Is Empty"
            addFilterByFieldName('Date');
            waitForReactUpdate(500);
            changeDateFilterCondition(DateFilterCondition.DateIsEmpty);
            waitForReactUpdate(500);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Should show 1 row (No Date)
            assertRowCount(1);

            // Change to "Date Is Not Empty"
            clickFilterChip();
            waitForReactUpdate(300);
            changeDateFilterCondition(DateFilterCondition.DateIsNotEmpty);
            waitForReactUpdate(500);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Should show 2 rows (Has Date, Also Has Date)
            assertRowCount(2);

            // Change to "Date Before" with date 15
            clickFilterChip();
            waitForReactUpdate(300);
            changeDateFilterCondition(DateFilterCondition.DateBefore);
            waitForReactUpdate(500);
            setFilterDate(15);
            waitForReactUpdate(500);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Should show 1 row (Has Date on 10th)
            assertRowCount(1);
          });
      });
    });
  });
});
