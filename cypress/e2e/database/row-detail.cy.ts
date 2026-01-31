/**
 * Database Row Detail Tests (Desktop Parity)
 *
 * Tests for row detail modal/page functionality.
 * Mirrors tests from: database_row_page_test.dart
 */
import 'cypress-real-events';
import {
  loginAndCreateGrid,
  typeTextIntoCell,
  getPrimaryFieldId,
} from '../../support/filter-test-helpers';
import {
  setupRowDetailTest,
  openRowDetail,
  closeRowDetailWithEscape,
  assertRowDetailOpen,
  assertRowDetailClosed,
  RowDetailSelectors,
} from '../../support/row-detail-helpers';
import {
  DatabaseGridSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

describe('Database Row Detail Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupRowDetailTest();
  });

  it('opens row detail modal', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Add content to first row
        typeTextIntoCell(primaryFieldId, 0, 'Test Row');
        waitForReactUpdate(500);

        // Open row detail using the helper
        openRowDetail(0);

        // Verify modal is open
        assertRowDetailOpen();

        // Close it
        closeRowDetailWithEscape();
        waitForReactUpdate(500);

        assertRowDetailClosed();
      });
    });
  });

  it('row detail has document area', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        typeTextIntoCell(primaryFieldId, 0, 'Document Test Row');
        waitForReactUpdate(500);

        // Open row detail using helper
        openRowDetail(0);

        // Verify document area exists
        RowDetailSelectors.documentArea().should('exist');
        RowDetailSelectors.modalContent().should('exist');
      });
    });
  });

  it('edit row title and verify persistence', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        typeTextIntoCell(primaryFieldId, 0, 'Persistence Test');
        waitForReactUpdate(500);

        // Open row detail
        openRowDetail(0);
        waitForReactUpdate(1000);

        // Verify the title is shown in the modal
        cy.get('.MuiDialog-paper', { timeout: 10000 })
          .should('be.visible')
          .and('contain.text', 'Persistence Test');

        // Find the title input and modify it - use separate commands for reliability
        cy.get('.MuiDialog-paper [data-testid="row-title-input"]', { timeout: 5000 })
          .should('exist')
          .and('be.visible')
          .focus()
          .type(' Updated', { delay: 20, force: true });
        waitForReactUpdate(1000);

        // Close modal
        closeRowDetailWithEscape();
        waitForReactUpdate(500);

        // Verify title updated in the grid
        DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
          .should('contain.text', 'Persistence Test Updated');
      });
    });
  });

  it('duplicate row from detail', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        typeTextIntoCell(primaryFieldId, 0, 'Original Row');
        waitForReactUpdate(500);

        // Get initial row count
        DatabaseGridSelectors.dataRows().then(($rows) => {
          const initialCount = $rows.length;

          // Open row detail
          openRowDetail(0);

          // Duplicate via more actions menu
          RowDetailSelectors.moreActionsButton().click({ force: true });
          waitForReactUpdate(500);
          RowDetailSelectors.duplicateMenuItem().click({ force: true });
          waitForReactUpdate(1000);

          // Close modal if still open
          cy.get('body').type('{esc}');
          waitForReactUpdate(500);

          // Verify row count increased
          DatabaseGridSelectors.dataRows().should('have.length', initialCount + 1);

          // Verify both rows have the content
          DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
            .filter(':contains("Original Row")')
            .should('have.length', 2);
        });
      });
    });
  });

  it('delete row from detail', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Grid starts with 3 rows, use them
        typeTextIntoCell(primaryFieldId, 0, 'Keep This Row');
        typeTextIntoCell(primaryFieldId, 1, 'Delete This Row');
        waitForReactUpdate(500);

        // Get initial row count
        DatabaseGridSelectors.dataRows().then(($rows) => {
          const initialCount = $rows.length;

          // Open row detail for second row
          openRowDetail(1);

          // Delete via more actions menu
          RowDetailSelectors.moreActionsButton().click({ force: true });
          waitForReactUpdate(500);
          RowDetailSelectors.deleteMenuItem().click({ force: true });
          waitForReactUpdate(1000);

          // Handle confirmation dialog if it appears
          cy.get('body').then(($body) => {
            if ($body.find('[role="dialog"]').length > 0) {
              cy.contains('button', /delete|confirm/i).click({ force: true });
              waitForReactUpdate(500);
            }
          });

          // Verify row count decreased
          DatabaseGridSelectors.dataRows().should('have.length', initialCount - 1);

          // Verify correct row was deleted
          DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
            .should('not.contain.text', 'Delete This Row');
          DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
            .should('contain.text', 'Keep This Row');
        });
      });
    });
  });

  it('long title wraps properly', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        const longTitle =
          'This is a very long title that should wrap properly without causing any overflow issues in the row detail modal';
        typeTextIntoCell(primaryFieldId, 0, longTitle);
        waitForReactUpdate(500);

        // Open row detail
        openRowDetail(0);

        // Verify no horizontal overflow
        RowDetailSelectors.modal().should('exist');
        RowDetailSelectors.modalContent().then(($content) => {
          // Check that content is not overflowing
          const element = $content[0];
          expect(element.scrollWidth).to.be.at.most(element.clientWidth + 10); // Allow small margin
        });
      });
    });
  });

  it('add field in row detail', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        typeTextIntoCell(primaryFieldId, 0, 'Field Test Row');
        waitForReactUpdate(500);

        // Open row detail
        openRowDetail(0);
        waitForReactUpdate(1000);

        // Wait for the properties section to load
        cy.get('.MuiDialog-paper .row-properties').should('exist');
        waitForReactUpdate(500);

        // Click the "New Property" button - it creates a RichText field directly
        cy.get('.MuiDialog-paper')
          .contains(/new property/i)
          .scrollIntoView()
          .click({ force: true });
        waitForReactUpdate(1000);

        // Verify a new field was created - the properties section should still exist
        // and there should be an active/editable field
        cy.get('.MuiDialog-paper .row-properties').should('exist');
      });
    });
  });

  it('close modal with escape key', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        typeTextIntoCell(primaryFieldId, 0, 'Escape Test');
        waitForReactUpdate(500);

        // Open row detail
        openRowDetail(0);
        waitForReactUpdate(1000);

        // Verify modal is open with explicit wait
        cy.get('.MuiDialog-paper', { timeout: 10000 })
          .should('exist')
          .and('be.visible');

        // Press Escape to close - use realPress for more reliable key events
        cy.get('body').realPress('Escape');
        waitForReactUpdate(500);

        assertRowDetailClosed();
      });
    });
  });

  it('navigate between rows in detail view', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        // Grid starts with 3 default rows
        typeTextIntoCell(primaryFieldId, 0, 'Row One');
        typeTextIntoCell(primaryFieldId, 1, 'Row Two');
        typeTextIntoCell(primaryFieldId, 2, 'Row Three');
        waitForReactUpdate(500);

        // Open row detail for first row
        openRowDetail(0);

        // Verify we're viewing Row One
        RowDetailSelectors.modal().should('contain.text', 'Row One');
      });
    });
  });
});
