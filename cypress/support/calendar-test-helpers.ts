/**
 * Calendar test helpers for database E2E tests
 * Provides utilities for calendar view testing
 */
import 'cypress-real-events';
import { AuthTestUtils } from './auth-utils';
import { AddPageSelectors, DatabaseGridSelectors, waitForReactUpdate } from './selectors';
import { generateRandomEmail } from './test-config';

// Re-export for convenience
export { generateRandomEmail };

/**
 * Calendar view type
 */
export type CalendarViewType = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';

/**
 * Calendar selectors using FullCalendar's class names and custom attributes
 */
export const CalendarSelectors = {
  // Main calendar container (FullCalendar wrapper)
  calendarContainer: () => cy.get('.fc'),

  // Calendar toolbar
  toolbar: () => cy.get('.fc-toolbar, [data-testid="calendar-toolbar"]'),

  // Navigation buttons
  prevButton: () => cy.get('.fc-prev-button, [data-testid="calendar-prev-button"]'),
  nextButton: () => cy.get('.fc-next-button, [data-testid="calendar-next-button"]'),
  todayButton: () => cy.get('.fc-today-button, [data-testid="calendar-today-button"]'),

  // View buttons
  monthViewButton: () => cy.get('.fc-dayGridMonth-button, button:contains("Month")'),
  weekViewButton: () => cy.get('.fc-timeGridWeek-button, button:contains("Week")'),
  dayViewButton: () => cy.get('.fc-timeGridDay-button, button:contains("Day")'),

  // Calendar title (current month/week)
  title: () => cy.get('.fc-toolbar-title'),

  // Day cells
  dayCell: () => cy.get('.fc-daygrid-day'),
  dayCellByDate: (date: Date) => {
    const dateStr = formatDateForCalendar(date);
    return cy.get(`[data-date="${dateStr}"]`);
  },
  todayCell: () => cy.get('.fc-day-today'),

  // Events
  event: () => cy.get('.fc-event'),
  eventTitle: () => cy.get('.fc-event-title'),
  eventByTitle: (title: string) => cy.get('.fc-event').contains(title),

  // Event popover
  eventPopover: () => cy.get('[data-radix-popper-content-wrapper]').last(),

  // No date / unscheduled events button
  noDateButton: () => cy.get('.no-date-button, button:contains("No date")'),
  noDatePopover: () => cy.get('[data-radix-popper-content-wrapper]').last(),
  noDateRow: () => cy.get('[data-testid="no-date-row"]'),

  // Add event button (appears on hover over day cell)
  addEventButton: () => cy.get('[data-testid="calendar-add-button"], .add-event-button'),

  // More link (when events overflow)
  moreLink: () => cy.get('.fc-more-link, .fc-daygrid-more-link'),
};

/**
 * Format date to YYYY-MM-DD for FullCalendar data-date attribute
 */
export const formatDateForCalendar = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Common beforeEach setup for calendar tests
 */
export const setupCalendarTest = () => {
  cy.on('uncaught:exception', (err) => {
    if (
      err.message.includes('Minified React error') ||
      err.message.includes('View not found') ||
      err.message.includes('No workspace or service found')
    ) {
      return false;
    }
    return true;
  });

  cy.viewport(1280, 900);
};

/**
 * Login and create a new calendar for testing
 */
export const loginAndCreateCalendar = (email: string): Cypress.Chainable => {
  cy.visit('/login', { failOnStatusCode: false });
  cy.wait(1500);
  const authUtils = new AuthTestUtils();
  return authUtils.signInWithTestUrl(email).then(() => {
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.wait(4000);

    // Create a new calendar
    AddPageSelectors.inlineAddButton().first().click({ force: true });
    waitForReactUpdate(800);
    AddPageSelectors.addCalendarButton().should('exist').click({ force: true });
    cy.wait(7000);
    CalendarSelectors.calendarContainer().should('exist');
  });
};

/**
 * Navigate to next month/week
 */
export const navigateToNext = (): void => {
  CalendarSelectors.nextButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Navigate to previous month/week
 */
export const navigateToPrevious = (): void => {
  CalendarSelectors.prevButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Navigate to today
 */
export const navigateToToday = (): void => {
  CalendarSelectors.todayButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Click on a specific calendar day
 */
export const clickCalendarDay = (date: Date): void => {
  CalendarSelectors.dayCellByDate(date).click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Double-click on a specific calendar day to create an event
 */
export const doubleClickCalendarDay = (date: Date): void => {
  CalendarSelectors.dayCellByDate(date).dblclick({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Create event via add button on hover
 */
export const createEventViaAddButton = (date: Date): void => {
  // Hover over the day cell to show add button
  CalendarSelectors.dayCellByDate(date).realHover();
  waitForReactUpdate(500);

  // Click the add button
  CalendarSelectors.addEventButton().click({ force: true });
  waitForReactUpdate(1000);
};

/**
 * Click on an event to open its popover
 */
export const clickEvent = (eventIndex: number = 0): void => {
  CalendarSelectors.event().eq(eventIndex).click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Click on an event by its title
 */
export const clickEventByTitle = (title: string): void => {
  CalendarSelectors.eventByTitle(title).click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Assert the number of events on a specific day
 */
export const assertEventCountOnDay = (date: Date, expectedCount: number): void => {
  CalendarSelectors.dayCellByDate(date)
    .find('.fc-event')
    .should('have.length', expectedCount);
};

/**
 * Assert the total number of visible events in the calendar
 */
export const assertTotalEventCount = (expectedCount: number): void => {
  CalendarSelectors.event().should('have.length', expectedCount);
};

/**
 * Assert event exists with specific title
 */
export const assertEventExists = (title: string): void => {
  CalendarSelectors.eventByTitle(title).should('exist');
};

/**
 * Open the no date / unscheduled events popup
 */
export const openUnscheduledEventsPopup = (): void => {
  CalendarSelectors.noDateButton().click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Assert number of unscheduled events
 */
export const assertUnscheduledEventCount = (expectedCount: number): void => {
  if (expectedCount === 0) {
    CalendarSelectors.noDateButton().should('not.exist');
  } else {
    CalendarSelectors.noDateButton().should('contain.text', `(${expectedCount})`);
  }
};

/**
 * Click on an unscheduled event in the popup
 */
export const clickUnscheduledEvent = (index: number = 0): void => {
  CalendarSelectors.noDateRow().eq(index).click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Drag an event to a new date
 * Note: Uses Cypress real events for drag and drop
 */
export const dragEventToDate = (eventIndex: number, targetDate: Date): void => {
  const eventSelector = CalendarSelectors.event().eq(eventIndex);

  eventSelector.realMouseDown();

  CalendarSelectors.dayCellByDate(targetDate).realMouseMove().realMouseUp();

  waitForReactUpdate(1000);
};

/**
 * Edit event title in the popover
 */
export const editEventTitle = (newTitle: string): void => {
  // Find the title input in the popover
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('input, textarea, [contenteditable="true"]')
    .first()
    .clear()
    .type(newTitle, { delay: 30 });
  waitForReactUpdate(500);
};

/**
 * Delete event from popover
 */
export const deleteEventFromPopover = (): void => {
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('button')
    .filter((_, el) => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('delete') || el.querySelector('[class*="delete"]') !== null;
    })
    .first()
    .click({ force: true });
  waitForReactUpdate(500);

  // Handle confirmation if present
  cy.get('body').then(($body) => {
    if ($body.find('button:contains("Delete")').length > 0) {
      cy.contains('button', 'Delete').click({ force: true });
      waitForReactUpdate(500);
    }
  });
};

/**
 * Close event popover
 */
export const closeEventPopover = (): void => {
  cy.get('body').type('{esc}');
  waitForReactUpdate(300);
};

/**
 * Switch calendar view
 */
export const switchCalendarView = (view: 'month' | 'week' | 'day'): void => {
  switch (view) {
    case 'month':
      CalendarSelectors.monthViewButton().click({ force: true });
      break;
    case 'week':
      CalendarSelectors.weekViewButton().click({ force: true });
      break;
    case 'day':
      CalendarSelectors.dayViewButton().click({ force: true });
      break;
  }
  waitForReactUpdate(500);
};

/**
 * Get current calendar title (month/year text)
 */
export const getCalendarTitle = (): Cypress.Chainable<string> => {
  return CalendarSelectors.title().invoke('text');
};

/**
 * Wait for calendar to load
 */
export const waitForCalendarLoad = (): void => {
  CalendarSelectors.calendarContainer().should('exist');
  cy.get('.fc-view-harness').should('exist');
  waitForReactUpdate(1000);
};

/**
 * Open row detail from event popover
 */
export const openRowDetailFromEvent = (): void => {
  cy.get('[data-radix-popper-content-wrapper]')
    .last()
    .find('button')
    .filter((_, el) => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('open') || text.includes('expand') ||
             el.querySelector('[class*="expand"]') !== null;
    })
    .first()
    .click({ force: true });
  waitForReactUpdate(500);
};

/**
 * Get today's date
 */
export const getToday = (): Date => new Date();

/**
 * Get a date relative to today
 */
export const getRelativeDate = (daysFromToday: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date;
};

/**
 * Get first day of current month
 */
export const getFirstDayOfMonth = (): Date => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

/**
 * Get first day of next month
 */
export const getFirstDayOfNextMonth = (): Date => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
};

/**
 * Get first day of previous month
 */
export const getFirstDayOfPreviousMonth = (): Date => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
};
