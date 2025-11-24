import { v4 as uuidv4 } from 'uuid';
import { testLog } from './test-helpers';

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
export const logTestEnvironment = (env: Partial<typeof TestConfig> = TestConfig) => {
  testLog.info(`
╔════════════════════════════════════════════════════════════════╗
║              Test Environment Configuration                    ║
╠════════════════════════════════════════════════════════════════╣
║ Base URL:    ${(env.baseUrl ?? TestConfig.baseUrl).padEnd(45)}║
║ GoTrue URL:  ${(env.gotrueUrl ?? TestConfig.gotrueUrl).padEnd(45)}║
║ API URL:     ${(env.apiUrl ?? TestConfig.apiUrl).padEnd(45)}║
╚════════════════════════════════════════════════════════════════╝
  `);
};

/**
 * Quickly fetches the AppFlowy URLs used across specs.
 * Prefer this over reading Cypress.env directly to keep tests consistent.
 */
export const getTestEnvironment = () => ({
  appflowyBaseUrl: TestConfig.apiUrl,
  appflowyGotrueBaseUrl: TestConfig.gotrueUrl,
});

/**
 * Lightweight logger for the two most used URLs in tests.
 */
export const logAppFlowyEnvironment = () => {
  const env = getTestEnvironment();
  cy.task(
    'log',
    `Test Environment Configuration:\n  - APPFLOWY_BASE_URL: ${env.appflowyBaseUrl}\n  - APPFLOWY_GOTRUE_BASE_URL: ${env.appflowyGotrueBaseUrl}`
  );
};

/**
 * Shared email generator for e2e specs.
 */
export const generateRandomEmail = (domain = 'appflowy.io') => `${uuidv4()}@${domain}`;

/**
 * Returns the platform-specific Command modifier key.
 * Mac: {cmd} (Meta)
 * Windows/Linux: {ctrl}
 */
export const getCmdKey = () => {
  return Cypress.platform === 'darwin' ? '{cmd}' : '{ctrl}';
};

/**
 * Returns the platform-specific modifier for word-by-word navigation.
 * Mac: {alt} (Option)
 * Windows/Linux: {ctrl}
 */
export const getWordJumpKey = () => {
  return Cypress.platform === 'darwin' ? '{alt}' : '{ctrl}';
};
