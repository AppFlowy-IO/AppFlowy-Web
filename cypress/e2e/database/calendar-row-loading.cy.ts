import 'cypress-real-events';

import { v4 as uuidv4 } from 'uuid';

import { AuthTestUtils } from '../../support/auth-utils';
import { AddPageSelectors, waitForReactUpdate } from '../../support/selectors';

/**
 * Test for calendar row creation and display.
 *
 * Tests that when creating events in calendar view, they appear immediately.
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
   * Test: Create a calendar directly from sidebar and add events.
   */
  it('should create calendar and display new events immediately', () => {
    const testEmail = generateRandomEmail();
    const eventName1 = `Event-${uuidv4().substring(0, 6)}`;
    const eventName2 = `Meeting-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Calendar row loading - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Step 1: Create a Calendar database directly from sidebar
      cy.task('log', '[STEP 1] Creating Calendar database from sidebar');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);

      // Click on Calendar option in the menu
      cy.get('[role="menuitem"]').contains('Calendar').click({ force: true });
      cy.wait(5000);

      // Verify calendar loaded (month view is default)
      cy.task('log', '[STEP 2] Verifying calendar loaded');
      cy.get('.database-calendar', { timeout: 15000 }).should('exist');
      cy.get('.fc-daygrid-day', { timeout: 10000 }).should('have.length.at.least', 28);

      // Step 3: Create first event by clicking on a date cell
      // FullCalendar allows creating events by selecting/clicking on dates
      cy.task('log', `[STEP 3] Creating first event: ${eventName1}`);

      // Click on a date cell to create an event (FullCalendar selectable feature)
      cy.get('.fc-daygrid-day').eq(10).click({ force: true });
      waitForReactUpdate(1500);

      // Check if an input appeared for the new event
      cy.get('body').then(($body) => {
        // If a popover with input appeared, type the name
        if ($body.find('input:visible').length > 0) {
          cy.get('input:visible').last().clear().type(`${eventName1}{enter}`, { force: true });
        } else {
          // Try using realHover to trigger the add button
          cy.task('log', '[STEP 3.1] Trying hover approach for add button');
          cy.get('.fc-daygrid-day').eq(10).realHover({ position: 'center' });
          cy.wait(300); // Wait for 150ms debounce + buffer

          // Look for add button within the calendar container
          cy.get('.database-calendar').then(($calendar) => {
            if ($calendar.find('[data-add-button]').length > 0) {
              cy.get('[data-add-button]').first().realClick();
              waitForReactUpdate(500);
              cy.get('input:visible').last().clear().type(`${eventName1}{enter}`, { force: true });
            } else {
              // Fallback: Try clicking the cell again with force
              cy.get('.fc-daygrid-day').eq(10).dblclick({ force: true });
              waitForReactUpdate(500);
              cy.get('input:visible').last().clear().type(`${eventName1}{enter}`, { force: true });
            }
          });
        }
      });
      waitForReactUpdate(2000);

      // Step 4: Verify first event appears
      cy.task('log', '[STEP 4] Verifying first event appears');
      cy.get('.database-calendar').contains(eventName1, { timeout: 10000 }).should('be.visible');

      // Step 5: Create second event
      cy.task('log', `[STEP 5] Creating second event: ${eventName2}`);

      // Use the same approach for second event on a different cell
      cy.get('.fc-daygrid-day').eq(15).click({ force: true });
      waitForReactUpdate(1500);

      cy.get('body').then(($body) => {
        if ($body.find('input:visible').length > 0) {
          cy.get('input:visible').last().clear().type(`${eventName2}{enter}`, { force: true });
        } else {
          cy.get('.fc-daygrid-day').eq(15).realHover({ position: 'center' });
          cy.wait(300);
          cy.get('.database-calendar').then(($calendar) => {
            if ($calendar.find('[data-add-button]').length > 0) {
              cy.get('[data-add-button]').first().realClick();
              waitForReactUpdate(500);
              cy.get('input:visible').last().clear().type(`${eventName2}{enter}`, { force: true });
            } else {
              cy.get('.fc-daygrid-day').eq(15).dblclick({ force: true });
              waitForReactUpdate(500);
              cy.get('input:visible').last().clear().type(`${eventName2}{enter}`, { force: true });
            }
          });
        }
      });
      waitForReactUpdate(2000);

      // Step 6: Verify second event appears
      cy.task('log', '[STEP 6] Verifying second event appears');
      cy.get('.database-calendar').contains(eventName2, { timeout: 10000 }).should('be.visible');

      // Step 7: Verify both events are still visible
      cy.task('log', '[STEP 7] Verifying both events are visible');
      cy.get('.database-calendar').contains(eventName1).should('be.visible');
      cy.get('.database-calendar').contains(eventName2).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Calendar row loading test passed');
    });
  });

  /**
   * Test: Navigate away and back to calendar, verify events persist.
   */
  it('should persist events after navigating away and back', () => {
    const testEmail = generateRandomEmail();
    const eventName = `Persist-${uuidv4().substring(0, 6)}`;

    cy.task('log', `[TEST START] Calendar persistence test - Email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Step 1: Create a Calendar database
      cy.task('log', '[STEP 1] Creating Calendar database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').contains('Calendar').click({ force: true });
      cy.wait(5000);

      // Verify calendar loaded
      cy.get('.database-calendar', { timeout: 15000 }).should('exist');
      cy.get('.fc-daygrid-day', { timeout: 10000 }).should('have.length.at.least', 28);

      // Step 2: Create an event by clicking on a date cell
      cy.task('log', `[STEP 2] Creating event: ${eventName}`);
      cy.get('.fc-daygrid-day').eq(10).click({ force: true });
      waitForReactUpdate(1500);

      cy.get('body').then(($body) => {
        if ($body.find('input:visible').length > 0) {
          cy.get('input:visible').last().clear().type(`${eventName}{enter}`, { force: true });
        } else {
          cy.get('.fc-daygrid-day').eq(10).realHover({ position: 'center' });
          cy.wait(300);
          cy.get('.database-calendar').then(($calendar) => {
            if ($calendar.find('[data-add-button]').length > 0) {
              cy.get('[data-add-button]').first().realClick();
              waitForReactUpdate(500);
              cy.get('input:visible').last().clear().type(`${eventName}{enter}`, { force: true });
            } else {
              cy.get('.fc-daygrid-day').eq(10).dblclick({ force: true });
              waitForReactUpdate(500);
              cy.get('input:visible').last().clear().type(`${eventName}{enter}`, { force: true });
            }
          });
        }
      });
      waitForReactUpdate(2000);

      // Verify event appears
      cy.get('.database-calendar').contains(eventName, { timeout: 10000 }).should('be.visible');

      // Step 3: Navigate away - create a new document
      cy.task('log', '[STEP 3] Navigating away');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(3000);

      // Step 4: Navigate back to calendar
      cy.task('log', '[STEP 4] Navigating back to Calendar');
      cy.get('[data-testid="page-name"]').contains('Calendar').first().click({ force: true });
      waitForReactUpdate(3000);

      // Step 5: Verify event still exists
      cy.task('log', '[STEP 5] Verifying event persists');
      cy.get('.database-calendar', { timeout: 15000 }).should('exist');
      cy.get('.database-calendar').contains(eventName, { timeout: 10000 }).should('be.visible');

      cy.task('log', '[TEST COMPLETE] Calendar persistence test passed');
    });
  });
});
