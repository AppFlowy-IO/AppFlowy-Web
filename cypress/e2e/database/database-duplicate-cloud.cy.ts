import {
  AuthSelectors,
  DatabaseGridSelectors,
  PageSelectors,
  ViewActionSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { TestConfig } from '../../support/test-config';

const _exportUserEmail = 'export_user@appflowy.io';
const _exportUserPassword = 'AppFlowy!@123';
const _testDatabaseName = 'Database 1';

describe('Cloud Database Duplication', () => {
  const { gotrueUrl } = TestConfig;

  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  it('should duplicate Database 1 and verify data independence', () => {
    cy.log(`[TEST START] Testing cloud database duplication with: ${_exportUserEmail}`);

    // Step 1: Visit login page
    cy.log('[STEP 1] Visiting login page');
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    // Step 2: Enter email
    cy.log('[STEP 2] Entering email address');
    AuthSelectors.emailInput().should('be.visible').type(_exportUserEmail);
    cy.wait(500);

    // Step 3: Click on "Sign in with password" button
    cy.log('[STEP 3] Clicking sign in with password button');
    AuthSelectors.passwordSignInButton().should('be.visible').click();
    cy.wait(1000);

    // Step 4: Verify we're on the password page
    cy.log('[STEP 4] Verifying password page loaded');
    cy.url().should('include', 'action=enterPassword');

    // Step 5: Enter password
    cy.log('[STEP 5] Entering password');
    AuthSelectors.passwordInput().should('be.visible').type(_exportUserPassword);
    cy.wait(500);

    // Step 6: Submit password
    cy.log('[STEP 6] Submitting password for authentication');
    AuthSelectors.passwordSubmitButton().should('be.visible').click();

    // Step 7: Wait for successful login
    cy.log('[STEP 7] Waiting for successful login');
    cy.url({ timeout: 30000 }).should('include', '/app');

    // Step 8: Wait for the app to fully load
    cy.log('[STEP 8] Waiting for app to fully load');
    cy.wait(5000);

    // Step 9: Wait for data sync (similar to desktop test's 30 second wait)
    cy.log('[STEP 9] Waiting for data sync');
    // Wait for page list to appear
    PageSelectors.names({ timeout: 60000 }).should('exist');
    cy.wait(5000);

    // Step 10: Delete any existing duplicate databases (cleanup)
    cy.log('[STEP 10] Cleaning up existing duplicate databases');
    const copySuffix = ' (Copy)';
    const duplicatePrefix = `${_testDatabaseName}${copySuffix}`;

    // Check and delete existing duplicates
    cy.get('body').then(($body) => {
      const duplicatePages = $body.find(`[data-testid="page-name"]:contains("${duplicatePrefix}")`);
      if (duplicatePages.length > 0) {
        cy.log(`[STEP 10.1] Found ${duplicatePages.length} existing duplicates, deleting them`);
        // Delete each duplicate found
        duplicatePages.each((index, el) => {
          const pageName = Cypress.$(el).text().trim();
          if (pageName.startsWith(duplicatePrefix)) {
            PageSelectors.moreActionsButton(pageName).click({ force: true });
            waitForReactUpdate(500);
            ViewActionSelectors.deleteButton().click({ force: true });
            waitForReactUpdate(500);
            cy.get('body').then(($body2) => {
              if ($body2.find('[data-testid="confirm-delete-button"]').length > 0) {
                cy.get('[data-testid="confirm-delete-button"]').click({ force: true });
              }
            });
            waitForReactUpdate(1000);
          }
        });
      }
    });

    // Step 11: Open Database 1
    cy.log('[STEP 11] Opening Database 1');
    PageSelectors.nameContaining(_testDatabaseName).first().click();
    waitForReactUpdate(3000);

    // Step 12: Wait for database grid to load
    cy.log('[STEP 12] Waiting for database grid to load');
    DatabaseGridSelectors.grid({ timeout: 30000 }).should('exist');
    waitForReactUpdate(2000);

    // Step 13: Count original rows
    cy.log('[STEP 13] Counting original rows');
    let originalRowCount = 0;
    DatabaseGridSelectors.dataRows().then(($rows) => {
      originalRowCount = $rows.length;
      cy.log(`[STEP 13.1] Original database has ${originalRowCount} rows`);
      expect(originalRowCount).to.be.greaterThan(0, 'Expected rows in the source database');
    });

    // Step 14: Duplicate the database
    cy.log('[STEP 14] Duplicating the database');
    PageSelectors.moreActionsButton(_testDatabaseName).click({ force: true });
    waitForReactUpdate(500);

    cy.log('[STEP 14.1] Clicking duplicate button');
    ViewActionSelectors.duplicateButton().should('be.visible').click();
    waitForReactUpdate(3000);

    // Step 15: Wait for duplicate to appear in sidebar
    cy.log('[STEP 15] Waiting for duplicate to appear in sidebar');
    PageSelectors.nameContaining(duplicatePrefix, { timeout: 90000 }).should('exist');
    waitForReactUpdate(2000);

    // Step 16: Open the duplicated database
    cy.log('[STEP 16] Opening the duplicated database');
    PageSelectors.nameContaining(duplicatePrefix).first().click();
    waitForReactUpdate(3000);

    // Step 17: Wait for duplicated database grid to load
    cy.log('[STEP 17] Waiting for duplicated database grid to load');
    DatabaseGridSelectors.grid({ timeout: 30000 }).should('exist');
    waitForReactUpdate(2000);

    // Step 18: Verify duplicated row count matches original
    cy.log('[STEP 18] Verifying duplicated row count');
    DatabaseGridSelectors.dataRows().then(($rows) => {
      const duplicatedRowCount = $rows.length;
      cy.log(`[STEP 18.1] Duplicated database has ${duplicatedRowCount} rows`);
      expect(duplicatedRowCount).to.equal(
        originalRowCount,
        'Duplicated database should preserve row count'
      );
    });

    // Step 19: Edit a cell in the duplicated database
    cy.log('[STEP 19] Editing a cell in the duplicated database');
    const marker = `db-duplicate-marker-${Date.now()}`;

    DatabaseGridSelectors.cells().first().click();
    waitForReactUpdate(500);
    cy.focused().clear();
    cy.focused().type(marker);
    cy.focused().type('{enter}');
    waitForReactUpdate(1000);

    // Step 20: Verify the marker was added
    cy.log('[STEP 20] Verifying marker was added to duplicated database');
    DatabaseGridSelectors.cells().first().should('contain.text', marker);

    // Step 21: Open the original database
    cy.log('[STEP 21] Opening the original database');
    PageSelectors.nameContaining(_testDatabaseName)
      .filter((index, el) => {
        const text = Cypress.$(el).text().trim();
        return text === _testDatabaseName;
      })
      .first()
      .click();
    waitForReactUpdate(3000);

    // Step 22: Wait for original database grid to load
    cy.log('[STEP 22] Waiting for original database grid to load');
    DatabaseGridSelectors.grid({ timeout: 30000 }).should('exist');
    waitForReactUpdate(2000);

    // Step 23: Verify the marker is NOT in the original database
    cy.log('[STEP 23] Verifying marker is NOT in original database');
    DatabaseGridSelectors.cells().then(($cells) => {
      let markerFound = false;
      $cells.each((index, cell) => {
        if (Cypress.$(cell).text().includes(marker)) {
          markerFound = true;
          return false;
        }
      });

      expect(markerFound).to.equal(
        false,
        'Original database should not contain duplicate edits'
      );
    });

    // Step 24: Cleanup - delete the duplicated database
    cy.log('[STEP 24] Cleaning up - deleting duplicated database');
    PageSelectors.nameContaining(duplicatePrefix).first().then(($el) => {
      const duplicateName = $el.text().trim();
      PageSelectors.moreActionsButton(duplicateName).click({ force: true });
      waitForReactUpdate(500);
      ViewActionSelectors.deleteButton().should('be.visible').click();
      waitForReactUpdate(500);
      cy.get('body').then(($body) => {
        if ($body.find('[data-testid="confirm-delete-button"]').length > 0) {
          cy.get('[data-testid="confirm-delete-button"]').click({ force: true });
        }
      });
    });

    cy.log('[STEP 25] Cloud database duplication test completed successfully');
  });
});
