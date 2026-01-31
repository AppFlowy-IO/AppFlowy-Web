// ***********************************************************
// This example support/e2e.ts is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import 'cypress-file-upload';
import 'cypress-plugin-api';
import 'cypress-real-events';
import '@4tw/cypress-drag-drop';
import './commands';

// Global hooks for console logging
beforeEach(() => {
  // Start capturing console logs for each test
  cy.startConsoleCapture();
  
  // Mock billing endpoints to prevent errors in console
  // API expects {code: 0, data: {...}, message: 'success'} format
  // Note: More specific patterns must be registered AFTER general ones in Cypress

  // Mock /billing/api/v1/subscriptions - returns array of subscriptions
  cy.intercept('GET', '**/billing/api/v1/subscriptions', {
    statusCode: 200,
    body: {
      code: 0,
      data: [],  // Empty array of subscriptions
      message: 'success'
    }
  }).as('billingSubscriptions');

  // Mock /billing/api/v1/active-subscription/{workspaceId} - returns array of active plans
  cy.intercept('GET', '**/billing/api/v1/active-subscription/**', {
    statusCode: 200,
    body: {
      code: 0,
      data: [],  // Empty array of active subscription plans
      message: 'success'
    }
  }).as('billingActiveSubscription');
});

afterEach(() => {
  // Print console logs summary after each test
  // This ensures logs are visible in CI output even if the test fails
  cy.printConsoleLogsSummary();

  // Stop capturing to clean up
  cy.stopConsoleCapture();
});

// Globally ignore transient app bootstrap errors during tests
Cypress.on('uncaught:exception', (err) => {
  if (
    err.message.includes('No workspace or service found') ||
    err.message.includes('Failed to fetch dynamically imported module') ||
    /Record not found|unknown error/i.test(err.message) ||
    err.message.includes('Reduce of empty array with no initial value')
  ) {
    return false;
  }
  return true;
});
