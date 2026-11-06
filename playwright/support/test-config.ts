import { v4 as uuidv4 } from 'uuid';

import type { BrowserContext, Page } from '@playwright/test';

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

/** The app's runtime config (`window.__APP_CONFIG__`) for a test run. */
export interface RuntimeTestConfig {
  APPFLOWY_BASE_URL: string;
  APPFLOWY_GOTRUE_BASE_URL: string;
  APPFLOWY_WS_BASE_URL: string;
  APPFLOWY_MCP_BASE_URL?: string;
}

/**
 * The runtime config that points the app at the test services named in `env`, or the first
 * service URL `env` leaves unset. Every runtime config injector builds it here, so a new key is
 * added once.
 */
export function runtimeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): { config: RuntimeTestConfig } | { missing: keyof RuntimeTestConfig } {
  const { APPFLOWY_BASE_URL, APPFLOWY_GOTRUE_BASE_URL, APPFLOWY_WS_BASE_URL, APPFLOWY_MCP_BASE_URL } = env;

  if (!APPFLOWY_BASE_URL) return { missing: 'APPFLOWY_BASE_URL' };
  if (!APPFLOWY_GOTRUE_BASE_URL) return { missing: 'APPFLOWY_GOTRUE_BASE_URL' };
  if (!APPFLOWY_WS_BASE_URL) return { missing: 'APPFLOWY_WS_BASE_URL' };
  return {
    config: {
      APPFLOWY_BASE_URL,
      APPFLOWY_GOTRUE_BASE_URL,
      APPFLOWY_WS_BASE_URL,
      // Optional override: without it the build's own value, else Cloud server-info's mcp_url, applies.
      ...(APPFLOWY_MCP_BASE_URL ? { APPFLOWY_MCP_BASE_URL } : {}),
    },
  };
}

/** Point an immutable build at a test server through the app's runtime config. */
export async function installRuntimeTestConfig(
  context: BrowserContext,
  { required = false }: { required?: boolean } = {}
) {
  if (!required && process.env.APPFLOWY_TEST_RUNTIME_CONFIG !== '1') return;
  const runtime = runtimeConfigFromEnv();

  if ('missing' in runtime) throw new Error(`${runtime.missing} must be explicit for runtime test configuration`);

  await context.addInitScript((config) => {
    window.__APP_CONFIG__ = config;
  }, runtime.config);
}

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
    if (err.name === 'NotAllowedError' || SUPPRESSED_ERROR_PATTERNS.some((pattern) => err.message.includes(pattern))) {
      return;
    }
  });
}
