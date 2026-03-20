import { v4 as uuidv4 } from 'uuid';
import type { Page } from '@playwright/test';

/**
 * Centralized test configuration for Playwright E2E tests
 * Migrated from: cypress/support/test-config.ts
 */
export const TestConfig = {
  /**
   * Base URL for the web application
   * Default: http://localhost:3000
   */
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  /**
   * GoTrue authentication service URL
   * Default: http://localhost/gotrue
   */
  gotrueUrl: process.env.APPFLOWY_GOTRUE_BASE_URL || 'http://localhost/gotrue',

  /**
   * AppFlowy Cloud API base URL
   * Default: http://localhost
   */
  apiUrl: process.env.APPFLOWY_BASE_URL || 'http://localhost',

  /**
   * WebSocket base URL
   */
  wsUrl: process.env.APPFLOWY_WS_BASE_URL || 'ws://localhost/ws/v2',

  /**
   * Feature flags
   */
  enableRelationRollupEdit: process.env.APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT === 'true',

  /**
   * Admin credentials
   */
  adminEmail: process.env.GOTRUE_ADMIN_EMAIL || 'admin@example.com',
  adminPassword: process.env.GOTRUE_ADMIN_PASSWORD || 'password',
} as const;

/**
 * Logs test environment configuration
 */
export const logTestEnvironment = () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║              Test Environment Configuration                    ║
╠════════════════════════════════════════════════════════════════╣
║ Base URL:    ${TestConfig.baseUrl.padEnd(45)}║
║ GoTrue URL:  ${TestConfig.gotrueUrl.padEnd(45)}║
║ API URL:     ${TestConfig.apiUrl.padEnd(45)}║
╚════════════════════════════════════════════════════════════════╝
  `);
};

/**
 * Quickly fetches the AppFlowy URLs used across specs.
 */
export const getTestEnvironment = () => ({
  appflowyBaseUrl: TestConfig.apiUrl,
  appflowyGotrueBaseUrl: TestConfig.gotrueUrl,
});

/**
 * Shared email generator for e2e specs.
 */
export const generateRandomEmail = (domain = 'appflowy.io') => `${uuidv4()}@${domain}`;

/**
 * Known harmless page errors that should be suppressed in E2E tests.
 * These are expected errors from React, async operations, and browser APIs
 * that don't indicate real test failures.
 */
const SUPPRESSED_ERROR_PATTERNS = [
  'Minified React error',
  'View not found',
  'No workspace or service found',
  'ResizeObserver loop',
  'createThemeNoVars_default is not a function',
  "Failed to execute 'writeText' on 'Clipboard'",
  'databaseId not found',
  'useAppHandlers must be used within',
  'Cannot resolve a DOM node from Slate',
  'Failed to fetch',
  '_dEH',
] as const;

/**
 * Suppress known harmless page errors in E2E tests.
 * Call this in beforeEach to avoid duplicating error handling across test files.
 *
 * @example
 * ```ts
 * test.beforeEach(async ({ page }) => {
 *   setupPageErrorHandling(page);
 * });
 * ```
 */
export function setupPageErrorHandling(page: Page): void {
  page.on('pageerror', (err) => {
    if (
      err.name === 'NotAllowedError' ||
      SUPPRESSED_ERROR_PATTERNS.some((pattern) => err.message.includes(pattern))
    ) {
      return;
    }
  });
}
