import { v4 as uuidv4 } from 'uuid';
import {
  AddPageSelectors,
  BoardSelectors,
  RowDetailSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { closeRowDetailWithEscape, typeInRowDocument } from '../../support/row-detail-helpers';
import { generateRandomEmail } from '../../support/test-config';

/**
 * Row Document indicator test (Board view).
 *
 * Flow:
 * 1) Create a Board database
 * 2) Add a new card
 * 3) Open row detail modal
 * 4) Type into row document
 * 5) Verify row document indicator appears on the card
 */
describe('Row Document Test', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return false;
      }

      return true;
    });

    cy.viewport(1280, 720);
  });

  const createBoardAndWait = (testEmail: string) => {
    return signInAndCreateDatabaseView(testEmail, 'Board', {
      verify: () => {
        BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
        waitForReactUpdate(3000);
        BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });
      },
    });
  };

  /**
   * Test: Row document content persists after closing and reopening modal
   */
  it('should persist row document content after closing and reopening modal', () => {
    const testEmail = generateRandomEmail();
    const cardName = `Persist-${uuidv4().substring(0, 6)}`;
    const docText = `persist-test-${uuidv4().substring(0, 6)}`;


    createBoardAndWait(testEmail).then(() => {
      // Step 1: Add a new card
      cy.task('log', '[STEP 1] Adding a new card');
      BoardSelectors.boardContainer()
        .contains('To Do')
        .closest('[data-column-id]')
        .within(() => {
          cy.contains('New').click({ force: true });
        });
      waitForReactUpdate(1000);
      cy.focused().type(`${cardName}{enter}`, { force: true });
      waitForReactUpdate(2000);

      // Step 2: Open row detail modal
      cy.task('log', '[STEP 2] Opening row detail modal');
      BoardSelectors.boardContainer().contains(cardName).click({ force: true });
      RowDetailSelectors.modal().should('exist');
      RowDetailSelectors.documentArea().should('exist');

      // Step 3: Type into row document
      cy.task('log', '[STEP 3] Typing into row document');
      // Wait for the editor to load - it may take time to fetch/create the document
      waitForReactUpdate(3000);

      // Scroll down to make sure editor is visible
      cy.get('[role="dialog"]')
        .find('.appflowy-scroll-container')
        .scrollTo('bottom');
      waitForReactUpdate(1000);

      // Wait for the editor to be ready (not skeleton)
      cy.get('[role="dialog"]')
        .find('[data-testid="editor-content"], [role="textbox"][contenteditable="true"]', { timeout: 15000 })
        .should('exist')
        .first()
        .click({ force: true });

      // Type multiple lines with Enter key
      const line1 = `Line1-${docText}`;
      const line2 = `Line2-${docText}`;
      const line3 = `Line3-${docText}`;
      cy.focused().type(`${line1}{enter}${line2}{enter}${line3}`, { delay: 50 });
      waitForReactUpdate(2000);

      // Verify all lines are there before closing
      cy.get('[role="dialog"]').should('contain.text', line1);
      cy.get('[role="dialog"]').should('contain.text', line2);
      cy.get('[role="dialog"]').should('contain.text', line3);

      // Step 4: Close the modal
      cy.task('log', '[STEP 4] Closing modal');
      // Click outside the editor first to remove focus, then press Escape
      cy.get('[role="dialog"]').find('.MuiDialogTitle-root, [data-testid="row-detail-header"]').first().click({ force: true });
      waitForReactUpdate(500);
      closeRowDetailWithEscape();
      // Verify modal is closed
      cy.get('[role="dialog"]').should('not.exist');
      waitForReactUpdate(3000); // Wait longer so user can observe

      // Step 5: Reopen the same card
      cy.task('log', '[STEP 5] Reopening row detail modal - clicking card again');
      BoardSelectors.boardContainer().contains(cardName).should('be.visible').click({ force: true });
      RowDetailSelectors.modal().should('exist');
      RowDetailSelectors.documentArea().should('exist');
      waitForReactUpdate(2000);

      // Step 6: Verify content persisted
      cy.task('log', '[STEP 6] Verifying content persisted');
      // Wait for the editor to load
      waitForReactUpdate(3000);

      // Scroll down to make sure editor is visible
      cy.get('[role="dialog"]')
        .find('.appflowy-scroll-container')
        .scrollTo('bottom');
      waitForReactUpdate(1000);

      // Wait for editor to load and verify all lines persisted
      cy.get('[role="dialog"]')
        .find('[data-testid="editor-content"], [role="textbox"]', { timeout: 15000 })
        .should('exist');
      cy.get('[role="dialog"]').should('contain.text', `Line1-${docText}`);
      cy.get('[role="dialog"]').should('contain.text', `Line2-${docText}`);
      cy.get('[role="dialog"]').should('contain.text', `Line3-${docText}`);

      cy.task('log', '[TEST COMPLETE] Row document content persistence test passed');
    });
  });

  /**
   * Test: Focus should not be lost while typing in row document
   * This tests the fix for the bug where typing would lose focus after a few characters
   * due to the effect re-running when meta changes.
   */
  it('should maintain focus while typing continuously', () => {
    const testEmail = generateRandomEmail();
    const cardName = `Focus-${uuidv4().substring(0, 6)}`;


    createBoardAndWait(testEmail).then(() => {
      // Add a new card
      BoardSelectors.boardContainer()
        .contains('To Do')
        .closest('[data-column-id]')
        .within(() => {
          cy.contains('New').click({ force: true });
        });
      waitForReactUpdate(1000);
      cy.focused().type(`${cardName}{enter}`, { force: true });
      waitForReactUpdate(2000);

      // Open row detail modal
      BoardSelectors.boardContainer().contains(cardName).click({ force: true });
      RowDetailSelectors.modal().should('exist');

      // Wait for editor to load
      waitForReactUpdate(3000);

      // Scroll down to make sure editor is visible
      cy.get('[role="dialog"]')
        .find('.appflowy-scroll-container')
        .scrollTo('bottom');
      waitForReactUpdate(1000);

      // Click into editor
      cy.get('[role="dialog"]')
        .find('[data-testid="editor-content"], [role="textbox"][contenteditable="true"]', { timeout: 15000 })
        .should('exist')
        .first()
        .click({ force: true });

      // Type a long sentence with delays to simulate real typing
      // This would previously fail because focus would be lost after ~2 seconds
      const longText = 'This is a test sentence that should be typed without losing focus even after several seconds of typing';
      cy.focused().type(longText, { delay: 50 }); // ~5 seconds of typing

      // Verify the full text was typed (focus was maintained)
      cy.get('[role="dialog"]').should('contain.text', longText);

      // Close and verify content persisted
      cy.get('[role="dialog"]').find('.MuiDialogTitle-root, [data-testid="row-detail-header"]').first().click({ force: true });
      waitForReactUpdate(500);
      closeRowDetailWithEscape();
      waitForReactUpdate(2000);

      // Reopen and verify
      BoardSelectors.boardContainer().contains(cardName).click({ force: true });
      RowDetailSelectors.modal().should('exist');
      waitForReactUpdate(3000);
      cy.get('[role="dialog"]').should('contain.text', longText);
    });
  });

  it('shows row document indicator after editing row document', () => {
    const testEmail = generateRandomEmail();
    const cardName = `RowDoc-${uuidv4().substring(0, 6)}`;
    const docText = `row-doc-${uuidv4().substring(0, 6)}`;


    createBoardAndWait(testEmail).then(() => {
      // Add a new card to "To Do"
      BoardSelectors.boardContainer()
        .contains('To Do')
        .closest('[data-column-id]')
        .within(() => {
          cy.contains('New').click({ force: true });
        });
      waitForReactUpdate(1000);

      cy.focused().type(`${cardName}{enter}`, { force: true });
      waitForReactUpdate(2000);

      BoardSelectors.boardContainer().contains(cardName, { timeout: 10000 }).should('be.visible');

      // Open row detail modal
      BoardSelectors.boardContainer().contains(cardName).click({ force: true });
      RowDetailSelectors.modal().should('exist');

      // Wait for editor to load
      waitForReactUpdate(3000);

      // Scroll down to make sure editor is visible
      cy.get('[role="dialog"]')
        .find('.appflowy-scroll-container')
        .scrollTo('bottom');
      waitForReactUpdate(1000);

      // Edit row document - wait for editor and type
      cy.get('[role="dialog"]')
        .find('[data-testid="editor-content"], [role="textbox"][contenteditable="true"]', { timeout: 15000 })
        .should('exist')
        .first()
        .click({ force: true })
        .type(docText, { delay: 30 });
      waitForReactUpdate(1000);

      // Close modal
      closeRowDetailWithEscape();
      waitForReactUpdate(1000);

      // Verify document indicator appears on the card
      BoardSelectors.boardContainer()
        .contains(cardName)
        .closest('.board-card')
        .within(() => {
          cy.get('.custom-icon', { timeout: 15000 }).should('exist');
        });
    });
  });
});
