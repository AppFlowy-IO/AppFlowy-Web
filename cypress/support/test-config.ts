/**
 * Centralized test configuration
 * Consolidates environment variable access across all E2E tests
 *
 * Usage:
 * ```typescript
 * import { TestConfig, logTestEnvironment } from '@/cypress/support/test-config';
 *
 * const apiUrl = TestConfig.apiUrl;
 * logTestEnvironment(); // Logs all config values
 * ```
 */

export const TestConfig = {
  /**
   * Base URL for the web application
   * Default: http://localhost:3000
   */
  baseUrl: Cypress.config('baseUrl') || 'http://localhost:3000',

  /**
   * GoTrue authentication service URL
   * Default: http://localhost/gotrue
   */
  gotrueUrl: Cypress.env('APPFLOWY_GOTRUE_BASE_URL') || 'http://localhost/gotrue',

  /**
   * AppFlowy Cloud API base URL
   * Default: http://localhost
   */
  apiUrl: Cypress.env('APPFLOWY_BASE_URL') || 'http://localhost',
} as const;

/**
 * Logs test environment configuration to Cypress task log
 * Useful for debugging test failures in CI/CD
 */
export const logTestEnvironment = () => {
  cy.task('log', `
╔════════════════════════════════════════════════════════════════╗
║              Test Environment Configuration                    ║
╠════════════════════════════════════════════════════════════════╣
║ Base URL:    ${TestConfig.baseUrl.padEnd(45)}║
║ GoTrue URL:  ${TestConfig.gotrueUrl.padEnd(45)}║
║ API URL:     ${TestConfig.apiUrl.padEnd(45)}║
╚════════════════════════════════════════════════════════════════╝
  `);
};
