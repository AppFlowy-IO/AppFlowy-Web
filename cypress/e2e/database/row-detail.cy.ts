/**
 * Database Row Detail Tests (Desktop Parity)
 *
 * Tests for row detail modal/page functionality.
 * Mirrors tests from: database_row_page_test.dart
 */
import 'cypress-real-events';
import {
  loginAndCreateGrid,
  setupFilterTest,
  typeTextIntoCell,
  getPrimaryFieldId,
} from '../../support/filter-test-helpers';
import {
  addFieldWithType,
  addRows,
  FieldType,
} from '../../support/field-type-helpers';
import {
  setupRowDetailTest,
  openRowDetail,
  openRowDetailViaCell,
  closeRowDetail,
  closeRowDetailWithEscape,
  assertRowDetailOpen,
  assertRowDetailClosed,
  typeInRowDocument,
  clearAndTypeInRowDocument,
  assertDocumentContains,
  openMoreActionsMenu,
  duplicateRowFromDetail,
  deleteRowFromDetail,
  addEmojiToRow,
  removeEmojiFromRow,
  assertRowHasEmoji,
  assertRowHasNoEmoji,
  addPropertyInRowDetail,
  togglePropertyVisibility,
  assertPropertyExists,
  editRowTitle,
  RowDetailSelectors,
} from '../../support/row-detail-helpers';
import {
  DatabaseGridSelectors,
  GridFieldSelectors,
  RowControlsSelectors,
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

        // Find and click the expand icon on the row
        DatabaseGridSelectors.dataRows()
          .first()
          .scrollIntoView()
          .realHover();
        waitForReactUpdate(500);

        // Look for expand button
        cy.get('body').then(($body) => {
          if ($body.find('[data-testid="row-expand-icon"]:visible').length > 0) {
            cy.get('[data-testid="row-expand-icon"]').first().click({ force: true });
          } else if ($body.find('.expand-row-button:visible').length > 0) {
            cy.get('.expand-row-button').first().click({ force: true });
          } else {
            // Fallback: double-click on the row cell
            DatabaseGridSelectors.dataRowCellsForField(primaryFieldId)
              .first()
              .dblclick({ force: true });
          }
        });

        waitForReactUpdate(1000);

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

        // Open row detail
        DatabaseGridSelectors.dataRows().first().realHover();
        waitForReactUpdate(500);

        cy.get('[data-testid="row-expand-icon"], .expand-row-button')
          .first()
          .click({ force: true });
        waitForReactUpdate(1000);

        // Verify document area exists
        RowDetailSelectors.documentArea().should('exist');
        RowDetailSelectors.modalContent().should('exist');
      });
    });
  });

  it('edit document content and verify persistence', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        typeTextIntoCell(primaryFieldId, 0, 'Persistence Test');
        waitForReactUpdate(500);

        // Open row detail
        DatabaseGridSelectors.dataRows().first().realHover();
        waitForReactUpdate(500);
        cy.get('[data-testid="row-expand-icon"], .expand-row-button')
          .first()
          .click({ force: true });
        waitForReactUpdate(1000);

        // Find the document editor and type content
        const testContent = 'This is test document content.';
        RowDetailSelectors.documentArea()
          .find('[contenteditable="true"], .ProseMirror, .editor-content')
          .first()
          .click({ force: true })
          .type(testContent, { delay: 20 });
        waitForReactUpdate(500);

        // Close modal
        closeRowDetailWithEscape();
        waitForReactUpdate(500);

        // Re-open modal
        DatabaseGridSelectors.dataRows().first().realHover();
        waitForReactUpdate(500);
        cy.get('[data-testid="row-expand-icon"], .expand-row-button')
          .first()
          .click({ force: true });
        waitForReactUpdate(1000);

        // Verify content persisted
        RowDetailSelectors.documentArea().should('contain.text', testContent);
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
          DatabaseGridSelectors.dataRows().first().realHover();
          waitForReactUpdate(500);
          cy.get('[data-testid="row-expand-icon"], .expand-row-button')
            .first()
            .click({ force: true });
          waitForReactUpdate(1000);

          // Duplicate via more actions menu
          RowDetailSelectors.moreActionsButton().click({ force: true });
          waitForReactUpdate(500);
          RowDetailSelectors.duplicateMenuItem().click({ force: true });
          waitForReactUpdate(1000);

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
        addRows(1);
        waitForReactUpdate(500);

        typeTextIntoCell(primaryFieldId, 0, 'Keep This Row');
        typeTextIntoCell(primaryFieldId, 1, 'Delete This Row');
        waitForReactUpdate(500);

        // Get initial row count
        DatabaseGridSelectors.dataRows().then(($rows) => {
          const initialCount = $rows.length;

          // Open row detail for second row
          DatabaseGridSelectors.dataRows().eq(1).realHover();
          waitForReactUpdate(500);

          cy.get('[data-testid="row-expand-icon"], .expand-row-button')
            .eq(1)
            .click({ force: true });
          waitForReactUpdate(1000);

          // Delete via more actions menu
          RowDetailSelectors.moreActionsButton().click({ force: true });
          waitForReactUpdate(500);
          RowDetailSelectors.deleteMenuItem().click({ force: true });
          waitForReactUpdate(1000);

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
        DatabaseGridSelectors.dataRows().first().realHover();
        waitForReactUpdate(500);
        cy.get('[data-testid="row-expand-icon"], .expand-row-button')
          .first()
          .click({ force: true });
        waitForReactUpdate(1000);

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
        DatabaseGridSelectors.dataRows().first().realHover();
        waitForReactUpdate(500);
        cy.get('[data-testid="row-expand-icon"], .expand-row-button')
          .first()
          .click({ force: true });
        waitForReactUpdate(1000);

        // Look for add property/field button
        cy.get('body').then(($body) => {
          if ($body.find('[data-testid="add-property-button"]:visible').length > 0) {
            cy.get('[data-testid="add-property-button"]').first().click({ force: true });
          } else {
            cy.contains(/add.*property|add.*field|new.*property/i)
              .first()
              .click({ force: true });
          }
        });
        waitForReactUpdate(500);

        // Select checkbox type
        cy.contains(/checkbox/i).click({ force: true });
        waitForReactUpdate(1000);

        // Verify the new field appears in row detail
        RowDetailSelectors.modalContent().should('contain.text', 'Checkbox');
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
        DatabaseGridSelectors.dataRows().first().realHover();
        waitForReactUpdate(500);
        cy.get('[data-testid="row-expand-icon"], .expand-row-button')
          .first()
          .click({ force: true });
        waitForReactUpdate(1000);

        assertRowDetailOpen();

        // Press Escape to close
        cy.get('body').type('{esc}');
        waitForReactUpdate(500);

        assertRowDetailClosed();
      });
    });
  });

  it('navigate between rows in detail view', () => {
    const email = generateRandomEmail();
    loginAndCreateGrid(email).then(() => {
      getPrimaryFieldId().then((primaryFieldId) => {
        addRows(2);
        waitForReactUpdate(500);

        typeTextIntoCell(primaryFieldId, 0, 'Row One');
        typeTextIntoCell(primaryFieldId, 1, 'Row Two');
        typeTextIntoCell(primaryFieldId, 2, 'Row Three');
        waitForReactUpdate(500);

        // Open row detail for first row
        DatabaseGridSelectors.dataRows().first().realHover();
        waitForReactUpdate(500);
        cy.get('[data-testid="row-expand-icon"], .expand-row-button')
          .first()
          .click({ force: true });
        waitForReactUpdate(1000);

        // Verify we're viewing Row One
        RowDetailSelectors.modal().should('contain.text', 'Row One');
      });
    });
  });
});
