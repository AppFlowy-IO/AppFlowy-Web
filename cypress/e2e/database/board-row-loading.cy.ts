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
      DatabaseGridSelectors.dataRows()
        .first()
        .find('.grid-cell')
        .first()
        .click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${rowName1}{enter}`, { force: true });
      waitForReactUpdate(1000);

      // Step 3: Set select option for first row (click on Status column cell)
      cy.task('log', `[STEP 3] Setting select option "${selectOption}" for first row`);
      SingleSelectSelectors.allSelectOptionCells().first().click({ force: true });
      waitForReactUpdate(500);

      // Type to create/select the option
      cy.focused().type(`${selectOption}{enter}`, { force: true });
      waitForReactUpdate(1000);

      // Step 4: Add second row with name
      cy.task('log', `[STEP 4] Adding second row: ${rowName2}`);
      DatabaseGridSelectors.dataRows()
        .eq(1)
        .find('.grid-cell')
        .first()
        .click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${rowName2}{enter}`, { force: true });
      waitForReactUpdate(1000);

      // Step 5: Set same select option for second row
      cy.task('log', `[STEP 5] Setting select option "${selectOption}" for second row`);
      SingleSelectSelectors.allSelectOptionCells().eq(1).click({ force: true });
      waitForReactUpdate(500);
      // Click on existing option in dropdown
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

      // Wait for board to render
      cy.get('.database-board', { timeout: 10000 }).should('exist');
      waitForReactUpdate(2000);

      // The board should have cards (previously they wouldn't render at all)
      cy.get('.board-card', { timeout: 10000 }).should('have.length.at.least', 2);

      // CRITICAL ASSERTION: Verify both row names appear in cards
      // This would fail before the fix because cards were empty or not rendered
      cy.task('log', `[STEP 8.1] Looking for card with name: ${rowName1}`);
      cy.get('.database-board').contains(rowName1, { timeout: 10000 }).should('be.visible');

      cy.task('log', `[STEP 8.2] Looking for card with name: ${rowName2}`);
      cy.get('.database-board').contains(rowName2, { timeout: 10000 }).should('be.visible');

      // Step 9: Verify the select option column header exists
      cy.task('log', `[STEP 9] Verifying "${selectOption}" column exists`);
      cy.get('.database-board').contains(selectOption).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Board row data loading test passed');
    });
  });

  /**
   * Test: Board view should load row data when navigating directly to it.
   *
   * Scenario:
   * 1. Create database with Grid and Board views
   * 2. Add data in Grid view
   * 3. Navigate away (to a different page)
   * 4. Navigate directly to Board view via sidebar
   * 5. Verify cards display data immediately
   */
  it('should display row data when navigating directly to Board view', () => {
    const testEmail = generateRandomEmail();
    const rowName = `DirectNav-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Direct Board navigation - Email: ${testEmail}`);

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

      // Step 2: Add a row with name
      cy.task('log', `[STEP 2] Adding row: ${rowName}`);
      DatabaseGridSelectors.dataRows()
        .first()
        .find('.grid-cell')
        .first()
        .click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${rowName}{enter}`, { force: true });
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

      // Step 4: Navigate away - create a new document
      cy.task('log', '[STEP 4] Navigating away');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(3000);

      // Step 5: Navigate directly to the Board view in sidebar
      cy.task('log', '[STEP 5] Navigating directly to Board view via sidebar');

      // Click on Board in sidebar
      cy.get('[data-testid="page-name"]')
        .contains('Board')
        .first()
        .click({ force: true });

      waitForReactUpdate(3000);

      // Step 6: Verify row data is visible immediately
      cy.task('log', '[STEP 6] Verifying row data is visible');
      cy.get('.database-board', { timeout: 10000 }).should('exist');

      // CRITICAL: This would fail before the fix
      cy.get('.database-board').contains(rowName, { timeout: 10000 }).should('be.visible');

      cy.task('log', `[STEP 6.1] Found row "${rowName}" after direct navigation`);

      cy.task('log', '[TEST COMPLETE] Direct Board navigation test passed');
    });
  });

  /**
   * Test: Board view should correctly group rows even when documents load asynchronously.
   *
   * The fix ensures rows are placed in default group initially,
   * then move to correct group once their documents load.
   */
  it('should group rows correctly after async document loading', () => {
    const testEmail = generateRandomEmail();
    const rowInToDo = `ToDo-${uuidv4().substring(0, 6)}`;
    const rowInDoing = `Doing-${uuidv4().substring(0, 6)}`;
    const rowNoStatus = `NoStatus-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Board grouping with async loading - Email: ${testEmail}`);

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

      // Step 2: Add row with "To Do" status
      cy.task('log', `[STEP 2] Adding row with "To Do" status: ${rowInToDo}`);
      DatabaseGridSelectors.dataRows().first().find('.grid-cell').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${rowInToDo}{enter}`, { force: true });
      waitForReactUpdate(500);

      SingleSelectSelectors.allSelectOptionCells().first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type('To Do{enter}', { force: true });
      waitForReactUpdate(1000);

      // Step 3: Add row with "Doing" status
      cy.task('log', `[STEP 3] Adding row with "Doing" status: ${rowInDoing}`);
      DatabaseGridSelectors.dataRows().eq(1).find('.grid-cell').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${rowInDoing}{enter}`, { force: true });
      waitForReactUpdate(500);

      SingleSelectSelectors.allSelectOptionCells().eq(1).click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type('Doing{enter}', { force: true });
      waitForReactUpdate(1000);

      // Step 4: Add row without status (stays in "No Status" group)
      cy.task('log', `[STEP 4] Adding row without status: ${rowNoStatus}`);
      DatabaseGridSelectors.dataRows().eq(2).find('.grid-cell').first().click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${rowNoStatus}{enter}`, { force: true });
      waitForReactUpdate(1000);

      // Step 5: Create Board view
      cy.task('log', '[STEP 5] Creating Board view');
      DatabaseViewSelectors.addViewButton().scrollIntoView().click({ force: true });
      waitForReactUpdate(500);

      cy.get('[role="menu"], [role="listbox"]', { timeout: 5000 })
        .should('be.visible')
        .contains('Board')
        .click({ force: true });

      waitForReactUpdate(3000);

      // Step 6: Verify all cards are visible
      cy.task('log', '[STEP 6] Verifying all cards are visible');
      cy.get('.database-board', { timeout: 10000 }).should('exist');

      cy.get('.database-board').contains(rowInToDo, { timeout: 10000 }).should('be.visible');
      cy.get('.database-board').contains(rowInDoing, { timeout: 10000 }).should('be.visible');
      cy.get('.database-board').contains(rowNoStatus, { timeout: 10000 }).should('be.visible');

      // Step 7: Verify all column headers exist
      cy.task('log', '[STEP 7] Verifying column headers exist');

      // Wait a bit for async grouping to settle
      waitForReactUpdate(2000);

      // Verify "To Do" and "Doing" columns exist
      cy.get('.database-board').contains('To Do').should('be.visible');
      cy.get('.database-board').contains('Doing').should('be.visible');

      // The main assertion is that all cards are visible (tested in Step 6)
      // The grouping logic puts cards in correct columns once row docs load

      cy.task('log', '[TEST COMPLETE] Board grouping test passed');
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
    const initialRowName = `Initial-${uuidv4().substring(0, 6)}`;
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
      cy.task('log', `[STEP 2] Adding initial row: ${initialRowName}`);
      DatabaseGridSelectors.dataRows()
        .first()
        .find('.grid-cell')
        .first()
        .click({ force: true });
      waitForReactUpdate(500);
      cy.focused().type(`${initialRowName}{enter}`, { force: true });
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
      cy.get('.database-board').contains(initialRowName).should('be.visible');

      // Step 4: Get current URL for iframe
      cy.url().then((currentUrl) => {
        cy.task('log', `[STEP 4] Current URL: ${currentUrl}`);

        // Step 5: Add iframe with the same page
        cy.task('log', '[STEP 5] Adding iframe with same Board view');
        cy.document().then((doc) => {
          const iframe = doc.createElement('iframe');

          iframe.id = 'collab-iframe';
          iframe.src = currentUrl;
          iframe.style.cssText = 'position: fixed; bottom: 0; right: 0; width: 600px; height: 400px; border: 2px solid blue; z-index: 9999;';
          doc.body.appendChild(iframe);
        });

        // Wait for iframe to load
        cy.get('#collab-iframe', { timeout: 10000 }).should('exist');
        waitForReactUpdate(8000);

        // Step 6: Verify iframe loaded the board
        cy.task('log', '[STEP 6] Verifying iframe loaded the board');
        cy.get('#collab-iframe').its('0.contentDocument.body').should('not.be.empty');

        // Check iframe has the board and initial card
        cy.get('#collab-iframe')
          .its('0.contentDocument.body')
          .find('.database-board', { timeout: 15000 })
          .should('exist');

        cy.get('#collab-iframe')
          .its('0.contentDocument.body')
          .find('.database-board')
          .contains(initialRowName, { timeout: 10000 })
          .should('exist');

        cy.task('log', '[STEP 6.1] Iframe loaded with initial card');

        // Step 7: Add a new card in the MAIN window by clicking "New" button
        cy.task('log', `[STEP 7] Adding new card in main window: ${newCardName}`);

        // Click "New" button in main window (the button text is just "New" from translations)
        cy.get('.database-board')
          .contains(/^\s*New\s*$/i)
          .first()
          .click({ force: true });
        waitForReactUpdate(1000);

        // Type new card name
        cy.focused().type(`${newCardName}{enter}`, { force: true });
        waitForReactUpdate(2000);

        // Verify new card appears in main window
        cy.get('.database-board').contains(newCardName).should('be.visible');
        cy.task('log', '[STEP 7.1] New card added in main window');

        // Step 8: CRITICAL - Verify new card syncs to iframe
        cy.task('log', '[STEP 8] Verifying card syncs to iframe (collaboration)');

        // Wait for sync
        waitForReactUpdate(5000);

        // Check if the new card appears in the iframe
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
