/**
 * Database View Consistency E2E Tests
 *
 * Tests for verifying data consistency across different database views (Grid, Board, Calendar).
 * Creates rows in one view and verifies they appear correctly in other views.
 */
import 'cypress-real-events';

import { v4 as uuidv4 } from 'uuid';
import {
  AddPageSelectors,
  BoardSelectors,
  DatabaseGridSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { generateRandomEmail } from '../../support/test-config';

describe('Database View Consistency', () => {
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

    cy.viewport(1280, 900);
  });

  /**
   * Helper: Sign in and create a Grid database
   */
  const signInAndCreateGrid = (testEmail: string) => {
    return signInAndCreateDatabaseView(testEmail, 'Grid', {
      verify: () => {
        cy.get('.database-grid', { timeout: 15000 }).should('exist');
        DatabaseGridSelectors.dataRows().should('have.length.at.least', 1);
        waitForReactUpdate(2000);
      },
    });
  };

  /**
   * Helper: Add a new view to the current database
   */
  const addViewToDatabase = (viewType: 'Grid' | 'Board' | 'Calendar') => {
    cy.get('[data-testid="add-view-button"]').click({ force: true });
    waitForReactUpdate(1000);
    cy.get('[role="menuitem"]').contains(viewType).click({ force: true });
    waitForReactUpdate(3000);
  };

  /**
   * Helper: Switch to a specific view tab
   */
  const switchToView = (viewType: 'Grid' | 'Board' | 'Calendar') => {
    cy.get('[data-testid^="view-tab-"]').contains(viewType).click({ force: true });
    waitForReactUpdate(2000);
  };

  /**
   * Helper: Edit an existing row's primary cell in Grid view to give it a recognizable name
   */
  const editRowInGrid = (rowIndex: number, rowName: string) => {
    // Click on the first cell (primary field) of the specified row
    DatabaseGridSelectors.dataRows()
      .eq(rowIndex)
      .find('.grid-row-cell')
      .first()
      .scrollIntoView()
      .click({ force: true });
    waitForReactUpdate(500);

    // Type the row name - clear first then type
    cy.focused().clear().type(`${rowName}{enter}`, { force: true });
    waitForReactUpdate(2000);
  };

  /**
   * Helper: Create a card in Board view by clicking New button in first column
   */
  const createCardInBoard = (cardName: string) => {
    // Find the first "New" button in the board
    BoardSelectors.boardContainer()
      .contains(/^\s*New\s*$/i)
      .first()
      .click({ force: true });
    waitForReactUpdate(500);
    cy.focused().type(`${cardName}{enter}`, { force: true });
    waitForReactUpdate(2000);
  };

  /**
   * Helper: Create an event in Calendar view
   */
  const createEventInCalendar = (eventName: string, cellIndex: number = 15) => {
    cy.get('.fc-daygrid-day').eq(cellIndex).click({ force: true });
    waitForReactUpdate(1500);

    cy.get('body').then(($body) => {
      if ($body.find('input:visible').length > 0) {
        cy.get('input:visible').last().clear().type(`${eventName}{enter}`, { force: true });
      } else {
        cy.get('.fc-daygrid-day').eq(cellIndex).dblclick({ force: true });
        waitForReactUpdate(500);
        cy.get('input:visible').last().clear().type(`${eventName}{enter}`, { force: true });
      }
    });
    waitForReactUpdate(2000);
  };

  /**
   * Helper: Verify a row exists in Grid view
   */
  const verifyRowInGrid = (rowName: string) => {
    cy.get('.database-grid').contains(rowName, { timeout: 10000 }).should('be.visible');
  };

  /**
   * Helper: Verify a card exists in Board view
   */
  const verifyCardInBoard = (cardName: string) => {
    BoardSelectors.boardContainer().contains(cardName, { timeout: 10000 }).should('be.visible');
  };

  it('should maintain data consistency across Grid, Board, and Calendar views', () => {
    const testEmail = generateRandomEmail();
    const gridRow = `GridItem-${uuidv4().substring(0, 6)}`;
    const boardCard = `BoardItem-${uuidv4().substring(0, 6)}`;
    const calendarEvent = `CalItem-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Cross-view data consistency - Email: ${testEmail}`);

    signInAndCreateGrid(testEmail).then(() => {
      // Step 1: Edit first row in Grid view
      cy.task('log', `[STEP 1] Editing row in Grid view: ${gridRow}`);
      editRowInGrid(0, gridRow);
      verifyRowInGrid(gridRow);

      // Step 2: Add Board view and verify grid row appears, then create a card
      cy.task('log', '[STEP 2] Adding Board view');
      addViewToDatabase('Board');
      BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
      waitForReactUpdate(2000);

      cy.task('log', '[STEP 2a] Verifying grid row appears in Board view');
      verifyCardInBoard(gridRow);

      cy.task('log', `[STEP 2b] Creating card in Board view: ${boardCard}`);
      createCardInBoard(boardCard);
      verifyCardInBoard(boardCard);

      // Step 3: Add Calendar view and create an event
      cy.task('log', '[STEP 3] Adding Calendar view');
      addViewToDatabase('Calendar');
      cy.get('.database-calendar', { timeout: 15000 }).should('exist');
      waitForReactUpdate(2000);

      cy.task('log', `[STEP 3a] Creating event in Calendar view: ${calendarEvent}`);
      createEventInCalendar(calendarEvent);
      cy.get('.database-calendar').contains(calendarEvent, { timeout: 10000 }).should('be.visible');

      // Step 4: Switch to Grid view and verify all items exist
      cy.task('log', '[STEP 4] Switching to Grid view to verify all items');
      switchToView('Grid');
      cy.get('.database-grid', { timeout: 15000 }).should('exist');
      waitForReactUpdate(2000);
      verifyRowInGrid(gridRow);
      verifyRowInGrid(boardCard);
      verifyRowInGrid(calendarEvent);

      // Step 5: Switch to Board view and verify all items exist
      cy.task('log', '[STEP 5] Switching to Board view to verify all items');
      switchToView('Board');
      BoardSelectors.boardContainer().should('exist', { timeout: 15000 });
      waitForReactUpdate(2000);
      verifyCardInBoard(gridRow);
      verifyCardInBoard(boardCard);
      verifyCardInBoard(calendarEvent);

      // Step 6: Switch back to Calendar view to verify it still works
      cy.task('log', '[STEP 6] Switching back to Calendar view');
      switchToView('Calendar');
      cy.get('.database-calendar', { timeout: 15000 }).should('exist');
      cy.get('.database-calendar').contains(calendarEvent, { timeout: 10000 }).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Cross-view data consistency test passed');
    });
  });
});
