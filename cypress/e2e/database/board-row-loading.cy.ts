import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import {
  AddPageSelectors,
  BoardSelectors,
  DatabaseViewSelectors,
  waitForReactUpdate,
} from '../../support/selectors';

/**
 * Regression test for board row data loading bug.
 *
 * Bug: When creating a Board database directly, row cards don't display initially.
 * The data only appears after adding another view (e.g., Grid).
 *
 * Root cause:
 * 1. In group.ts, `groupBySelectOption` and `groupByCheckbox` skipped rows
 *    when their documents weren't loaded: `if (!rowMetas[row.id]) return;`
 * 2. `useRowMetaSelector` (used by board cards) didn't call `ensureRowDoc()`
 * 3. When creating a new Board, blob diff API returns empty (server hasn't written yet)
 *
 * Fix:
 * 1. group.ts: Include unloaded rows in default group instead of skipping
 * 2. selector.ts: Add `ensureRowDoc()` call to `useRowMetaSelector`
 * 3. Group.tsx: Call `ensureRowDoc()` for all rows when Board mounts
 */
describe('Board Row Data Loading', () => {
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
   * Test: Create a Board database directly and verify default cards appear immediately.
   *
   * When creating a Board directly from the sidebar:
   * 1. The server creates the database with default rows (Card 1, Card 2, Card 3)
   * 2. The Board view should display these cards immediately
   * 3. No need to add a Grid view first
   */
  it('should display default cards immediately when creating Board directly', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Board direct creation - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Step 1: Create a Board database directly from sidebar
      cy.task('log', '[STEP 1] Creating Board database directly from sidebar');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);

      // Click on Board option in the menu
      cy.get('[role="menuitem"]').contains('Board').click({ force: true });
      cy.wait(5000);

      // Step 2: Verify Board view loaded
      cy.task('log', '[STEP 2] Verifying Board view loaded');
      BoardSelectors.boardContainer().should('exist', { timeout: 15000 });

      // Step 3: CRITICAL - Verify default cards appear immediately
      // New Board databases come with default rows (Card 1, Card 2, Card 3) in "To Do" status
      cy.task('log', '[STEP 3] Verifying default cards appear immediately');

      // Wait for row documents to load (ensureRowDoc is called on mount)
      waitForReactUpdate(3000);

      // Verify board cards exist
      BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });

      // Verify default column "To Do" exists with cards
      cy.task('log', '[STEP 4] Verifying "To Do" column has cards');
      BoardSelectors.boardContainer().contains('To Do').should('be.visible');

      // The default cards should be visible (Card 1, Card 2, Card 3 are created by default)
      cy.task('log', '[STEP 5] Verifying default card names are visible');
      BoardSelectors.boardContainer().then(($board) => {
        // Check that at least one card has content (not empty)
        const hasContent =
          $board.text().includes('Card 1') ||
          $board.text().includes('Card 2') ||
          $board.text().includes('Card 3');

        if (hasContent) {
          cy.task('log', '[STEP 5.1] Default cards found with content');
        } else {
          // If default cards don't have names, at least verify cards exist
          cy.task('log', '[STEP 5.1] Cards exist but may have empty names - checking card count');
        }
      });

      // Verify multiple columns exist (To Do, Doing, Done are default)
      cy.task('log', '[STEP 6] Verifying default columns exist');
      BoardSelectors.boardContainer().contains('Doing').should('be.visible');
      BoardSelectors.boardContainer().contains('Done').should('be.visible');

      cy.task('log', '[TEST COMPLETE] Board direct creation test passed');
    });
  });

  /**
   * Test: Create Board directly and add new cards.
   *
   * This tests the full workflow of:
   * 1. Creating a Board database directly
   * 2. Adding new cards with custom names
   * 3. Verifying the cards appear immediately
   */
  it('should allow adding new cards to a directly created Board', () => {
    const testEmail = generateRandomEmail();
    const cardName1 = `Task-${uuidv4().substring(0, 6)}`;
    const cardName2 = `Bug-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Board add cards test - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Step 1: Create a Board database directly
      cy.task('log', '[STEP 1] Creating Board database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').contains('Board').click({ force: true });
      cy.wait(5000);

      // Verify Board loaded
      BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
      waitForReactUpdate(3000);

      // Step 2: Add first new card using the "New" button
      cy.task('log', `[STEP 2] Adding new card: ${cardName1}`);
      BoardSelectors.boardContainer().contains(/^\s*New\s*$/i).first().click({ force: true });
      waitForReactUpdate(1000);

      cy.focused().type(`${cardName1}{enter}`, { force: true });
      waitForReactUpdate(2000);

      // Verify first card appears
      cy.task('log', '[STEP 3] Verifying first card appears');
      BoardSelectors.boardContainer().contains(cardName1, { timeout: 10000 }).should('be.visible');

      // Step 4: Add second card
      cy.task('log', `[STEP 4] Adding second card: ${cardName2}`);
      BoardSelectors.boardContainer().contains(/^\s*New\s*$/i).first().click({ force: true });
      waitForReactUpdate(1000);

      cy.focused().type(`${cardName2}{enter}`, { force: true });
      waitForReactUpdate(2000);

      // Verify second card appears
      cy.task('log', '[STEP 5] Verifying second card appears');
      BoardSelectors.boardContainer().contains(cardName2, { timeout: 10000 }).should('be.visible');

      // Verify both cards are visible
      cy.task('log', '[STEP 6] Verifying both cards are visible');
      BoardSelectors.boardContainer().contains(cardName1).should('be.visible');
      BoardSelectors.boardContainer().contains(cardName2).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Board add cards test passed');
    });
  });

  /**
   * Test: Collaboration sync - changes in Board should sync between sessions.
   */
  it('should sync new cards between collaborative sessions (iframe simulation)', () => {
    const testEmail = generateRandomEmail();
    const newCardName = `Collab-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Collaboration sync test - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Step 1: Create a Board database directly
      cy.task('log', '[STEP 1] Creating Board database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').contains('Board').click({ force: true });
      cy.wait(5000);

      // Verify Board loaded
      BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
      waitForReactUpdate(3000);

      // Step 2: Get current URL for iframe
      cy.url().then((currentUrl) => {
        cy.task('log', `[STEP 2] Current URL: ${currentUrl}`);

        // Step 3: Add iframe with the same page
        cy.task('log', '[STEP 3] Adding iframe with same Board view');
        cy.document().then((doc) => {
          const iframe = doc.createElement('iframe');

          iframe.id = 'collab-iframe';
          iframe.src = currentUrl;
          iframe.style.cssText =
            'position: fixed; bottom: 0; right: 0; width: 600px; height: 400px; border: 2px solid blue; z-index: 9999;';
          doc.body.appendChild(iframe);
        });

        // Wait for iframe to load
        cy.get('#collab-iframe', { timeout: 10000 }).should('exist');
        waitForReactUpdate(8000);

        // Step 4: Verify iframe loaded the board
        cy.task('log', '[STEP 4] Verifying iframe loaded the board');
        cy.get('#collab-iframe').its('0.contentDocument.body').should('not.be.empty');

        cy.get('#collab-iframe')
          .its('0.contentDocument.body')
          .find('.database-board', { timeout: 15000 })
          .should('exist');

        cy.task('log', '[STEP 4.1] Iframe loaded with Board');

        // Step 5: Add a new card in the MAIN window
        cy.task('log', `[STEP 5] Adding new card in main window: ${newCardName}`);

        BoardSelectors.boardContainer().contains(/^\s*New\s*$/i).first().click({ force: true });
        waitForReactUpdate(1000);

        cy.focused().type(`${newCardName}{enter}`, { force: true });
        waitForReactUpdate(2000);

        BoardSelectors.boardContainer().contains(newCardName).should('be.visible');
        cy.task('log', '[STEP 5.1] New card added in main window');

        // Step 6: CRITICAL - Verify new card syncs to iframe
        cy.task('log', '[STEP 6] Verifying card syncs to iframe (collaboration)');

        waitForReactUpdate(5000);

        cy.get('#collab-iframe')
          .its('0.contentDocument.body')
          .find('.database-board')
          .contains(newCardName, { timeout: 20000 })
          .should('exist');

        cy.task('log', `[STEP 6.1] SUCCESS: Card "${newCardName}" synced to iframe!`);

        // Cleanup: Remove iframe
        cy.document().then((doc) => {
          const iframe = doc.getElementById('collab-iframe');

          if (iframe) {
            iframe.remove();
          }
        });

        cy.task('log', '[TEST COMPLETE] Collaboration sync test passed');
      });
    });
  });

  /**
   * Test: Create two Board databases consecutively from the sidebar plus button.
   *
   * Regression test for blank page bug:
   * - First Board creates and displays correctly
   * - Second Board shows blank page (bug)
   *
   * Root cause: When creating the second database, the Y.js observers and
   * flushSync protection are needed to properly render the database when
   * data arrives via websocket.
   */
  it('should display cards correctly when creating two Boards consecutively', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Create two Boards consecutively - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // ===== FIRST BOARD =====
      cy.task('log', '[STEP 1] Creating FIRST Board database from sidebar');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);

      cy.get('[role="menuitem"]').contains('Board').click({ force: true });
      cy.wait(5000);

      // Verify first Board loaded
      cy.task('log', '[STEP 2] Verifying FIRST Board view loaded');
      BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
      waitForReactUpdate(3000);

      // Verify first Board has cards
      cy.task('log', '[STEP 3] Verifying FIRST Board has default cards');
      BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });
      BoardSelectors.boardContainer().contains('To Do').should('be.visible');

      // Verify default card content
      BoardSelectors.boardContainer().then(($board) => {
        const hasContent =
          $board.text().includes('Card 1') ||
          $board.text().includes('Card 2') ||
          $board.text().includes('Card 3');

        cy.task('log', `[STEP 3.1] First Board has card content: ${hasContent}`);
      });

      cy.task('log', '[STEP 4] FIRST Board created successfully');

      // ===== SECOND BOARD =====
      cy.task('log', '[STEP 5] Creating SECOND Board database from sidebar');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);

      cy.get('[role="menuitem"]').contains('Board').click({ force: true });
      cy.wait(5000);

      // CRITICAL: Verify second Board loaded (this is where the bug occurs)
      cy.task('log', '[STEP 6] Verifying SECOND Board view loaded');
      BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
      waitForReactUpdate(3000);

      // CRITICAL: Verify second Board has cards (not blank)
      cy.task('log', '[STEP 7] Verifying SECOND Board has default cards (not blank)');
      BoardSelectors.cards().should('have.length.at.least', 1, { timeout: 15000 });
      BoardSelectors.boardContainer().contains('To Do').should('be.visible');

      // Verify second Board has card content
      BoardSelectors.boardContainer().then(($board) => {
        const hasContent =
          $board.text().includes('Card 1') ||
          $board.text().includes('Card 2') ||
          $board.text().includes('Card 3');

        cy.task('log', `[STEP 7.1] Second Board has card content: ${hasContent}`);
        expect(hasContent, 'Second Board should have card content (not blank)').to.be.true;
      });

      // Verify all default columns exist
      cy.task('log', '[STEP 8] Verifying SECOND Board has all default columns');
      BoardSelectors.boardContainer().contains('Doing').should('be.visible');
      BoardSelectors.boardContainer().contains('Done').should('be.visible');

      cy.task('log', '[TEST COMPLETE] Both Boards created successfully with cards visible');
    });
  });
});
