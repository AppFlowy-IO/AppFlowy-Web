import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import {
  AddPageSelectors,
  BoardSelectors,
  RowDetailSelectors,
  waitForReactUpdate,
} from '../../support/selectors';

/**
 * E2E tests for Board card operations.
 *
 * Tests cover:
 * 1. Adding new cards to specific columns
 * 2. Modifying card titles (inline editing)
 * 3. Opening card detail modal and editing properties
 * 4. Deleting cards
 */
describe('Board Card Operations', () => {
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
  const createBoardAndWait = (authUtils: AuthTestUtils, testEmail: string) => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    return authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create Board
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').contains('Board').click({ force: true });
      cy.wait(5000);

      // Verify Board loaded
      BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
      waitForReactUpdate(3000);

      // Wait for default cards to load
      BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });
    });
  };

  /**
   * Test: Add a new card to a specific column
   */
  it('should add a new card to the To Do column', () => {
    const testEmail = generateRandomEmail();
    const cardName = `NewTask-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Add card to column - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();

    createBoardAndWait(authUtils, testEmail).then(() => {
      // Step 1: Find the "To Do" column and click its "New" button
      cy.task('log', '[STEP 1] Finding To Do column New button');

      // Get the column containing "To Do" and find its New button
      // The column has data-column-id attribute
      BoardSelectors.boardContainer()
        .contains('To Do')
        .closest('[data-column-id]')
        .within(() => {
          cy.contains('New').click({ force: true });
        });

      waitForReactUpdate(1000);

      // Step 2: Type the card name
      cy.task('log', `[STEP 2] Typing card name: ${cardName}`);
      cy.focused().type(`${cardName}{enter}`, { force: true });
      waitForReactUpdate(2000);

      // Step 3: Verify the card appears in the board
      cy.task('log', '[STEP 3] Verifying card appears');
      BoardSelectors.boardContainer().contains(cardName, { timeout: 10000 }).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Add card to column test passed');
    });
  });

  /**
   * Test: Add cards to different columns (To Do, Doing, Done)
   */
  it('should add cards to different columns', () => {
    const testEmail = generateRandomEmail();
    const todoCard = `Todo-${uuidv4().substring(0, 6)}`;
    const doingCard = `Doing-${uuidv4().substring(0, 6)}`;
    const doneCard = `Done-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Add cards to different columns - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();

    createBoardAndWait(authUtils, testEmail).then(() => {
      // Add card to "To Do" column
      cy.task('log', '[STEP 1] Adding card to To Do column');
      BoardSelectors.boardContainer().contains('New').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${todoCard}{enter}`, { force: true });
      waitForReactUpdate(1500);

      // Add card to "Doing" column - find the New button in Doing column
      cy.task('log', '[STEP 2] Adding card to Doing column');
      BoardSelectors.boardContainer()
        .contains('Doing')
        .closest('[data-column-id]')
        .within(() => {
          cy.contains('New').click({ force: true });
        });
      waitForReactUpdate(500);
      cy.focused().type(`${doingCard}{enter}`, { force: true });
      waitForReactUpdate(1500);

      // Add card to "Done" column
      cy.task('log', '[STEP 3] Adding card to Done column');
      BoardSelectors.boardContainer()
        .contains('Done')
        .closest('[data-column-id]')
        .within(() => {
          cy.contains('New').click({ force: true });
        });
      waitForReactUpdate(500);
      cy.focused().type(`${doneCard}{enter}`, { force: true });
      waitForReactUpdate(1500);

      // Verify all cards are visible
      cy.task('log', '[STEP 4] Verifying all cards are visible');
      BoardSelectors.boardContainer().contains(todoCard).should('be.visible');
      BoardSelectors.boardContainer().contains(doingCard).should('be.visible');
      BoardSelectors.boardContainer().contains(doneCard).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Add cards to different columns test passed');
    });
  });

  /**
   * Test: Open a card and view its details
   */
  it('should open card detail modal when clicking a card', () => {
    const testEmail = generateRandomEmail();
    const cardName = `ClickMe-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Open card detail modal - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();

    createBoardAndWait(authUtils, testEmail).then(() => {
      // Step 1: Add a new card
      cy.task('log', '[STEP 1] Adding a new card');
      BoardSelectors.boardContainer().contains('New').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${cardName}{enter}`, { force: true });
      waitForReactUpdate(2000);

      // Step 2: Click on the card to open detail modal
      cy.task('log', '[STEP 2] Clicking on card to open detail modal');
      BoardSelectors.boardContainer().contains(cardName).click({ force: true });
      waitForReactUpdate(1500);

      // Step 3: Verify modal opened (check for MUI Dialog with row content)
      cy.task('log', '[STEP 3] Verifying detail modal/page opened');
      // In edit mode, clicking a card opens a modal (not URL-based navigation)
      cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');

      // Step 4: Verify card name is visible in the detail view
      cy.task('log', '[STEP 4] Verifying card name in detail view');
      cy.get('[role="dialog"]').contains(cardName, { timeout: 10000 }).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Open card detail modal test passed');
    });
  });

  /**
   * Test: Modify card title through inline editing
   */
  it('should modify card title inline', () => {
    const testEmail = generateRandomEmail();
    const originalName = `Original-${uuidv4().substring(0, 6)}`;
    const modifiedName = `Modified-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Modify card title inline - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();

    createBoardAndWait(authUtils, testEmail).then(() => {
      // Step 1: Add a new card
      cy.task('log', '[STEP 1] Adding a new card');
      BoardSelectors.boardContainer().contains('New').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${originalName}{enter}`, { force: true });
      waitForReactUpdate(2000);

      // Step 2: Verify original card appears
      cy.task('log', '[STEP 2] Verifying original card appears');
      BoardSelectors.boardContainer().contains(originalName).should('be.visible');

      // Step 3: Double-click on the card to edit inline (or click to open and edit)
      cy.task('log', '[STEP 3] Opening card to edit');
      BoardSelectors.boardContainer().contains(originalName).click({ force: true });
      waitForReactUpdate(1500);

      // Step 4: Modify the title in the detail view
      cy.task('log', '[STEP 4] Modifying title in detail view');

      // Find the row title input (not the sub-document editor) and modify it
      RowDetailSelectors.titleInput()
        .should('be.visible')
        .click({ force: true })
        .then(($input) => {
          // Clear and type the new name
          cy.wrap($input).clear().type(modifiedName, { force: true });
        });

      waitForReactUpdate(2000);

      // Step 5: Close the modal to go back to board view
      cy.task('log', '[STEP 5] Closing modal to go back to board view');
      // Click outside the dialog or press Escape to close the modal
      cy.get('body').type('{esc}', { force: true });
      waitForReactUpdate(2000);

      // Step 6: Verify the modified name appears
      cy.task('log', '[STEP 6] Verifying modified name appears on board');
      BoardSelectors.boardContainer().contains(modifiedName, { timeout: 10000 }).should('be.visible');

      // Verify original name no longer appears
      BoardSelectors.boardContainer().should('not.contain', originalName);

      cy.task('log', '[TEST COMPLETE] Modify card title inline test passed');
    });
  });

  /**
   * Test: Delete a card from the board
   */
  it('should delete a card from the board', () => {
    const testEmail = generateRandomEmail();
    const cardToDelete = `DeleteMe-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Delete card from board - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();

    createBoardAndWait(authUtils, testEmail).then(() => {
      // Step 1: Add a new card
      cy.task('log', '[STEP 1] Adding a new card to delete');
      BoardSelectors.boardContainer().contains('New').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${cardToDelete}{enter}`, { force: true });
      waitForReactUpdate(2000);

      // Step 2: Verify card exists
      cy.task('log', '[STEP 2] Verifying card exists');
      BoardSelectors.boardContainer().contains(cardToDelete).should('be.visible');

      // Step 3: Hover over the card to show the toolbar and delete from board view
      // (Delete from board view is more reliable than from row detail page)
      cy.task('log', '[STEP 3] Hovering over card to show toolbar');
      BoardSelectors.boardContainer()
        .contains(cardToDelete)
        .closest('.board-card')
        .trigger('mouseenter', { force: true });
      waitForReactUpdate(500);

      // Step 4: Click the more button in the card toolbar
      cy.task('log', '[STEP 4] Clicking more button in card toolbar');
      // The CardToolbar appears on hover with a more button (MoreIcon)
      BoardSelectors.boardContainer()
        .contains(cardToDelete)
        .closest('.board-card')
        .find('button')
        .last()
        .click({ force: true });
      waitForReactUpdate(500);

      // Step 5: Click delete from dropdown menu
      cy.task('log', '[STEP 5] Clicking delete option');
      cy.get('[role="menuitem"]').contains(/delete/i).click({ force: true });
      waitForReactUpdate(500);

      // Step 6: Confirm delete in the dialog
      cy.task('log', '[STEP 6] Confirming delete');
      RowDetailSelectors.deleteRowConfirmButton().click({ force: true });
      waitForReactUpdate(2000);

      // Step 7: Verify card is deleted
      cy.task('log', '[STEP 7] Verifying card is deleted');
      BoardSelectors.boardContainer().should('not.contain', cardToDelete, { timeout: 15000 });

      cy.task('log', '[TEST COMPLETE] Delete card from board test passed');
    });
  });

  /**
   * Test: Add multiple cards rapidly and verify they all appear
   */
  it('should handle rapid card creation', () => {
    const testEmail = generateRandomEmail();
    const cardPrefix = `Rapid-${uuidv4().substring(0, 4)}`;
    const cardCount = 5;

    cy.task('log', `[TEST START] Rapid card creation - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();

    createBoardAndWait(authUtils, testEmail).then(() => {
      // Add multiple cards rapidly
      for (let i = 1; i <= cardCount; i++) {
        cy.task('log', `[STEP ${i}] Adding card ${i} of ${cardCount}`);
        BoardSelectors.boardContainer().contains('New').first().click({ force: true });
        waitForReactUpdate(300);
        cy.focused().type(`${cardPrefix}-${i}{enter}`, { force: true });
        waitForReactUpdate(500);
      }

      // Wait for all cards to sync
      waitForReactUpdate(3000);

      // Verify all cards appear
      cy.task('log', '[VERIFICATION] Checking all cards are visible');
      for (let i = 1; i <= cardCount; i++) {
        BoardSelectors.boardContainer()
          .contains(`${cardPrefix}-${i}`, { timeout: 10000 })
          .should('be.visible');
      }

      // Verify total card count increased
      cy.task('log', '[VERIFICATION] Checking card count');
      BoardSelectors.cards().should('have.length.at.least', cardCount);

      cy.task('log', '[TEST COMPLETE] Rapid card creation test passed');
    });
  });

  /**
   * Test: Verify card persists after page refresh
   */
  it('should persist card after page refresh', () => {
    const testEmail = generateRandomEmail();
    const persistentCard = `Persist-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Card persistence after refresh - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();

    createBoardAndWait(authUtils, testEmail).then(() => {
      // Step 1: Add a new card
      cy.task('log', '[STEP 1] Adding a new card');
      BoardSelectors.boardContainer().contains('New').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${persistentCard}{enter}`, { force: true });
      waitForReactUpdate(2000);

      // Step 2: Verify card exists
      cy.task('log', '[STEP 2] Verifying card exists before refresh');
      BoardSelectors.boardContainer().contains(persistentCard).should('be.visible');

      // Step 3: Wait for sync to complete
      cy.task('log', '[STEP 3] Waiting for sync');
      waitForReactUpdate(3000);

      // Step 4: Refresh the page
      cy.task('log', '[STEP 4] Refreshing page');
      cy.reload();
      cy.wait(5000);

      // Step 5: Verify board loads
      cy.task('log', '[STEP 5] Verifying board loads after refresh');
      BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
      waitForReactUpdate(3000);

      // Step 6: Verify card still exists
      cy.task('log', '[STEP 6] Verifying card persists after refresh');
      BoardSelectors.boardContainer().contains(persistentCard, { timeout: 10000 }).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Card persistence after refresh test passed');
    });
  });
});
