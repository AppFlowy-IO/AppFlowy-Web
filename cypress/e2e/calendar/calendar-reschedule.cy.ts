/**
 * Calendar Reschedule Tests (Desktop Parity)
 *
 * Tests for rescheduling calendar events.
 * Mirrors tests from: database_calendar_test.dart (rescheduling events section)
 *                     calendar_unscheduled_event_test.dart
 */
import 'cypress-real-events';
import {
  setupCalendarTest,
  loginAndCreateCalendar,
  CalendarSelectors,
  doubleClickCalendarDay,
  clickEvent,
  editEventTitle,
  closeEventPopover,
  dragEventToDate,
  openUnscheduledEventsPopup,
  clickUnscheduledEvent,
  assertTotalEventCount,
  assertEventCountOnDay,
  assertUnscheduledEventCount,
  assertEventExists,
  waitForCalendarLoad,
  getToday,
  getRelativeDate,
  formatDateForCalendar,
} from '../../support/calendar-test-helpers';
import { waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

describe('Calendar Reschedule Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupCalendarTest();
  });

  it('drag event to reschedule', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();
      const tomorrow = getRelativeDate(1);

      // Create an event on today
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);
      editEventTitle('Drag Test Event');
      closeEventPopover();
      waitForReactUpdate(500);

      // Verify event is on today
      assertEventCountOnDay(today, 1);

      // Drag the event to tomorrow
      dragEventToDate(0, tomorrow);
      waitForReactUpdate(1000);

      // Verify event is now on tomorrow
      assertEventCountOnDay(tomorrow, 1);
      assertEventCountOnDay(today, 0);
    });
  });

  it('reschedule via date picker in event popover', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();

      // Create an event
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);
      editEventTitle('Date Picker Test');
      closeEventPopover();
      waitForReactUpdate(500);

      // Click on the event
      clickEvent(0);
      waitForReactUpdate(500);

      // Find and click the date field in the popover
      cy.get('[data-radix-popper-content-wrapper]')
        .last()
        .find('button, [role="button"]')
        .filter((_, el) => {
          const text = el.textContent?.toLowerCase() || '';
          // Look for date-related text or date picker button
          return (
            text.includes('date') ||
            el.querySelector('[class*="calendar"], [class*="date"]') !== null
          );
        })
        .first()
        .click({ force: true });
      waitForReactUpdate(500);

      // Select a different day (e.g., day 20)
      cy.get('body').then(($body) => {
        // Look for a date picker
        if ($body.find('.react-datepicker, [role="dialog"]').length > 0) {
          // Click on day 20
          cy.get('.react-datepicker__day, [role="gridcell"]')
            .filter((_, el) => el.textContent?.trim() === '20')
            .first()
            .click({ force: true });
        } else {
          // Alternative: look for day grid
          cy.contains('button, [role="gridcell"]', '20').first().click({ force: true });
        }
      });
      waitForReactUpdate(500);

      closeEventPopover();
      waitForReactUpdate(500);

      // Verify event was rescheduled (should have event on day 20)
      const targetDate = new Date(today.getFullYear(), today.getMonth(), 20);
      assertEventCountOnDay(targetDate, 1);
    });
  });

  it('clear date makes event unscheduled', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();

      // Create an event
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);
      editEventTitle('Unschedule Test');
      closeEventPopover();
      waitForReactUpdate(500);

      // Verify event exists on calendar
      assertTotalEventCount(1);

      // Click on the event
      clickEvent(0);
      waitForReactUpdate(500);

      // Find and click clear date / remove date button
      cy.get('[data-radix-popper-content-wrapper]')
        .last()
        .then(($popover) => {
          // Look for clear/remove date option
          const clearButton = $popover.find('button, [role="button"]').filter((_, el) => {
            const text = el.textContent?.toLowerCase() || '';
            return text.includes('clear') || text.includes('remove') || text.includes('no date');
          });

          if (clearButton.length > 0) {
            cy.wrap(clearButton.first()).click({ force: true });
          } else {
            // Alternative: Open date picker and clear
            const dateButton = $popover.find('[class*="date"], button:contains("Date")');
            if (dateButton.length > 0) {
              cy.wrap(dateButton.first()).click({ force: true });
              waitForReactUpdate(300);
              cy.contains('button', /clear|remove/i).click({ force: true });
            }
          }
        });

      waitForReactUpdate(500);
      closeEventPopover();
      waitForReactUpdate(500);

      // Verify event is removed from calendar view
      assertTotalEventCount(0);

      // Verify "No date" button shows (1) unscheduled event
      assertUnscheduledEventCount(1);
    });
  });

  it('reschedule from unscheduled popup', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();

      // Create an event
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);
      editEventTitle('Reschedule From Unscheduled');
      closeEventPopover();
      waitForReactUpdate(500);

      // Clear the date to make it unscheduled
      clickEvent(0);
      waitForReactUpdate(500);

      cy.get('[data-radix-popper-content-wrapper]')
        .last()
        .find('button, [role="button"]')
        .filter((_, el) => {
          const text = el.textContent?.toLowerCase() || '';
          return text.includes('clear') || text.includes('remove') || text.includes('no date');
        })
        .first()
        .click({ force: true });
      waitForReactUpdate(500);
      closeEventPopover();
      waitForReactUpdate(500);

      // Verify it's unscheduled
      assertTotalEventCount(0);
      assertUnscheduledEventCount(1);

      // Open unscheduled popup
      openUnscheduledEventsPopup();
      waitForReactUpdate(500);

      // Click on the unscheduled event to open it
      clickUnscheduledEvent(0);
      waitForReactUpdate(500);

      // Set a new date
      cy.get('[data-radix-popper-content-wrapper], .MuiDialog-paper')
        .last()
        .find('button, [role="button"]')
        .filter((_, el) => {
          const text = el.textContent?.toLowerCase() || '';
          return (
            text.includes('date') ||
            el.querySelector('[class*="calendar"], [class*="date"]') !== null
          );
        })
        .first()
        .click({ force: true });
      waitForReactUpdate(500);

      // Select day 15
      cy.get('.react-datepicker__day, [role="gridcell"]')
        .filter((_, el) => el.textContent?.trim() === '15')
        .first()
        .click({ force: true });
      waitForReactUpdate(500);

      // Close everything
      cy.get('body').type('{esc}');
      waitForReactUpdate(500);

      // Verify event is back on calendar
      const targetDate = new Date(today.getFullYear(), today.getMonth(), 15);
      assertEventCountOnDay(targetDate, 1);

      // Verify no date button is gone (no unscheduled events)
      assertUnscheduledEventCount(0);
    });
  });

  it('unscheduled events popup shows correct count', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();
      const tomorrow = getRelativeDate(1);

      // Create two events
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);
      editEventTitle('Event 1');
      closeEventPopover();
      waitForReactUpdate(500);

      doubleClickCalendarDay(tomorrow);
      waitForReactUpdate(1000);
      editEventTitle('Event 2');
      closeEventPopover();
      waitForReactUpdate(500);

      // Clear date on first event
      CalendarSelectors.eventByTitle('Event 1').click({ force: true });
      waitForReactUpdate(500);
      cy.get('[data-radix-popper-content-wrapper]')
        .last()
        .find('button')
        .filter((_, el) => el.textContent?.toLowerCase().includes('clear'))
        .first()
        .click({ force: true });
      waitForReactUpdate(500);
      closeEventPopover();

      // Verify count is 1
      assertUnscheduledEventCount(1);

      // Clear date on second event
      CalendarSelectors.eventByTitle('Event 2').click({ force: true });
      waitForReactUpdate(500);
      cy.get('[data-radix-popper-content-wrapper]')
        .last()
        .find('button')
        .filter((_, el) => el.textContent?.toLowerCase().includes('clear'))
        .first()
        .click({ force: true });
      waitForReactUpdate(500);
      closeEventPopover();

      // Verify count is 2
      assertUnscheduledEventCount(2);
    });
  });
});
