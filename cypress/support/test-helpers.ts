/**
 * General test helper utilities
 * Common functions used across multiple E2E tests
 *
 * Usage:
 * ```typescript
 * import { closeModalsIfOpen, testLog, waitForReactUpdate } from '@/cypress/support/test-helpers';
 *
 * closeModalsIfOpen();
 * testLog.step(1, 'Login user');
 * testLog.success('Login completed');
 * waitForReactUpdate(500);
 * ```
 */

/**
 * Closes any open modals or dialogs by pressing ESC
 * Safe to call even if no modals are open
 */
export const closeModalsIfOpen = () => {
  cy.get('body').then(($body) => {
    const hasModal =
      $body.find('[role="dialog"], .MuiDialog-container, [data-testid*="modal"]').length > 0;

    if (hasModal) {
      cy.task('log', 'Closing open modal dialog');
      cy.get('body').type('{esc}');
      cy.wait(1000);
    }
  });
};

/**
 * Standardized logging utilities for test output
 * Provides consistent formatting for test logs
 */
export const testLog = {
  /**
   * Log a test step with number
   * @example testLog.step(1, 'Login user');
   */
  step: (num: number, msg: string) => cy.task('log', `=== Step ${num}: ${msg} ===`),

  /**
   * Log general information
   * @example testLog.info('Navigating to page');
   */
  info: (msg: string) => cy.task('log', msg),

  /**
   * Log success message with checkmark
   * @example testLog.success('User logged in');
   */
  success: (msg: string) => cy.task('log', `✓ ${msg}`),

  /**
   * Log error message with X mark
   * @example testLog.error('Login failed');
   */
  error: (msg: string) => cy.task('log', `✗ ${msg}`),

  /**
   * Log warning message
   * @example testLog.warn('Retrying operation');
   */
  warn: (msg: string) => cy.task('log', `⚠ ${msg}`),

  /**
   * Log data in JSON format
   * @example testLog.data('User info', { email, id });
   */
  data: (label: string, value: unknown) =>
    cy.task('log', `${label}: ${JSON.stringify(value, null, 2)}`),

  /**
   * Log test start with separator
   * @example testLog.testStart('OAuth Login Flow');
   */
  testStart: (testName: string) =>
    cy.task(
      'log',
      `
╔════════════════════════════════════════════════════════════════╗
║  TEST: ${testName.padEnd(55)}║
╚════════════════════════════════════════════════════════════════╝`
    ),

  /**
   * Log test end with separator
   * @example testLog.testEnd('OAuth Login Flow');
   */
  testEnd: (testName: string) =>
    cy.task('log', `\n✅ TEST COMPLETED: ${testName}\n`),
};

/**
 * Wait for React updates to complete
 * Useful after DOM mutations or state changes
 *
 * @param ms - Milliseconds to wait (default: 500)
 */
export const waitForReactUpdate = (ms = 500) => {
  cy.wait(ms);
};

/**
 * Wait for an element to exist and be stable
 * Retries if element is not found
 *
 * @param selector - CSS selector or test ID
 * @param timeout - Max time to wait in ms (default: 10000)
 */
export const waitForElement = (selector: string, timeout = 10000) => {
  cy.get(selector, { timeout }).should('exist');
  waitForReactUpdate(300);
};

/**
 * Clear all form inputs within a container
 * @param containerSelector - Optional container selector (defaults to body)
 */
export const clearAllInputs = (containerSelector = 'body') => {
  cy.get(containerSelector)
    .find('input, textarea')
    .each(($el) => {
      cy.wrap($el).clear();
    });
};

/**
 * Type text slowly to simulate real user input
 * Useful for inputs with validation or autocomplete
 *
 * @param selector - Element selector
 * @param text - Text to type
 * @param delayMs - Delay between keystrokes in ms (default: 50)
 */
export const typeSlowly = (selector: string, text: string, delayMs = 50) => {
  cy.get(selector).type(text, { delay: delayMs });
};

/**
 * Scroll element into view and click
 * Useful for elements that might be off-screen
 *
 * @param selector - Element selector
 */
export const scrollAndClick = (selector: string) => {
  cy.get(selector).scrollIntoView().should('be.visible').click();
};

/**
 * Assert that no error messages are visible on the page
 * Checks for common error indicators
 */
export const assertNoErrors = () => {
  cy.get('body').then(($body) => {
    const hasError =
      $body.text().includes('Error') ||
      $body.text().includes('Failed') ||
      $body.find('[role="alert"][data-severity="error"]').length > 0 ||
      $body.find('[class*="error"]').length > 0;

    if (hasError) {
      testLog.warn('Error indicators detected on page');
    }

    expect(hasError).to.be.false;
  });
};

/**
 * Wait for network requests to complete
 * Useful after actions that trigger API calls
 *
 * @param aliasName - Cypress intercept alias (without @)
 * @param timeout - Max time to wait in ms (default: 10000)
 */
export const waitForRequest = (aliasName: string, timeout = 10000) => {
  cy.wait(`@${aliasName}`, { timeout });
};

/**
 * Retry an action until it succeeds or times out
 * Useful for flaky operations
 *
 * @param action - Function containing the action to retry
 * @param maxAttempts - Maximum number of retry attempts (default: 3)
 * @param delayMs - Delay between attempts in ms (default: 1000)
 */
export const retryAction = (
  action: () => void,
  maxAttempts = 3,
  delayMs = 1000
) => {
  let attempts = 0;

  const tryAction = () => {
    attempts++;
    try {
      action();
    } catch (error) {
      if (attempts < maxAttempts) {
        testLog.warn(`Action failed, retrying... (${attempts}/${maxAttempts})`);
        cy.wait(delayMs);
        tryAction();
      } else {
        throw error;
      }
    }
  };

  tryAction();
};

/**
 * Check if element exists without failing test
 * Returns a boolean via then() callback
 *
 * @param selector - Element selector
 */
export const elementExists = (selector: string) => {
  return cy.get('body').then(($body) => {
    return $body.find(selector).length > 0;
  });
};

/**
 * Generate a random string for test data
 * @param length - Length of string (default: 8)
 */
export const randomString = (length = 8) => {
  return Math.random()
    .toString(36)
    .substring(2, 2 + length);
};

/**
 * Take a screenshot with a descriptive name
 * @param name - Screenshot name (test name will be prepended)
 */
export const takeScreenshot = (name: string) => {
  const timestamp = Date.now();
  cy.screenshot(`${timestamp}-${name}`, { capture: 'viewport' });
};
