/// <reference types="cypress" />

// Import auth utilities
import './auth-utils';
// Import page utilities
import './page-utils';
// Import console logger v2 (improved version)
import './console-logger';

// ***********************************************
// This example commands.ts shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************

Cypress.Commands.add('mockAPI', () => {
  // Mock the API
});

/**
 * Custom command to login a test user
 * Consolidates the common login flow used across all E2E tests
 *
 * @param email - Optional email address. If not provided, generates a random test email
 * @returns Cypress chainable with the email used for login
 *
 * @example
 * ```typescript
 * // Login with random email
 * cy.loginTestUser().then((email) => {
 *   cy.log(`Logged in as: ${email}`);
 * });
 *
 * // Login with specific email
 * cy.loginTestUser('test@appflowy.io');
 * ```
 */
Cypress.Commands.add('loginTestUser', (email?: string) => {
  const { v4: uuidv4 } = require('uuid');
  const { AuthTestUtils } = require('./auth-utils');

  const testEmail = email || `test-${uuidv4()}@appflowy.io`;

  cy.task('log', `[loginTestUser] Logging in as: ${testEmail}`);

  cy.visit('/login', { failOnStatusCode: false });
  cy.wait(2000);

  const authUtils = new AuthTestUtils();

  return authUtils.signInWithTestUrl(testEmail).then(() => {
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.wait(3000);

    cy.task('log', `[loginTestUser] ✓ Successfully logged in as: ${testEmail}`);

    return cy.wrap(testEmail);
  });
});

// TypeScript declaration for the custom command
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Login a test user with optional email
       * @param email - Optional email address (generates random if not provided)
       * @returns Chainable with the email used
       */
      loginTestUser(email?: string): Chainable<string>;
    }
  }
}

export {};
