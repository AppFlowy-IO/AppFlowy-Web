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
import './commands';

// Global hooks for console logging
beforeEach(() => {
  // Clear stale localStorage values that could cause issues between tests
  // This prevents the app from trying to navigate to a non-existent view from previous tests
  cy.clearLocalStorage('last_view_id');

  // Clear all IndexedDB databases to remove stale document caches
  // Visit about:blank first to get a window context for IndexedDB operations
  cy.visit('about:blank');
  cy.clearAllIndexedDB();

  // Start capturing console logs for each test
  cy.startConsoleCapture();
  
  // Mock billing endpoints to prevent 502 errors in console
  cy.intercept('GET', '**/billing/api/v1/active-subscription/**', {
    statusCode: 200,
    body: {
      subscription: null,
      status: 'free'
    }
  }).as('billingSubscription');
  
  // Mock other billing endpoints
  cy.intercept('GET', '**/billing/api/**', {
    statusCode: 200,
    body: {}
  }).as('billingAPI');
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