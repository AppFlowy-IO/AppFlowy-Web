import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  SingleSelectSelectors,
  waitForReactUpdate,
} from '../../support/selectors';

/**
 * Regression test for board row data loading bug.
 *
 * Bug: When opening a Board view, row cards don't display data initially.
 * The data only appears after switching to another view (e.g., Grid) and back.
 *
 * Root cause:
 * 1. In group.ts, `groupBySelectOption` and `groupByCheckbox` skipped rows
 *    when their documents weren't loaded: `if (!rowMetas[row.id]) return;`
 * 2. `useRowMetaSelector` (used by board cards) didn't call `ensureRowDoc()`
 *
 * Fix:
 * 1. group.ts: Include unloaded rows in default group instead of skipping
 * 2. selector.ts: Add `ensureRowDoc()` call to `useRowMetaSelector`
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
   * Regression test: Board view should display row cards with content on first load.
   *
   * Previously, board cards would be empty or not render until:
   * 1. User switches to Grid view, OR
   * 2. User creates a new view
   *
   * This was because:
   * - groupBySelectOption skipped rows without loaded docs
   * - useRowMetaSelector didn't trigger row document loading
   */
  it('should display cards with row names in Board view on initial load', () => {
    const testEmail = generateRandomEmail();
    const rowName1 = `Card-${uuidv4().substring(0, 6)}`;
    const rowName2 = `Task-${uuidv4().substring(0, 6)}`;
    const selectOption = 'To Do';

    cy.task('log', `[TEST START] Board row data loading - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Step 1: Create a Grid database
      cy.task('log', '[STEP 1] Creating Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Verify grid loaded
      DatabaseGridSelectors.grid().should('exist', { timeout: 15000 });
      DatabaseGridSelectors.cells().should('have.length.at.least', 1);

      // Step 2: Add first row with name
      cy.task('log', `[STEP 2] Adding first row: ${rowName1}`);
      DatabaseGridSelectors.dataRows().first().find('.grid-cell').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${rowName1}{enter}`, { force: true });
      waitForReactUpdate(1000);

      // Step 3: Set select option for first row
      cy.task('log', `[STEP 3] Setting select option "${selectOption}" for first row`);
      SingleSelectSelectors.allSelectOptionCells().first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${selectOption}{enter}`, { force: true });
      waitForReactUpdate(1000);

      // Step 4: Add second row with name
      cy.task('log', `[STEP 4] Adding second row: ${rowName2}`);
      DatabaseGridSelectors.dataRows().eq(1).find('.grid-cell').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${rowName2}{enter}`, { force: true });
      waitForReactUpdate(1000);

      // Step 5: Set same select option for second row
      cy.task('log', `[STEP 5] Setting select option "${selectOption}" for second row`);
      SingleSelectSelectors.allSelectOptionCells().eq(1).click({ force: true });
      waitForReactUpdate(500);
      cy.contains(selectOption).click({ force: true });
      waitForReactUpdate(1000);

      // Step 6: Create a Board view
      cy.task('log', '[STEP 6] Creating Board view');
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(500);

      cy.get('[role="menu"], [role="listbox"], .MuiMenu-list, .MuiPopover-paper', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });

      waitForReactUpdate(3000);

      // Step 7: Verify Board view is active
      cy.task('log', '[STEP 7] Verifying Board view is active');
      DatabaseViewSelectors.activeViewTab().should('contain.text', 'Board');

      // Step 8: CRITICAL - Verify cards appear with content immediately
      cy.task('log', '[STEP 8] Verifying cards display row names immediately');

      cy.get('.database-board', { timeout: 10000 }).should('exist');
      waitForReactUpdate(2000);

      cy.get('.board-card', { timeout: 10000 }).should('have.length.at.least', 2);

      cy.task('log', `[STEP 8.1] Looking for card with name: ${rowName1}`);
      cy.get('.database-board').contains(rowName1, { timeout: 10000 }).should('be.visible');

      cy.task('log', `[STEP 8.2] Looking for card with name: ${rowName2}`);
      cy.get('.database-board').contains(rowName2, { timeout: 10000 }).should('be.visible');

      cy.task('log', `[STEP 9] Verifying "${selectOption}" column exists`);
      cy.get('.database-board').contains(selectOption).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Board row data loading test passed');
    });
  });

  /**
   * Test: Collaboration sync - changes in one view should sync to another.
   *
   * Simulates collaboration by:
   * 1. Creating a Grid database and adding a Board view
   * 2. Opening the Board view in an iframe
   * 3. Adding a new card in the main window
   * 4. Verifying the card appears in the iframe (synced)
   */
  it('should sync new cards between collaborative sessions (iframe simulation)', () => {
    const testEmail = generateRandomEmail();
    const initialCardName = `Initial-${uuidv4().substring(0, 6)}`;
    const newCardName = `Collab-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Collaboration sync test - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Step 1: Create a Grid database
      cy.task('log', '[STEP 1] Creating Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Step 2: Add initial row with name
      cy.task('log', `[STEP 2] Adding initial row: ${initialCardName}`);
      DatabaseGridSelectors.dataRows().first().find('.grid-cell').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${initialCardName}{enter}`, { force: true });
      waitForReactUpdate(1000);

      // Step 3: Create Board view
      cy.task('log', '[STEP 3] Creating Board view');
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(500);

      cy.get('[role="menu"], [role="listbox"]', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });

      waitForReactUpdate(3000);

      // Verify board loaded with initial card
      cy.get('.database-board', { timeout: 15000 }).should('exist');
      cy.get('.database-board').contains(initialCardName).should('be.visible');

      // Step 4: Get current URL for iframe
      cy.url().then((currentUrl) => {
        cy.task('log', `[STEP 4] Current URL: ${currentUrl}`);

        // Step 5: Add iframe with the same page
        cy.task('log', '[STEP 5] Adding iframe with same Board view');
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

        // Step 6: Verify iframe loaded the board
        cy.task('log', '[STEP 6] Verifying iframe loaded the board');
        cy.get('#collab-iframe').its('0.contentDocument.body').should('not.be.empty');

        cy.get('#collab-iframe')
          .its('0.contentDocument.body')
          .find('.database-board', { timeout: 15000 })
          .should('exist');

        cy.get('#collab-iframe')
          .its('0.contentDocument.body')
          .find('.database-board')
          .contains(initialCardName, { timeout: 10000 })
          .should('exist');

        cy.task('log', '[STEP 6.1] Iframe loaded with initial card');

        // Step 7: Add a new card in the MAIN window by clicking "New" button
        cy.task('log', `[STEP 7] Adding new card in main window: ${newCardName}`);

        cy.get('.database-board').contains(/^\s*New\s*$/i).first().click({ force: true });
        waitForReactUpdate(1000);

        cy.focused().type(`${newCardName}{enter}`, { force: true });
        waitForReactUpdate(2000);

        cy.get('.database-board').contains(newCardName).should('be.visible');
        cy.task('log', '[STEP 7.1] New card added in main window');

        // Step 8: CRITICAL - Verify new card syncs to iframe
        cy.task('log', '[STEP 8] Verifying card syncs to iframe (collaboration)');

        waitForReactUpdate(5000);

        cy.get('#collab-iframe')
          .its('0.contentDocument.body')
          .find('.database-board')
          .contains(newCardName, { timeout: 20000 })
          .should('exist');

        cy.task('log', `[STEP 8.1] SUCCESS: Card "${newCardName}" synced to iframe!`);

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
});
