/**
 * Calendar Navigation Tests (Desktop Parity)
 *
 * Tests calendar navigation and event loading.
 * Mirrors tests from: calendar_range_loading_test.dart
 */
import 'cypress-real-events';
import {
  setupCalendarTest,
  loginAndCreateCalendar,
  CalendarSelectors,
  navigateToNext,
  navigateToPrevious,
  navigateToToday,
  doubleClickCalendarDay,
  editEventTitle,
  closeEventPopover,
  assertEventExists,
  waitForCalendarLoad,
  getToday,
  getFirstDayOfMonth,
  getFirstDayOfNextMonth,
  getFirstDayOfPreviousMonth,
  getRelativeDate,
} from '../../support/calendar-test-helpers';
import { waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

describe('Calendar Navigation Tests (Desktop Parity)', () => {
  beforeEach(() => {
    setupCalendarTest();
  });

  it('navigate to next and previous month', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      // Get current month title
      CalendarSelectors.title()
        .invoke('text')
        .then((initialTitle) => {
          // Navigate to next month
          navigateToNext();
          waitForReactUpdate(500);

          // Verify title changed
          CalendarSelectors.title().invoke('text').should('not.equal', initialTitle);

          // Navigate back
          navigateToPrevious();
          waitForReactUpdate(500);

          // Verify we're back to original
          CalendarSelectors.title().should('contain.text', initialTitle.trim());
        });
    });
  });

  it('navigate to today button works', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      // Navigate away from current month
      navigateToNext();
      navigateToNext();
      waitForReactUpdate(500);

      // Click today button
      navigateToToday();
      waitForReactUpdate(500);

      // Verify today's cell is visible
      CalendarSelectors.todayCell().should('exist').and('be.visible');
    });
  });

  it('events load after month navigation', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();

      // Create event on current month
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);
      editEventTitle('Current Month Event');
      closeEventPopover();
      waitForReactUpdate(500);

      // Navigate to next month
      navigateToNext();
      waitForReactUpdate(1000);

      // Create event on next month (use 15th to be safe)
      const nextMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, 15);
      doubleClickCalendarDay(nextMonthDate);
      waitForReactUpdate(1000);
      editEventTitle('Next Month Event');
      closeEventPopover();
      waitForReactUpdate(500);

      // Verify next month event exists
      assertEventExists('Next Month Event');

      // Navigate back to current month
      navigateToPrevious();
      waitForReactUpdate(1000);

      // Verify current month event still exists
      assertEventExists('Current Month Event');

      // Navigate to next month again
      navigateToNext();
      waitForReactUpdate(1000);

      // Verify next month event is still there (data persisted)
      assertEventExists('Next Month Event');
    });
  });

  it('events persist across multiple month navigations', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();

      // Create event today
      doubleClickCalendarDay(today);
      waitForReactUpdate(1000);
      editEventTitle('Today Event');
      closeEventPopover();
      waitForReactUpdate(500);

      // Navigate 3 months forward
      navigateToNext();
      navigateToNext();
      navigateToNext();
      waitForReactUpdate(500);

      // Navigate 3 months back to current
      navigateToPrevious();
      navigateToPrevious();
      navigateToPrevious();
      waitForReactUpdate(1000);

      // Verify event still exists
      assertEventExists('Today Event');
    });
  });

  it('previous month events load correctly', () => {
    const email = generateRandomEmail();
    loginAndCreateCalendar(email).then(() => {
      waitForCalendarLoad();

      const today = getToday();

      // Navigate to previous month first
      navigateToPrevious();
      waitForReactUpdate(1000);

      // Create event on previous month (use 10th to be safe)
      const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 10);
      doubleClickCalendarDay(prevMonthDate);
      waitForReactUpdate(1000);
      editEventTitle('Previous Month Event');
      closeEventPopover();
      waitForReactUpdate(500);

      // Navigate back to current month
      navigateToNext();
      waitForReactUpdate(1000);

      // Navigate to previous month again
      navigateToPrevious();
      waitForReactUpdate(1000);

      // Verify the event loads correctly
      assertEventExists('Previous Month Event');
    });
  });
});
