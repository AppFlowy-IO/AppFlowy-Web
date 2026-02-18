/**
 * Board Operations E2E Tests
 *
 * Comprehensive tests for Board view functionality:
 * - Card operations (add, modify, delete)
 * - Card persistence and collaboration sync
 * - Consecutive board creation regression test
 */
import { v4 as uuidv4 } from 'uuid';
import {
  AddPageSelectors,
  BoardSelectors,
  RowDetailSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';

describe('Board Operations', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;

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

  /**
   * Helper: Create a Board and wait for it to load
   */
  const createBoardAndWait = (testEmail: string) => {
    return signInAndCreateDatabaseView(testEmail, 'Board', {
      verify: () => {
        BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
        waitForReactUpdate(3000);
        BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });
        BoardSelectors.boardContainer().contains('To Do').should('be.visible');
        BoardSelectors.boardContainer().contains('Doing').should('be.visible');
        BoardSelectors.boardContainer().contains('Done').should('be.visible');
      },
    });
  };

  describe('Board Creation', () => {
    /**
     * Regression test for blank page bug when creating second database.
     */
    it('should display cards correctly when creating two Boards consecutively', () => {
      const testEmail = generateRandomEmail();

      cy.task('log', `[TEST START] Create two Boards consecutively - Email: ${testEmail}`);

      cy.signIn(testEmail).then(() => {
        cy.url({ timeout: 30000 }).should('include', '/app');
        cy.wait(3000);

        // ===== FIRST BOARD =====
        cy.task('log', '[STEP 1] Creating FIRST Board database');
        AddPageSelectors.inlineAddButton().first().click({ force: true });
        waitForReactUpdate(1000);
        cy.get('[role="menuitem"]').contains('Board').click({ force: true });
        cy.wait(5000);

        BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
        waitForReactUpdate(3000);
        BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });
        BoardSelectors.boardContainer().contains('To Do').should('be.visible');

        // ===== SECOND BOARD =====
        cy.task('log', '[STEP 2] Creating SECOND Board database');
        AddPageSelectors.inlineAddButton().first().click({ force: true });
        waitForReactUpdate(1000);
        cy.get('[role="menuitem"]').contains('Board').click({ force: true });
        cy.wait(5000);

        // CRITICAL: Verify second Board loaded (not blank)
        BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
        waitForReactUpdate(3000);
        BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });
        BoardSelectors.boardContainer().contains('To Do').should('be.visible');
        BoardSelectors.boardContainer().contains('Doing').should('be.visible');
        BoardSelectors.boardContainer().contains('Done').should('be.visible');

        cy.task('log', '[TEST COMPLETE] Both Boards created successfully');
      });
    });
  });

  describe('Card Operations', () => {
    it('should add cards to different columns', () => {
      const testEmail = generateRandomEmail();
      const todoCard = `Todo-${uuidv4().substring(0, 6)}`;
      const doingCard = `Doing-${uuidv4().substring(0, 6)}`;
      const doneCard = `Done-${uuidv4().substring(0, 6)}`;

      cy.task('log', `[TEST START] Add cards to different columns - Email: ${testEmail}`);

      createBoardAndWait(testEmail).then(() => {
        // Add card to "To Do"
        BoardSelectors.boardContainer()
          .contains('To Do')
          .closest('[data-column-id]')
          .within(() => {
            cy.contains('New').click({ force: true });
          });
        waitForReactUpdate(500);
        cy.focused().type(`${todoCard}{enter}`, { force: true });
        waitForReactUpdate(1500);

        // Add card to "Doing"
        BoardSelectors.boardContainer()
          .contains('Doing')
          .closest('[data-column-id]')
          .within(() => {
            cy.contains('New').click({ force: true });
          });
        waitForReactUpdate(500);
        cy.focused().type(`${doingCard}{enter}`, { force: true });
        waitForReactUpdate(1500);

        // Add card to "Done"
        BoardSelectors.boardContainer()
          .contains('Done')
          .closest('[data-column-id]')
          .within(() => {
            cy.contains('New').click({ force: true });
          });
        waitForReactUpdate(500);
        cy.focused().type(`${doneCard}{enter}`, { force: true });
        waitForReactUpdate(1500);

        // Verify all cards
        BoardSelectors.boardContainer().contains(todoCard).should('be.visible');
        BoardSelectors.boardContainer().contains(doingCard).should('be.visible');
        BoardSelectors.boardContainer().contains(doneCard).should('be.visible');

        cy.task('log', '[TEST COMPLETE] Add cards to different columns test passed');
      });
    });

    it('should modify card title through detail view', () => {
      const testEmail = generateRandomEmail();
      const originalName = `Original-${uuidv4().substring(0, 6)}`;
      const modifiedName = `Modified-${uuidv4().substring(0, 6)}`;

      cy.task('log', `[TEST START] Modify card title - Email: ${testEmail}`);

      createBoardAndWait(testEmail).then(() => {
        // Add a new card
        BoardSelectors.boardContainer().contains('New').first().click({ force: true });
        waitForReactUpdate(500);
        cy.focused().type(`${originalName}{enter}`, { force: true });
        waitForReactUpdate(2000);

        // Open card detail modal
        BoardSelectors.boardContainer().contains(originalName).click({ force: true });
        waitForReactUpdate(1500);

        // Verify modal opened
        cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');
        cy.get('[role="dialog"]').contains(originalName, { timeout: 10000 }).should('be.visible');

        // Modify title
        RowDetailSelectors.titleInput()
          .should('be.visible')
          .click({ force: true })
          .then(($input) => {
            cy.wrap($input).clear().type(modifiedName, { force: true });
          });

        waitForReactUpdate(2000);

        // Close modal
        cy.get('body').type('{esc}', { force: true });
        waitForReactUpdate(2000);

        // Verify modified name
        BoardSelectors.boardContainer().contains(modifiedName, { timeout: 10000 }).should('be.visible');
        BoardSelectors.boardContainer().should('not.contain', originalName);

        cy.task('log', '[TEST COMPLETE] Modify card title test passed');
      });
    });

    it('should delete a card from the board', () => {
      const testEmail = generateRandomEmail();
      const cardToDelete = `DeleteMe-${uuidv4().substring(0, 6)}`;

      cy.task('log', `[TEST START] Delete card - Email: ${testEmail}`);

      createBoardAndWait(testEmail).then(() => {
        // Add a new card
        BoardSelectors.boardContainer().contains('New').first().click({ force: true });
        waitForReactUpdate(500);
        cy.focused().type(`${cardToDelete}{enter}`, { force: true });
        waitForReactUpdate(2000);

        BoardSelectors.boardContainer().contains(cardToDelete).should('be.visible');

        // Hover to show toolbar
        BoardSelectors.boardContainer()
          .contains(cardToDelete)
          .closest('.board-card')
          .trigger('mouseenter', { force: true });
        waitForReactUpdate(500);

        // Click more button
        BoardSelectors.boardContainer()
          .contains(cardToDelete)
          .closest('.board-card')
          .find('button')
          .last()
          .click({ force: true });
        waitForReactUpdate(500);

        // Click delete
        cy.get('[role="menuitem"]').contains(/delete/i).click({ force: true });
        waitForReactUpdate(500);

        // Confirm delete
        RowDetailSelectors.deleteRowConfirmButton().click({ force: true });
        waitForReactUpdate(2000);

        // Verify deleted
        BoardSelectors.boardContainer().should('not.contain', cardToDelete, { timeout: 15000 });

        cy.task('log', '[TEST COMPLETE] Delete card test passed');
      });
    });

    it('should handle rapid card creation', () => {
      const testEmail = generateRandomEmail();
      const cardPrefix = `Rapid-${uuidv4().substring(0, 4)}`;
      const cardCount = 5;

      cy.task('log', `[TEST START] Rapid card creation - Email: ${testEmail}`);

      createBoardAndWait(testEmail).then(() => {
        // Add multiple cards rapidly
        for (let i = 1; i <= cardCount; i++) {
          BoardSelectors.boardContainer().contains('New').first().click({ force: true });
          waitForReactUpdate(300);
          cy.focused().type(`${cardPrefix}-${i}{enter}`, { force: true });
          waitForReactUpdate(500);
        }

        waitForReactUpdate(3000);

        // Verify all cards
        for (let i = 1; i <= cardCount; i++) {
          BoardSelectors.boardContainer()
            .contains(`${cardPrefix}-${i}`, { timeout: 10000 })
            .should('be.visible');
        }

        BoardSelectors.cards().should('have.length.at.least', cardCount);

        cy.task('log', '[TEST COMPLETE] Rapid card creation test passed');
      });
    });

    it('should preserve row document content when reopening card multiple times', () => {
      const testEmail = generateRandomEmail();
      const cardName = `Reopen-${uuidv4().substring(0, 6)}`;
      const documentContent = `Content-${uuidv4().substring(0, 8)}`;
      const reopenCount = 3;

      cy.task('log', `[TEST START] Card reopen test - Email: ${testEmail}`);

      createBoardAndWait(testEmail).then(() => {
        // Add a new card
        BoardSelectors.boardContainer().contains('New').first().click({ force: true });
        waitForReactUpdate(500);
        cy.focused().type(`${cardName}{enter}`, { force: true });
        waitForReactUpdate(2000);

        BoardSelectors.boardContainer().contains(cardName).should('be.visible');

        // Open card and add content to the row document
        BoardSelectors.boardContainer().contains(cardName).click({ force: true });
        waitForReactUpdate(1500);

        cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');

        // Type content in the row document area (below properties)
        cy.get('[role="dialog"]').find('[data-block-type]').first().click({ force: true });
        waitForReactUpdate(500);
        cy.focused().type(documentContent, { force: true });
        waitForReactUpdate(2000);

        // Close modal
        cy.get('body').type('{esc}', { force: true });
        waitForReactUpdate(2000);

        // Reopen the card multiple times and verify content persists
        for (let i = 1; i <= reopenCount; i++) {
          cy.task('log', `[REOPEN ${i}/${reopenCount}] Opening card`);

          BoardSelectors.boardContainer().contains(cardName).click({ force: true });
          waitForReactUpdate(1500);

          cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');

          // Verify the document content is still there
          cy.get('[role="dialog"]').contains(documentContent, { timeout: 10000 }).should('exist');

          // Close modal
          cy.get('body').type('{esc}', { force: true });
          waitForReactUpdate(1500);
        }

        cy.task('log', '[TEST COMPLETE] Card reopen test passed');
      });
    });
  });

  describe('Card Persistence', () => {
    it('should persist card after page refresh', () => {
      const testEmail = generateRandomEmail();
      const persistentCard = `Persist-${uuidv4().substring(0, 6)}`;

      cy.task('log', `[TEST START] Card persistence - Email: ${testEmail}`);

      createBoardAndWait(testEmail).then(() => {
        // Add card
        BoardSelectors.boardContainer().contains('New').first().click({ force: true });
        waitForReactUpdate(500);
        cy.focused().type(`${persistentCard}{enter}`, { force: true });
        waitForReactUpdate(2000);

        BoardSelectors.boardContainer().contains(persistentCard).should('be.visible');

        // Wait for sync and refresh
        waitForReactUpdate(3000);
        cy.reload();
        cy.wait(5000);

        // Verify persisted
        BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
        waitForReactUpdate(3000);
        BoardSelectors.boardContainer().contains(persistentCard, { timeout: 10000 }).should('be.visible');

        cy.task('log', '[TEST COMPLETE] Card persistence test passed');
      });
    });

    it('should sync new cards between collaborative sessions (iframe simulation)', () => {
      const testEmail = generateRandomEmail();
      const newCardName = `Collab-${uuidv4().substring(0, 6)}`;

      cy.task('log', `[TEST START] Collaboration sync - Email: ${testEmail}`);

      createBoardAndWait(testEmail).then(() => {
        cy.url().then((currentUrl) => {
          // Add iframe with same page
          cy.document().then((doc) => {
            const iframe = doc.createElement('iframe');
            iframe.id = 'collab-iframe';
            iframe.src = currentUrl;
            iframe.style.cssText =
              'position: fixed; bottom: 0; right: 0; width: 600px; height: 400px; border: 2px solid blue; z-index: 9999;';
            doc.body.appendChild(iframe);
          });

          cy.get('#collab-iframe', { timeout: 10000 }).should('exist');
          waitForReactUpdate(8000);

          // Verify iframe loaded
          cy.get('#collab-iframe')
            .its('0.contentDocument.body')
            .find('.database-board', { timeout: 15000 })
            .should('exist');

          // Add card in main window
          BoardSelectors.boardContainer().contains(/^\s*New\s*$/i).first().click({ force: true });
          waitForReactUpdate(1000);
          cy.focused().type(`${newCardName}{enter}`, { force: true });
          waitForReactUpdate(2000);

          BoardSelectors.boardContainer().contains(newCardName).should('be.visible');

          // Verify synced to iframe
          waitForReactUpdate(5000);
          cy.get('#collab-iframe')
            .its('0.contentDocument.body')
            .find('.database-board')
            .contains(newCardName, { timeout: 20000 })
            .should('exist');

          // Cleanup
          cy.document().then((doc) => {
            const iframe = doc.getElementById('collab-iframe');
            if (iframe) iframe.remove();
          });

          cy.task('log', '[TEST COMPLETE] Collaboration sync test passed');
        });
      });
    });
  });
});
