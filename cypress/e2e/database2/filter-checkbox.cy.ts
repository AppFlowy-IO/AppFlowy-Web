/**
 * Database Checkbox Filter Tests (Desktop Parity)
 *
 * Tests for checkbox field filtering.
 * Mirrors tests from: database_filter_test.dart (checkbox filter section)
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
  toggleCheckbox,
  FieldType,
} from '../../support/field-type-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Checkbox filter condition enum values (matching CheckboxFilterCondition)
 */
enum CheckboxFilterCondition {
  IsChecked = 0,
  IsUnchecked = 1,
}

/**
 * Change the checkbox filter condition
 */
const changeCheckboxFilterCondition = (condition: CheckboxFilterCondition): void => {
  // Find the condition dropdown in the filter popover and click it
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

  // Select the target condition
  cy.get(`[data-testid="filter-condition-${condition}"]`, { timeout: 10000 })
    .should('be.visible')
    .click({ force: true });
  waitForReactUpdate(500);
};

describe('Database Checkbox Filter Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupFilterTest();
  });

  it('filter by checked checkboxes', () => {
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

            // Grid starts with 3 default rows, no need to add more

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Task One');
            typeTextIntoCell(primaryFieldId, 1, 'Task Two');
            typeTextIntoCell(primaryFieldId, 2, 'Task Three');
            waitForReactUpdate(500);

            // Check the first and third rows
            toggleCheckbox(checkboxFieldId, 0);
            toggleCheckbox(checkboxFieldId, 2);
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on Checkbox field
            addFilterByFieldName('Checkbox');
            waitForReactUpdate(500);

            // Change condition to "Is Checked"
            changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only checked rows are visible (Task One and Task Three)
            assertRowCount(2);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Task One')
              .and('contain.text', 'Task Three');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'Task Two');
          });
      });
    });
  });

  it('filter by unchecked checkboxes', () => {
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

            // Grid starts with 3 default rows, no need to add more

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Completed Task');
            typeTextIntoCell(primaryFieldId, 1, 'Pending Task');
            typeTextIntoCell(primaryFieldId, 2, 'Another Pending');
            waitForReactUpdate(500);

            // Check only the first row
            toggleCheckbox(checkboxFieldId, 0);
            waitForReactUpdate(500);

            // Verify initial row count
            assertRowCount(3);

            // Add filter on Checkbox field
            addFilterByFieldName('Checkbox');
            waitForReactUpdate(500);

            // Change condition to "Is Unchecked"
            changeCheckboxFilterCondition(CheckboxFilterCondition.IsUnchecked);
            waitForReactUpdate(500);

            // Close the filter popover
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Verify only unchecked rows are visible (Pending Task and Another Pending)
            assertRowCount(2);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Pending Task')
              .and('contain.text', 'Another Pending');
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('not.contain.text', 'Completed Task');
          });
      });
    });
  });

  it('toggle checkbox updates filtered view', () => {
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

            // Grid starts with 3 default rows, we'll use all 3 for this test

            // Enter names for all 3 rows
            typeTextIntoCell(primaryFieldId, 0, 'Task A');
            typeTextIntoCell(primaryFieldId, 1, 'Task B');
            typeTextIntoCell(primaryFieldId, 2, 'Task C');
            waitForReactUpdate(500);

            // Initially no checkboxes are checked

            // Add filter for "Is Checked"
            addFilterByFieldName('Checkbox');
            waitForReactUpdate(500);
            changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
            waitForReactUpdate(500);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // No rows should be visible (none are checked)
            assertRowCount(0);

            // Delete the filter
            DatabaseFilterSelectors.filterCondition().first().click({ force: true });
            waitForReactUpdate(300);
            deleteFilter();
            waitForReactUpdate(500);

            // Verify all rows are back
            assertRowCount(3);

            // Check one row
            toggleCheckbox(checkboxFieldId, 0);
            waitForReactUpdate(500);

            // Re-add filter for "Is Checked"
            addFilterByFieldName('Checkbox');
            waitForReactUpdate(500);
            changeCheckboxFilterCondition(CheckboxFilterCondition.IsChecked);
            waitForReactUpdate(500);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Now 1 row should be visible
            assertRowCount(1);
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .should('contain.text', 'Task A');
          });
      });
    });
  });
});
