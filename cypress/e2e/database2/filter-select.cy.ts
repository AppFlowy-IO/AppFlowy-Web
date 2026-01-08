/**
 * Database Select Filter Tests (Desktop Parity)
 *
 * Tests for single select and multi select field filtering.
 * Mirrors tests from: database_filter_test.dart (select filter section)
 */
import 'cypress-real-events';
import {
  loginAndCreateGrid,
  setupFilterTest,
  typeTextIntoCell,
  getPrimaryFieldId,
  addFilterByFieldName,
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
 * Select filter condition enum values (matching SelectOptionFilterCondition)
 */
enum SelectFilterCondition {
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
const createSelectOption = (optionName: string): void => {
  // Type the option name in the input
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('input')
    .first()
    .clear()
    .type(`${optionName}{enter}`, { delay: 30 });
  waitForReactUpdate(500);
};

/**
 * Click on a single select cell to open the options popover
 */
const clickSelectCell = (fieldId: string, rowIndex: number): void => {
  DatabaseGridSelectors.dataRowCellsForField(fieldId)
    .eq(rowIndex)
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Select an existing option from the dropdown
 */
const selectExistingOption = (optionName: string): void => {
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .contains(optionName)
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Select an option in the filter popover
 */
const selectFilterOption = (optionName: string): void => {
  // Find and click the option in the filter popover
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
const changeSelectFilterCondition = (condition: SelectFilterCondition): void => {
  // Find the condition dropdown in the filter popover
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

  // Select the target condition
  cy.get(`[data-testid="filter-condition-${condition}"]`, { timeout: 10000 })
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);
};

describe('Database Select Filter Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupFilterTest();
  });

  it('filter by single select option', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a SingleSelect field
        addFieldWithType(FieldType.SingleSelect);
        waitForReactUpdate(1000);

        // Get the select field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const selectFieldId = testId?.replace('grid-field-header-', '') || '';

            // Grid starts with 3 default rows, no need to add more

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'High Priority Item');
            typeTextIntoCell(primaryFieldId, 1, 'Medium Priority Item');
            typeTextIntoCell(primaryFieldId, 2, 'Low Priority Item');
            waitForReactUpdate(500);

            // Click first row select cell and create "High" option
            clickSelectCell(selectFieldId, 0);
            createSelectOption('High');
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Click second row and create "Medium" option
            clickSelectCell(selectFieldId, 1);
            createSelectOption('Medium');
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Click third row and create "Low" option
            clickSelectCell(selectFieldId, 2);
            createSelectOption('Low');
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on Select field (the default name for SingleSelect type)
            addFilterByFieldName('Select');
            waitForReactUpdate(500);

            // Change condition to "Option Is" (default might already be this)
            changeSelectFilterCondition(SelectFilterCondition.OptionIs);
            waitForReactUpdate(500);

            // Select "High" option
            selectFilterOption('High');
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only High priority row is visible
            assertRowCount(1);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'High Priority Item');
          });
      });
    });
  });

  it('filter by single select is empty', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a SingleSelect field
        addFieldWithType(FieldType.SingleSelect);
        waitForReactUpdate(1000);

        // Get the select field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const selectFieldId = testId?.replace('grid-field-header-', '') || '';

            // Grid starts with 3 default rows, no need to add more

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'With Status');
            typeTextIntoCell(primaryFieldId, 1, 'No Status');
            typeTextIntoCell(primaryFieldId, 2, 'Also No Status');
            waitForReactUpdate(500);

            // Only set status for first row
            clickSelectCell(selectFieldId, 0);
            createSelectOption('Active');
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on Select field (the default name for SingleSelect type)
            addFilterByFieldName('Select');
            waitForReactUpdate(500);

            // Change condition to "Is Empty"
            changeSelectFilterCondition(SelectFilterCondition.OptionIsEmpty);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only rows without status are visible
            assertRowCount(2);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'No Status')
              .and('contain.text', 'Also No Status');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'With Status');
          });
      });
    });
  });

  it('filter by multi select contains option', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a MultiSelect field
        addFieldWithType(FieldType.MultiSelect);
        waitForReactUpdate(1000);

        // Get the multi select field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const multiSelectFieldId = testId?.replace('grid-field-header-', '') || '';

            // Grid starts with 3 default rows, no need to add more

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Frontend Developer');
            typeTextIntoCell(primaryFieldId, 1, 'Backend Developer');
            typeTextIntoCell(primaryFieldId, 2, 'Fullstack Developer');
            waitForReactUpdate(500);

            // First row: add "React" tag
            clickSelectCell(multiSelectFieldId, 0);
            createSelectOption('React');
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Second row: add "Node" tag
            clickSelectCell(multiSelectFieldId, 1);
            createSelectOption('Node');
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            // Third row: add both "React" and "Node" tags
            clickSelectCell(multiSelectFieldId, 2);
            selectExistingOption('React');
            selectExistingOption('Node');
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on Multiselect field (the default name for MultiSelect type)
            addFilterByFieldName('Multiselect');
            waitForReactUpdate(500);

            // Change condition to "Contains"
            changeSelectFilterCondition(SelectFilterCondition.OptionContains);
            waitForReactUpdate(500);

            // Select "React" option
            selectFilterOption('React');
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify rows with "React" tag are visible
            assertRowCount(2);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Frontend Developer')
              .and('contain.text', 'Fullstack Developer');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'Backend Developer');
          });
      });
    });
  });

  it('filter by multi select is not empty', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a MultiSelect field
        addFieldWithType(FieldType.MultiSelect);
        waitForReactUpdate(1000);

        // Get the multi select field ID
        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const multiSelectFieldId = testId?.replace('grid-field-header-', '') || '';

            // Grid starts with 3 default rows, no need to add more

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Tagged Item');
            typeTextIntoCell(primaryFieldId, 1, 'Untagged Item');
            typeTextIntoCell(primaryFieldId, 2, 'Another Tagged');
            waitForReactUpdate(500);

            // Add tag to first and third rows
            clickSelectCell(multiSelectFieldId, 0);
            createSelectOption('Important');
            cy.get('body').type('{esc}');
            waitForReactUpdate(300);

            clickSelectCell(multiSelectFieldId, 2);
            selectExistingOption('Important');
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on Multiselect field (the default name for MultiSelect type)
            addFilterByFieldName('Multiselect');
            waitForReactUpdate(500);

            // Change condition to "Is Not Empty"
            changeSelectFilterCondition(SelectFilterCondition.OptionIsNotEmpty);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only tagged rows are visible
            assertRowCount(2);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Tagged Item')
              .and('contain.text', 'Another Tagged');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'Untagged Item');
          });
      });
    });
  });
});
