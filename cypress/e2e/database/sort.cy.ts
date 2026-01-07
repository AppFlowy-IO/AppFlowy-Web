/**
 * Database Sort Tests (Desktop Parity)
 *
 * Tests sorting functionality for database views.
 * Mirrors tests from: database_sort_test.dart
 */
import 'cypress-real-events';
import {
  loginAndCreateGrid,
  setupFilterTest,
  typeTextIntoCell,
  getPrimaryFieldId,
  assertRowCount,
} from '../../support/filter-test-helpers';
import {
  addFieldWithType,
  addRows,
  toggleCheckbox,
  getCellTextContent,
  changeFieldTypeById,
  FieldType,
} from '../../support/field-type-helpers';
import {
  setupSortTest,
  addSortByFieldName,
  openSortMenu,
  toggleSortDirection,
  changeSortDirection,
  deleteSort,
  deleteAllSorts,
  assertRowOrder,
  closeSortMenu,
  SortDirection,
  SortSelectors,
} from '../../support/sort-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  GridFieldSelectors,
  PropertyMenuSelectors,
  RowControlsSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

describe('Database Sort Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupSortTest();
  });

  describe('Basic Sort Operations', () => {
    it('text sort - ascending', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add rows with data: C, A, B (out of order)
          addRows(2); // Now have 3 rows total
          waitForReactUpdate(500);

          typeTextIntoCell(primaryFieldId, 0, 'C');
          typeTextIntoCell(primaryFieldId, 1, 'A');
          typeTextIntoCell(primaryFieldId, 2, 'B');
          waitForReactUpdate(500);

          // Add sort by Name field (ascending by default)
          addSortByFieldName('Name');
          waitForReactUpdate(1000);

          // Verify order is now A, B, C
          assertRowOrder(primaryFieldId, ['A', 'B', 'C']);
        });
      });
    });

    it('text sort - descending', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add rows with data
          addRows(2);
          waitForReactUpdate(500);

          typeTextIntoCell(primaryFieldId, 0, 'A');
          typeTextIntoCell(primaryFieldId, 1, 'C');
          typeTextIntoCell(primaryFieldId, 2, 'B');
          waitForReactUpdate(500);

          // Add sort by Name field
          addSortByFieldName('Name');
          waitForReactUpdate(1000);

          // Toggle to descending
          openSortMenu();
          toggleSortDirection(0);
          closeSortMenu();
          waitForReactUpdate(500);

          // Verify order is now C, B, A
          assertRowOrder(primaryFieldId, ['C', 'B', 'A']);
        });
      });
    });

    it('number sort - ascending', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add a Number field (default name is "Numbers") and get its ID directly
          addFieldWithType(FieldType.Number).then((numberFieldId) => {
            cy.log(`Number field ID: ${numberFieldId}`);
            waitForReactUpdate(500);

            // Add rows and enter numbers out of order
            addRows(2);
            waitForReactUpdate(500);

            typeTextIntoCell(primaryFieldId, 0, 'Row1');
            typeTextIntoCell(primaryFieldId, 1, 'Row2');
            typeTextIntoCell(primaryFieldId, 2, 'Row3');
            waitForReactUpdate(300);

            // Type numbers into the Number field cells
            typeTextIntoCell(numberFieldId, 0, '30');
            waitForReactUpdate(300);
            typeTextIntoCell(numberFieldId, 1, '10');
            waitForReactUpdate(300);
            typeTextIntoCell(numberFieldId, 2, '20');
            waitForReactUpdate(500);

            // Verify numbers were entered by checking cell content
            cy.log('Verifying numbers were entered...');
            DatabaseGridSelectors.dataRowCellsForField(numberFieldId)
              .eq(0)
              .should('contain.text', '30');

            // Add sort by the Number field (default name is "Numbers")
            addSortByFieldName('Numbers');
            waitForReactUpdate(1000);

            // Verify order is now Row2 (10), Row3 (20), Row1 (30)
            assertRowOrder(primaryFieldId, ['Row2', 'Row3', 'Row1']);
          });
        });
      });
    });

    it('number sort - descending', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add a Number field and get its ID directly
          addFieldWithType(FieldType.Number).then((numberFieldId) => {
            cy.log(`Number field ID: ${numberFieldId}`);
            waitForReactUpdate(500);

            // Add rows
            addRows(2);
            waitForReactUpdate(500);

            typeTextIntoCell(primaryFieldId, 0, 'Row1');
            typeTextIntoCell(primaryFieldId, 1, 'Row2');
            typeTextIntoCell(primaryFieldId, 2, 'Row3');
            waitForReactUpdate(300);

            typeTextIntoCell(numberFieldId, 0, '10');
            waitForReactUpdate(300);
            typeTextIntoCell(numberFieldId, 1, '30');
            waitForReactUpdate(300);
            typeTextIntoCell(numberFieldId, 2, '20');
            waitForReactUpdate(500);

            // Verify numbers were entered
            DatabaseGridSelectors.dataRowCellsForField(numberFieldId)
              .eq(0)
              .should('contain.text', '10');

            // Add sort by Number field
            addSortByFieldName('Numbers');
            waitForReactUpdate(500);

            // Toggle to descending
            openSortMenu();
            toggleSortDirection(0);
            closeSortMenu();
            waitForReactUpdate(500);

            // Verify order is now Row2 (30), Row3 (20), Row1 (10)
            assertRowOrder(primaryFieldId, ['Row2', 'Row3', 'Row1']);
          });
        });
      });
    });

    it('checkbox sort', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add a Checkbox field (default name is "Checkbox")
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          // Get the Checkbox field ID
          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              // Add rows
              addRows(2);
              waitForReactUpdate(500);

              typeTextIntoCell(primaryFieldId, 0, 'Checked');
              typeTextIntoCell(primaryFieldId, 1, 'Unchecked');
              typeTextIntoCell(primaryFieldId, 2, 'Also Checked');
              waitForReactUpdate(500);

              // Check first and third rows
              toggleCheckbox(checkboxFieldId, 0);
              waitForReactUpdate(300);
              toggleCheckbox(checkboxFieldId, 2);
              waitForReactUpdate(500);

              // Add sort by Checkbox field
              addSortByFieldName('Checkbox');
              waitForReactUpdate(1000);

              // Unchecked should be first (false < true in default ascending)
              // Verify "Unchecked" row is first
              DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
                .first()
                .should('contain.text', 'Unchecked');
            });
        });
      });
    });
  });

  describe('Multiple Sorts', () => {
    it('multiple sorts - checkbox then text', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add a Checkbox field (default name is "Checkbox")
          addFieldWithType(FieldType.Checkbox);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const checkboxFieldId = testId?.replace('grid-field-header-', '') || '';

              // Check current row count and add rows if needed
              // Default grid has 3 rows, we need 4 for this test
              DatabaseGridSelectors.dataRows().then(($rows) => {
                const currentRows = $rows.length;
                const targetRows = 4;
                const rowsToAdd = Math.max(0, targetRows - currentRows);
                if (rowsToAdd > 0) {
                  addRows(rowsToAdd);
                }
                waitForReactUpdate(500);

                // Set up data: mix of checked/unchecked with various names
                typeTextIntoCell(primaryFieldId, 0, 'Beta');
                typeTextIntoCell(primaryFieldId, 1, 'Alpha');
                typeTextIntoCell(primaryFieldId, 2, 'Delta');
                typeTextIntoCell(primaryFieldId, 3, 'Charlie');
                waitForReactUpdate(500);

                // Check rows 0 and 2 (Beta and Delta)
                toggleCheckbox(checkboxFieldId, 0);
                waitForReactUpdate(300);
                toggleCheckbox(checkboxFieldId, 2);
                waitForReactUpdate(500);

                // Add first sort by checkbox
                addSortByFieldName('Checkbox');
                waitForReactUpdate(500);

                // Add second sort by name
                openSortMenu();
                waitForReactUpdate(300);
                SortSelectors.addSortButton().click({ force: true });
                waitForReactUpdate(500);
                DatabaseFilterSelectors.propertyItemByName('Name').click({ force: true });
                waitForReactUpdate(1000);

                // Expected order (only first 4 rows):
                // First unchecked (Alpha, Charlie) sorted alphabetically
                // Then checked (Beta, Delta) sorted alphabetically
                assertRowOrder(primaryFieldId, ['Alpha', 'Charlie', 'Beta', 'Delta']);
              });
            });
        });
      });
    });
  });

  describe('Sort Management', () => {
    it('delete sort', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          addRows(2);
          waitForReactUpdate(500);

          typeTextIntoCell(primaryFieldId, 0, 'C');
          typeTextIntoCell(primaryFieldId, 1, 'A');
          typeTextIntoCell(primaryFieldId, 2, 'B');
          waitForReactUpdate(500);

          // Add sort
          addSortByFieldName('Name');
          waitForReactUpdate(1000);

          // Verify sorted
          assertRowOrder(primaryFieldId, ['A', 'B', 'C']);

          // Delete sort
          openSortMenu();
          deleteSort(0);
          waitForReactUpdate(500);

          // Sort condition chip should not exist
          SortSelectors.sortCondition().should('not.exist');
        });
      });
    });

    it('delete all sorts', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          // Add Number field (default name is "Numbers")
          addFieldWithType(FieldType.Number);
          waitForReactUpdate(1000);

          cy.get('[data-testid^="grid-field-header-"]')
            .last()
            .invoke('attr', 'data-testid')
            .then((testId) => {
              const numberFieldId = testId?.replace('grid-field-header-', '') || '';

              addRows(2);
              waitForReactUpdate(500);

              typeTextIntoCell(primaryFieldId, 0, 'Row1');
              typeTextIntoCell(primaryFieldId, 1, 'Row2');
              typeTextIntoCell(primaryFieldId, 2, 'Row3');

              typeTextIntoCell(numberFieldId, 0, '3');
              typeTextIntoCell(numberFieldId, 1, '1');
              typeTextIntoCell(numberFieldId, 2, '2');
              waitForReactUpdate(500);

              // Add multiple sorts
              addSortByFieldName('Name');
              waitForReactUpdate(500);

              // Add second sort
              openSortMenu();
              SortSelectors.addSortButton().click({ force: true });
              waitForReactUpdate(500);
              DatabaseFilterSelectors.propertyItemByName('Numbers').click({ force: true });
              waitForReactUpdate(500);

              // Delete all sorts
              openSortMenu();
              deleteAllSorts();
              waitForReactUpdate(500);

              // Sort condition chip should not exist
              SortSelectors.sortCondition().should('not.exist');
            });
        });
      });
    });

    it('edit field name updates sort display', () => {
      const email = generateRandomEmail();
      loginAndCreateGrid(email).then(() => {
        getPrimaryFieldId().then((primaryFieldId) => {
          addRows(1);
          waitForReactUpdate(500);

          typeTextIntoCell(primaryFieldId, 0, 'A');
          typeTextIntoCell(primaryFieldId, 1, 'B');
          waitForReactUpdate(500);

          // Add sort by Name
          addSortByFieldName('Name');
          waitForReactUpdate(1000);

          // Rename the Name field to "Title"
          // Use .last() because there can be both sticky and regular headers
          GridFieldSelectors.fieldHeader(primaryFieldId).last().click({ force: true });
          waitForReactUpdate(500);
          PropertyMenuSelectors.editPropertyMenuItem().first().click({ force: true });
          waitForReactUpdate(500);

          // Find the name input and change it
          cy.get('input[value="Name"]').clear().type('Title', { delay: 30 });
          cy.get('body').type('{esc}');
          waitForReactUpdate(500);

          // Verify sort still works and shows updated field name
          SortSelectors.sortCondition().should('exist');
          // The sort panel should show "Title" now
          openSortMenu();
          cy.get('[data-radix-popper-content-wrapper]').last().should('contain.text', 'Title');
        });
      });
    });
  });
});
