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
 * Clear all IndexedDB databases to ensure clean test state
 * This removes stale document caches from y-indexeddb and the app's Dexie cache
 */
Cypress.Commands.add('clearAllIndexedDB', () => {
  return cy.window().then(async (win) => {
    try {
      const databases = await win.indexedDB.databases();
      const deletePromises = databases.map((db) => {
        return new Promise<void>((resolve) => {
          if (db.name) {
            const request = win.indexedDB.deleteDatabase(db.name);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve(); // Resolve even on error to not block other deletions
            request.onblocked = () => resolve();
          } else {
            resolve();
          }
        });
      });
      await Promise.all(deletePromises);
      cy.log(`Cleared ${databases.length} IndexedDB databases`);
    } catch (e) {
      cy.log('Failed to clear IndexedDB databases');
    }
  });
});

export {};
