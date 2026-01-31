import 'cypress-real-events';

import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import { AddPageSelectors, waitForReactUpdate } from '../../support/selectors';

/**
 * Calendar Row Loading Tests
 *
 * Tests for calendar event creation, display, and persistence.
 */
describe('Calendar Row Loading', () => {
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
   * Helper: Create a Calendar and wait for it to load
   */
  const createCalendarAndWait = (authUtils: AuthTestUtils, testEmail: string) => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    return authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create Calendar
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').contains('Calendar').click({ force: true });
      cy.wait(5000);

      // Verify calendar loaded (month view is default)
      cy.get('.database-calendar', { timeout: 15000 }).should('exist');
      cy.get('.fc-daygrid-day', { timeout: 10000 }).should('have.length.at.least', 28);
    });
  };

  /**
   * Helper: Create an event on a specific date cell
   */
  const createEventOnCell = (cellIndex: number, eventName: string) => {
    cy.get('.fc-daygrid-day').eq(cellIndex).click({ force: true });
    waitForReactUpdate(1500);

    cy.get('body').then(($body) => {
      if ($body.find('input:visible').length > 0) {
        cy.get('input:visible').last().clear().type(`${eventName}{enter}`, { force: true });
      } else {
        cy.get('.fc-daygrid-day').eq(cellIndex).realHover({ position: 'center' });
        cy.wait(300);

        cy.get('.database-calendar').then(($calendar) => {
          if ($calendar.find('[data-add-button]').length > 0) {
            cy.get('[data-add-button]').first().realClick();
            waitForReactUpdate(500);
            cy.get('input:visible').last().clear().type(`${eventName}{enter}`, { force: true });
          } else {
            cy.get('.fc-daygrid-day').eq(cellIndex).dblclick({ force: true });
            waitForReactUpdate(500);
            cy.get('input:visible').last().clear().type(`${eventName}{enter}`, { force: true });
          }
        });
      }
    });
    waitForReactUpdate(2000);
  };

  it('should create calendar and display multiple events immediately', () => {
    const testEmail = generateRandomEmail();
    const eventName1 = `Event-${uuidv4().substring(0, 6)}`;
    const eventName2 = `Meeting-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Calendar row loading - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();
    createCalendarAndWait(authUtils, testEmail).then(() => {
      // Create first event
      cy.task('log', `[STEP 1] Creating first event: ${eventName1}`);
      createEventOnCell(10, eventName1);

      // Verify first event appears
      cy.task('log', '[STEP 2] Verifying first event appears');
      cy.get('.database-calendar').contains(eventName1, { timeout: 10000 }).should('be.visible');

      // Create second event on a different cell
      cy.task('log', `[STEP 3] Creating second event: ${eventName2}`);
      createEventOnCell(15, eventName2);

      // Verify second event appears
      cy.task('log', '[STEP 4] Verifying second event appears');
      cy.get('.database-calendar').contains(eventName2, { timeout: 10000 }).should('be.visible');

      // Verify both events are still visible
      cy.task('log', '[STEP 5] Verifying both events are visible');
      cy.get('.database-calendar').contains(eventName1).should('be.visible');
      cy.get('.database-calendar').contains(eventName2).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Calendar row loading test passed');
    });
  });

  it('should display calendar events in Grid view when switching views', () => {
    const testEmail = generateRandomEmail();
    const eventName = `Event-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Calendar to Grid view sync test - Email: ${testEmail}`);

    const authUtils = new AuthTestUtils();
    createCalendarAndWait(authUtils, testEmail).then(() => {
      // Create an event in Calendar view
      cy.task('log', `[STEP 1] Creating event in Calendar: ${eventName}`);
      createEventOnCell(10, eventName);

      // Verify event appears in Calendar
      cy.get('.database-calendar').contains(eventName, { timeout: 10000 }).should('be.visible');

      // Add a Grid view via the database tabbar "+" button
      cy.task('log', '[STEP 2] Adding Grid view via tabbar');
      cy.get('[data-testid="add-view-button"]').click({ force: true });
      waitForReactUpdate(1000);

      // Select Grid from the dropdown menu
      cy.get('[role="menuitem"]').contains('Grid').click({ force: true });
      waitForReactUpdate(3000);

      // Verify Grid view loaded
      cy.task('log', '[STEP 3] Verifying Grid view loaded');
      cy.get('.database-grid', { timeout: 15000 }).should('exist');

      // Verify the event/row appears in Grid view
      cy.task('log', '[STEP 4] Verifying event appears in Grid view');
      cy.get('.database-grid').contains(eventName, { timeout: 10000 }).should('be.visible');

      // Switch back to Calendar view via tab
      cy.task('log', '[STEP 5] Switching back to Calendar view');
      cy.get('[data-testid^="view-tab-"]').contains('Calendar').click({ force: true });
      waitForReactUpdate(2000);

      // Verify Calendar view and event still exist
      cy.task('log', '[STEP 6] Verifying event still exists in Calendar');
      cy.get('.database-calendar', { timeout: 15000 }).should('exist');
      cy.get('.database-calendar').contains(eventName, { timeout: 10000 }).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Calendar to Grid view sync test passed');
    });
  });
});
