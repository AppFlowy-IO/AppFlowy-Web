/**
 * Centralized exception handlers for E2E tests
 * Consolidates error handling across all test files
 *
 * Usage:
 * ```typescript
 * import { setupCommonExceptionHandlers } from '@/cypress/support/exception-handlers';
 *
 * beforeEach(() => {
 *   setupCommonExceptionHandlers();
 * });
 * ```
 */

/**
 * List of known non-critical errors that can be safely ignored during E2E tests
 * These errors don't affect test validity but may appear in the console
 */
const IGNORED_ERROR_PATTERNS = [
  // React errors
  'Minified React error',
  'React does not recognize',

  // AppFlowy-specific errors
  'View not found',
  'No workspace or service found',
  'App outline not found',
  'Favorite views not found',
  'App trash not found',

  // Network and WebSocket errors
  'WebSocket',
  'connection',
  'Failed to fetch',
  'NetworkError',

  // AI/Model errors
  'Failed to load models',

  // Common JavaScript errors in test environment
  'Cannot read properties of undefined',
  'ResizeObserver loop',
  'Loading chunk',
];

/**
 * Sets up common exception handlers for E2E tests
 * Ignores known non-critical errors that don't affect test validity
 *
 * @param additionalPatterns - Optional array of additional error patterns to ignore
 */
export const setupCommonExceptionHandlers = (additionalPatterns: string[] = []) => {
  const allPatterns = [...IGNORED_ERROR_PATTERNS, ...additionalPatterns];

  cy.on('uncaught:exception', (err) => {
    const shouldIgnore = allPatterns.some(pattern =>
      err.message.includes(pattern)
    );

    if (shouldIgnore) {
      // Log warning for debugging but don't fail the test
      console.warn('[Test] Ignoring known non-critical error:', err.message);
      return false; // Prevent test failure
    }

    // Unknown error - let it fail the test
    return true;
  });
};

/**
 * Sets up exception handlers that ignore ALL errors
 * ⚠️ Use with caution - only for tests where errors are expected/irrelevant
 */
export const ignoreAllExceptions = () => {
  cy.on('uncaught:exception', () => {
    console.warn('[Test] Ignoring all exceptions (permissive mode)');
    return false;
  });
};
