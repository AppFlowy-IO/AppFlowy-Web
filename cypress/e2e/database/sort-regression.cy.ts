/**
 * Database Sort Regression Tests (Desktop Parity)
 *
 * Tests for sort edge cases and regression issues.
 * Mirrors tests from: database_sort_regression_test.dart
 */
import 'cypress-real-events';
import {
  loginAndCreateGrid,
  typeTextIntoCell,
  getPrimaryFieldId,
  addFilterByFieldName,
  changeFilterCondition,
  enterFilterText,
  TextFilterCondition,
} from '../../support/filter-test-helpers';
import {
  addFieldWithType,
  addRows,
  FieldType,
} from '../../support/field-type-helpers';
import {
  setupSortTest,
  addSortByFieldName,
  assertRowOrder,
  SortSelectors,
} from '../../support/sort-test-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  GridFieldSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

describe('Database Sort Regression Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupSortTest();
  });

  it('non-sort edit keeps row order', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a Number field (non-sorted field)
        addFieldWithType(FieldType.Number);
        waitForReactUpdate(1000);

        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const numberFieldId = testId?.replace('grid-field-header-', '') || '';

            addRows(2);
            waitForReactUpdate(500);

            // Enter names
            typeTextIntoCell(primaryFieldId, 0, 'Charlie');
            typeTextIntoCell(primaryFieldId, 1, 'Alpha');
            typeTextIntoCell(primaryFieldId, 2, 'Beta');

            // Enter numbers
            typeTextIntoCell(numberFieldId, 0, '1');
            typeTextIntoCell(numberFieldId, 1, '2');
            typeTextIntoCell(numberFieldId, 2, '3');
            waitForReactUpdate(500);

            // Sort by Name
            addSortByFieldName('Name');
            waitForReactUpdate(1000);

            // Verify sorted order: Alpha, Beta, Charlie
            assertRowOrder(primaryFieldId, ['Alpha', 'Beta', 'Charlie']);

            // Edit the number field (non-sorted) - should NOT change row order
            typeTextIntoCell(numberFieldId, 0, '999');
            waitForReactUpdate(500);

            // Verify order is still Alpha, Beta, Charlie
            assertRowOrder(primaryFieldId, ['Alpha', 'Beta', 'Charlie']);
          });
      });
    });
  });

  it('filter + sort keeps row order on non-sort edit', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add a Number field
        addFieldWithType(FieldType.Number);
        waitForReactUpdate(1000);

        cy.get('[data-testid^="grid-field-header-"]')
          .last()
          .invoke('attr', 'data-testid')
          .then((testId) => {
            const numberFieldId = testId?.replace('grid-field-header-', '') || '';

            addRows(4);
            waitForReactUpdate(500);

            // Enter names with "A" prefix for filtering
            typeTextIntoCell(primaryFieldId, 0, 'A_Charlie');
            typeTextIntoCell(primaryFieldId, 1, 'B_Skip');
            typeTextIntoCell(primaryFieldId, 2, 'A_Alpha');
            typeTextIntoCell(primaryFieldId, 3, 'A_Beta');
            typeTextIntoCell(primaryFieldId, 4, 'B_Skip2');

            // Enter numbers
            typeTextIntoCell(numberFieldId, 0, '1');
            typeTextIntoCell(numberFieldId, 1, '2');
            typeTextIntoCell(numberFieldId, 2, '3');
            typeTextIntoCell(numberFieldId, 3, '4');
            typeTextIntoCell(numberFieldId, 4, '5');
            waitForReactUpdate(500);

            // Add filter: Name starts with "A"
            addFilterByFieldName('Name');
            waitForReactUpdate(500);
            changeFilterCondition(TextFilterCondition.TextStartsWith);
            waitForReactUpdate(500);
            enterFilterText('A');
            waitForReactUpdate(500);
            cy.get('body').type('{esc}');
            waitForReactUpdate(500);

            // Sort by Name
            addSortByFieldName('Name');
            waitForReactUpdate(1000);

            // Verify filtered and sorted order: A_Alpha, A_Beta, A_Charlie
            assertRowOrder(primaryFieldId, ['A_Alpha', 'A_Beta', 'A_Charlie']);

            // Edit number in first visible row (should be A_Alpha after sort)
            typeTextIntoCell(numberFieldId, 0, '100');
            waitForReactUpdate(500);

            // Verify order is still A_Alpha, A_Beta, A_Charlie
            assertRowOrder(primaryFieldId, ['A_Alpha', 'A_Beta', 'A_Charlie']);
          });
      });
    });
  });

  it('case-insensitive alphabetical sort', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Grid starts with 3 rows, add 1 more for 4 total
        addRows(1);
        waitForReactUpdate(500);

        // Enter mixed-case names in all 4 rows
        typeTextIntoCell(primaryFieldId, 0, 'banana');
        typeTextIntoCell(primaryFieldId, 1, 'Apple');
        typeTextIntoCell(primaryFieldId, 2, 'CHERRY');
        typeTextIntoCell(primaryFieldId, 3, 'date');
        waitForReactUpdate(500);

        // Sort by Name
        addSortByFieldName('Name');
        waitForReactUpdate(1000);

        // Verify case-insensitive order: Apple, banana, CHERRY, date
        // (alphabetical ignoring case)
        DatabaseGridSelectors.dataRowCellsForField(primaryFieldId).then(($cells) => {
          const values = $cells.toArray().map((el) => el.textContent?.trim().toLowerCase() || '');
          // Filter out empty values since we only care about filled rows
          const nonEmptyValues = values.filter(v => v !== '');
          // Should be in alphabetical order when lowercased
          const sortedValues = [...nonEmptyValues].sort();
          expect(nonEmptyValues).to.deep.equal(sortedValues);
        });
      });
    });
  });

  it('case-insensitive sort with ascending/descending toggle', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        addRows(2);
        waitForReactUpdate(500);

        // Enter mixed-case names
        typeTextIntoCell(primaryFieldId, 0, 'Zebra');
        typeTextIntoCell(primaryFieldId, 1, 'apple');
        typeTextIntoCell(primaryFieldId, 2, 'MANGO');
        waitForReactUpdate(500);

        // Sort by Name (ascending)
        addSortByFieldName('Name');
        waitForReactUpdate(1000);

        // Verify ascending order (case-insensitive): apple, MANGO, Zebra
        DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
          .first()
          .invoke('text')
          .then((text) => {
            expect(text.trim().toLowerCase()).to.equal('apple');
          });

        // Toggle to descending
        SortSelectors.sortCondition().first().click({ force: true });
        waitForReactUpdate(500);

        cy.get('[data-radix-popper-content-wrapper]')
          .last()
          .find('button')
          .filter((_, el) => {
            const text = el.textContent?.toLowerCase() || '';
            return text.includes('asc') || text.includes('desc');
          })
          .first()
          .click({ force: true });
        waitForReactUpdate(300);

        cy.get('[data-radix-popper-content-wrapper]')
          .last()
          .find('[role="menuitem"], [role="option"]')
          .filter((_, el) => el.textContent?.toLowerCase().includes('desc'))
          .first()
          .click({ force: true });
        waitForReactUpdate(500);

        cy.get('body').type('{esc}');
        waitForReactUpdate(500);

        // Verify descending order: Zebra, MANGO, apple
        DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
          .first()
          .invoke('text')
          .then((text) => {
            expect(text.trim().toLowerCase()).to.equal('zebra');
          });
      });
    });
  });
});
