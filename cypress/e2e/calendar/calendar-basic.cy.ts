/**
 * Calendar Basic Tests (Desktop Parity)
 *
 * Tests basic calendar view functionality.
 * Mirrors tests from: database_calendar_test.dart
 */
import 'cypress-real-events';
import {
  setupCalendarTest,
  loginAndCreateCalendar,
  CalendarSelectors,
  doubleClickCalendarDay,
  clickEvent,
  editEventTitle,
  deleteEventFromPopover,
  closeEventPopover,
  assertTotalEventCount,
  assertEventExists,
  waitForCalendarLoad,
  getToday,
  formatDateForCalendar,
} from '../../support/calendar-test-helpers';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { AuthTestUtils } from '../../support/auth-utils';
import { generateRandomEmail } from '../../support/test-config';

describe('Calendar Basic Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupCalendarTest();
  });

  it('create calendar view', () => {
    const email = generateRandomEmail();
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(1500);
    const authUtils = new AuthTestUtils();

    authUtils.signInWithTestUrl(email).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(4000);

      // Create a new calendar
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(800);

      // Look for calendar option
      cy.get('body').then(($body) => {
        if ($body.find('[data-testid="add-calendar-button"]').length > 0) {
          AddPageSelectors.addCalendarButton().click({ force: true });
        } else {
          // Fallback: look for calendar in menu
          cy.contains(/calendar/i).first().click({ force: true });
        }
      });

      cy.wait(7000);

      // Verify calendar is loaded
      CalendarSelectors.calendarContainer().should('exist');
      CalendarSelectors.toolbar().should('exist');
    });
  });

  it('update calendar layout to board and grid', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      // Open database settings
      cy.get('[data-testid="database-settings-button"], button:contains("Settings")')
        .first()
        .click({ force: true });
      waitForReactUpdate(500);

      // Click layout option
      cy.get('[data-testid="database-layout-button"], button:contains("Layout")')
        .first()
        .click({ force: true });
      waitForReactUpdate(500);

      // Select Board layout
      cy.contains(/board/i).click({ force: true });
      waitForReactUpdate(1000);

      // Verify Board layout is active
      cy.get('[data-testid*="board"], .board-view').should('exist');

      // Switch back to Grid
      cy.get('[data-testid="database-settings-button"], button:contains("Settings")')
        .first()
        .click({ force: true });
      waitForReactUpdate(500);
      cy.get('[data-testid="database-layout-button"], button:contains("Layout")')
        .first()
        .click({ force: true });
      waitForReactUpdate(500);
      cy.contains(/grid/i).click({ force: true });
      waitForReactUpdate(1000);

      // Verify Grid layout is active
      DatabaseGridSelectors.grid().should('exist');
    });
  });

  it('create event via double-click', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();

      // Double-click on today to create event
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);

      // Event editor/popover should open
      cy.get('[data-radix-popper-content-wrapper]').should('exist');

      // Close the popover
      closeEventPopover();
      waitForReactUpdate(500);

      // Verify event was created
      assertTotalEventCount(1);
    });
  });

  it('create event via add button on hover', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();
      const dateStr = formatDateForCalendar(today);

      // Hover over today's cell
      cy.get(`[data-date="${dateStr}"]`).realHover();
      waitForReactUpdate(500);

      // Click the add button if visible
      cy.get('body').then(($body) => {
        if ($body.find('[data-testid="calendar-add-button"]:visible').length > 0) {
          cy.get('[data-testid="calendar-add-button"]').first().click({ force: true });
        } else if ($body.find('.add-event-button:visible').length > 0) {
          cy.get('.add-event-button').first().click({ force: true });
        } else {
          // Fallback to double-click
          doubleClickCalendarDay(today);
        }
      });

      waitForReactUpdate(1000);

      // Close any open popover
      closeEventPopover();
      waitForReactUpdate(500);

      // Verify event exists
      CalendarSelectors.event().should('have.length.at.least', 1);
    });
  });

  it('edit event title', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();

      // Create an event
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);

      // Edit the title
      const newTitle = 'My Custom Event';
      editEventTitle(newTitle);
      waitForReactUpdate(500);

      // Close the popover
      closeEventPopover();
      waitForReactUpdate(500);

      // Verify the event shows the new title
      assertEventExists(newTitle);
    });
  });

  it('delete event from popover', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();

      // Create an event
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);

      // Edit title for identification
      editEventTitle('Event To Delete');
      closeEventPopover();
      waitForReactUpdate(500);

      // Verify event exists
      assertTotalEventCount(1);

      // Click on the event to open popover
      clickEvent(0);
      waitForReactUpdate(500);

      // Delete the event
      deleteEventFromPopover();
      waitForReactUpdate(1000);

      // Verify event is deleted
      assertTotalEventCount(0);
    });
  });

  it('multiple events on same day', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();

      // Create first event
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);
      editEventTitle('First Event');
      closeEventPopover();
      waitForReactUpdate(500);

      // Create second event
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);
      editEventTitle('Second Event');
      closeEventPopover();
      waitForReactUpdate(500);

      // Verify both events exist
      assertTotalEventCount(2);
      assertEventExists('First Event');
      assertEventExists('Second Event');
    });
  });
});
