import 'cypress-real-events';
import {
  AuthSelectors,
  DatabaseGridSelectors,
  PageSelectors,
  SpaceSelectors,
  ViewActionSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import {
  openRowDetail,
  closeRowDetailWithEscape,
  RowDetailSelectors,
} from '../../support/row-detail-helpers';
import { TestConfig } from '../../support/test-config';

const _exportUserEmail = 'export_user@appflowy.io';
const _exportUserPassword = 'AppFlowy!@123';
const _testDatabaseName = 'Database 1';
const _spaceName = 'General';
const _gettingStartedPageName = 'Getting started';

/**
 * Expand a space in the sidebar by clicking on it if not already expanded
 */
function expandSpaceInSidebar(spaceNameToExpand: string) {
  cy.log(`[HELPER] Expanding space "${spaceNameToExpand}" in sidebar`);

  SpaceSelectors.itemByName(spaceNameToExpand, { timeout: 30000 }).then(($space) => {
    const expandedIndicator = $space.find('[data-testid="space-expanded"]');
    const isExpanded = expandedIndicator.attr('data-expanded') === 'true';

    if (!isExpanded) {
      SpaceSelectors.itemByName(spaceNameToExpand).find('[data-testid="space-name"]').click({ force: true });
      waitForReactUpdate(1000);
    }
  });
}

/**
 * Expand a page in the sidebar by clicking its expand toggle if not already expanded
 */
function expandPageInSidebar(pageName: string) {
  cy.log(`[HELPER] Expanding page "${pageName}" in sidebar`);

  PageSelectors.itemByName(pageName, { timeout: 30000 }).then(($pageItem) => {
    const expandToggle = $pageItem.find('[data-testid="outline-toggle-expand"]');
    if (expandToggle.length > 0) {
      cy.wrap(expandToggle).first().click({ force: true });
      waitForReactUpdate(1000);
    }
  });
}

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
    cy.wait(5000);

    // Step 2: Enter email
    cy.log('[STEP 2] Entering email address');
    AuthSelectors.emailInput().should('be.visible', { timeout: 30000 }).type(_exportUserEmail);
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

    // Step 11: Expand the General space and Getting started, then open Database 1
    cy.log('[STEP 11] Expanding General space and Getting started page');
    expandSpaceInSidebar(_spaceName);
    waitForReactUpdate(1000);
    expandPageInSidebar(_gettingStartedPageName);
    waitForReactUpdate(1000);
    cy.log('[STEP 11.1] Opening Database 1');
    PageSelectors.nameContaining(_testDatabaseName).first().click({ force: true });
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
    PageSelectors.nameContaining(duplicatePrefix).first().click({ force: true });
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

    // Step 20.1: Open first row detail page and add marker to row document
    cy.log('[STEP 20.1] Opening first row detail page in duplicated database');
    openRowDetail(0);
    waitForReactUpdate(1000);

    // Step 20.2: Verify document area exists
    cy.log('[STEP 20.2] Verifying document area exists in row detail');
    RowDetailSelectors.documentArea().should('exist');

    // Step 20.3: Add marker to row document
    const rowDocumentMarker = `row-doc-marker-${Date.now()}`;
    cy.log(`[STEP 20.3] Adding marker to row document: ${rowDocumentMarker}`);
    // Find the Slate editor within the row detail modal and type in it
    RowDetailSelectors.modal()
      .find('[data-slate-editor="true"]')
      .first()
      .scrollIntoView()
      .click({ force: true })
      .type(rowDocumentMarker, { delay: 30, force: true });
    waitForReactUpdate(1000);

    // Step 20.4: Verify the marker was added to row document
    cy.log('[STEP 20.4] Verifying marker was added to row document');
    RowDetailSelectors.modal().should('contain.text', rowDocumentMarker);

    // Step 20.5: Close row detail
    cy.log('[STEP 20.5] Closing row detail page');
    closeRowDetailWithEscape();
    waitForReactUpdate(1000);

    // Step 21: Open the original database
    cy.log('[STEP 21] Opening the original database');
    // Ensure space and Getting started are still expanded
    expandSpaceInSidebar(_spaceName);
    waitForReactUpdate(500);
    expandPageInSidebar(_gettingStartedPageName);
    waitForReactUpdate(500);
    // Find the original database by looking for elements containing "Database 1" but NOT "(Copy)"
    PageSelectors.nameContaining(_testDatabaseName)
      .filter((index, el) => {
        const text = Cypress.$(el).text().trim();
        return !text.includes('(Copy)');
      })
      .first()
      .click({ force: true });
    waitForReactUpdate(3000);

    // Step 22: Wait for original database grid to load
    cy.log('[STEP 22] Waiting for original database grid to load');
    DatabaseGridSelectors.grid({ timeout: 30000 }).should('exist');
    waitForReactUpdate(2000);

    // Step 23: Verify the marker is NOT in the original database
    cy.log('[STEP 23] Verifying cell marker is NOT in original database');
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
        'Original database should not contain duplicate cell edits'
      );
    });

    // Step 23.1: Open first row detail page in original database
    cy.log('[STEP 23.1] Opening first row detail page in original database');
    openRowDetail(0);
    waitForReactUpdate(1000);

    // Step 23.2: Verify row document does NOT contain the marker
    cy.log('[STEP 23.2] Verifying row document marker is NOT in original database');
    RowDetailSelectors.documentArea().then(($doc) => {
      const docText = $doc.text();
      expect(docText).to.not.include(
        'row-doc-marker-',
        'Original row document should not contain duplicate edits'
      );
    });

    // Step 23.3: Close row detail
    cy.log('[STEP 23.3] Closing row detail page');
    closeRowDetailWithEscape();
    waitForReactUpdate(1000);

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
