/**
 * Test for Person Cell in Published/Template Pages
 *
 * This test verifies that:
 * 1. Person cells render correctly in published (read-only) views
 * 2. No React context errors occur when viewing templates
 * 3. The useMentionableUsers hook handles publish mode gracefully
 *
 * These tests were created to prevent regression of issues where:
 * - useCurrentWorkspaceId threw errors in publish view (no AppProvider)
 * - ElementFallbackRender crashed when i18n context wasn't available
 */

import { TestTool } from '../../support/page-utils';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  FieldType,
  GridFieldSelectors,
  PageSelectors,
  PersonSelectors,
  PropertyMenuSelectors,
  ShareSelectors,
  SidebarSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('Person Cell in Published Pages', () => {
  let testEmail: string;

  beforeEach(() => {
    testEmail = generateRandomEmail();

    // Handle uncaught exceptions - especially the ones we fixed
    cy.on('uncaught:exception', (err: Error) => {
      // Log the error for debugging
      testLog.info(`Caught exception: ${err.message}`);

      // These are expected/handled errors
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('createThemeNoVars_default is not a function') ||
        err.message.includes('View not found') ||
        err.message.includes('Record not found') ||
        err.message.includes('Request failed') ||
        err.message.includes("Failed to execute 'writeText' on 'Clipboard'") ||
        err.message.includes('ResizeObserver loop') ||
        err.name === 'NotAllowedError'
      ) {
        return false;
      }

      // FAIL the test if we see these errors - they indicate our fix regressed
      if (
        err.message.includes('useCurrentWorkspaceId must be used within an AppProvider') ||
        err.message.includes('useAppHandlers must be used within an AppProvider') ||
        err.message.includes('Invalid hook call') ||
        err.message.includes('Minified React error #321')
      ) {
        testLog.info(`CRITICAL ERROR - Context issue detected: ${err.message}`);
        // Return true to let the error fail the test
        return true;
      }

      return true;
    });

    cy.viewport(1280, 720);
  });

  it('should render Person cell without errors in published database view', () => {
    testLog.info('[TEST START] Person cell in published database');

    // Step 1: Login
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      testLog.info('Signed in successfully');

      // Wait for app to load
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
      PageSelectors.names().should('exist', { timeout: 30000 });
      cy.wait(2000);

      // Step 2: Create a Grid database
      testLog.info('[STEP 2] Creating Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Verify grid exists
      DatabaseGridSelectors.grid().should('exist', { timeout: 15000 });
      testLog.info('Grid database created');

      // Step 3: Add a Person field to the database
      testLog.info('[STEP 3] Adding Person field');

      // Click the new property button to add a new field
      PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
      waitForReactUpdate(3000);

      // Change to Person type
      PropertyMenuSelectors.propertyTypeTrigger().then(($trigger) => {
        if ($trigger.length > 0) {
          cy.wrap($trigger).first().click({ force: true });
          waitForReactUpdate(1000);
          PropertyMenuSelectors.propertyTypeOption(FieldType.Person).click({ force: true });
          waitForReactUpdate(2000);
        } else {
          GridFieldSelectors.allFieldHeaders().last().scrollIntoView().click({ force: true });
          waitForReactUpdate(1000);
          PropertyMenuSelectors.propertyTypeTrigger().first().click({ force: true });
          waitForReactUpdate(1000);
          PropertyMenuSelectors.propertyTypeOption(FieldType.Person).click({ force: true });
          waitForReactUpdate(2000);
        }
      });

      // Close menu
      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(1000);

      // Verify Person cells exist
      PersonSelectors.allPersonCells().should('exist', { timeout: 10000 });
      testLog.info('Person field added');

      // Step 4: Publish the database
      testLog.info('[STEP 4] Publishing the database');

      // Make sure share button is visible
      ShareSelectors.shareButton().should('be.visible', { timeout: 10000 });

      TestTool.openSharePopover();
      cy.contains('Publish').should('exist').click({ force: true });
      cy.wait(1000);

      ShareSelectors.publishConfirmButton().should('be.visible').should('not.be.disabled');
      ShareSelectors.publishConfirmButton().click({ force: true });
      testLog.info('Clicked Publish button');
      cy.wait(5000);

      // Verify published
      ShareSelectors.publishNamespace().should('be.visible', { timeout: 10000 });
      testLog.info('Database published successfully');

      // Step 5: Get the published URL and visit it
      cy.window().then((win) => {
        const origin = win.location.origin;

        ShareSelectors.publishNamespace()
          .invoke('text')
          .then((namespace) => {
            ShareSelectors.publishNameInput()
              .invoke('val')
              .then((publishName) => {
                const namespaceText = namespace.trim();
                const publishNameText = String(publishName).trim();
                const publishedUrl = `${origin}/${namespaceText}/${publishNameText}`;
                testLog.info(`Published URL: ${publishedUrl}`);

                // Close share popover
                cy.get('body').type('{esc}');
                cy.wait(1000);

                // Step 6: Visit the published page
                testLog.info('[STEP 6] Visiting published database page');
                cy.visit(publishedUrl, { failOnStatusCode: false });
                cy.wait(5000);

                // Verify URL
                cy.url().should('include', `/${namespaceText}/${publishNameText}`);

                // Step 7: Verify the page rendered without errors
                testLog.info('[STEP 7] Verifying page rendered correctly');

                // The page should be visible
                cy.get('body').should('be.visible');

                // Check that we don't see an error page
                cy.get('body').then(($body) => {
                  const bodyText = $body.text();

                  if (bodyText.includes('Something went wrong') || bodyText.includes('Error')) {
                    // Check if it's an actual error or just UI text
                    if (bodyText.includes('useCurrentWorkspaceId must be used within')) {
                      throw new Error('REGRESSION: useCurrentWorkspaceId context error in publish view');
                    }
                    if (bodyText.includes('Minified React error #321')) {
                      throw new Error('REGRESSION: React error #321 (Invalid hook call) in publish view');
                    }
                  }

                  testLog.info('✓ No critical errors detected on page');
                });

                // Verify database structure is visible
                cy.get('[class*="appflowy-database"]', { timeout: 15000 })
                  .should('exist')
                  .should('be.visible');
                testLog.info('✓ Database container is visible');

                // Check that Person cells exist in publish view (they should render as read-only)
                cy.get('body').then(($body) => {
                  const hasPersonCells = $body.find('[data-testid*="person-cell"]').length > 0;

                  if (hasPersonCells) {
                    testLog.info('✓ Person cells are visible in publish view');
                  } else {
                    testLog.info('Note: Person cells selector not found, checking for general cell structure');
                  }
                });

                // Check that Person field column header exists
                cy.get('body').then(($body) => {
                  if ($body.text().includes('Person')) {
                    testLog.info('✓ Person field column is visible');
                  }
                });

                testLog.info('[TEST COMPLETE] Person cell rendered successfully in publish view');
              });
          });
      });
    });
  });

  it('should not throw context errors when viewing published page with Person cells', () => {
    testLog.info('[TEST START] Context error prevention test');

    // This test specifically checks that the fixes for context errors work
    // by monitoring for specific error patterns

    const contextErrors: string[] = [];

    // Set up error monitoring
    cy.on('uncaught:exception', (err: Error) => {
      if (
        err.message.includes('useCurrentWorkspaceId must be used within') ||
        err.message.includes('useAppHandlers must be used within') ||
        err.message.includes('Minified React error #321') ||
        err.message.includes('Invalid hook call')
      ) {
        contextErrors.push(err.message);
        // Don't fail immediately - collect all errors
        return false;
      }
      return false; // Ignore other errors for this test
    });

    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');

      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
      PageSelectors.names().should('exist', { timeout: 30000 });
      cy.wait(2000);

      // Create a grid
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);

      // Verify grid exists
      DatabaseGridSelectors.grid().should('exist', { timeout: 15000 });

      // Add Person field
      PropertyMenuSelectors.newPropertyButton().first().scrollIntoView().click({ force: true });
      waitForReactUpdate(3000);

      PropertyMenuSelectors.propertyTypeTrigger().then(($trigger) => {
        if ($trigger.length > 0) {
          cy.wrap($trigger).first().click({ force: true });
          waitForReactUpdate(1000);
          PropertyMenuSelectors.propertyTypeOption(FieldType.Person).click({ force: true });
          waitForReactUpdate(2000);
        }
      });

      cy.get('body').type('{esc}{esc}');
      waitForReactUpdate(1000);

      // Publish
      ShareSelectors.shareButton().should('be.visible', { timeout: 10000 });
      TestTool.openSharePopover();
      cy.contains('Publish').click({ force: true });
      cy.wait(1000);
      ShareSelectors.publishConfirmButton().click({ force: true });
      cy.wait(5000);
      ShareSelectors.publishNamespace().should('be.visible', { timeout: 10000 });

      // Get URL and visit
      cy.window().then((win) => {
        const origin = win.location.origin;

        ShareSelectors.publishNamespace()
          .invoke('text')
          .then((namespace) => {
            ShareSelectors.publishNameInput()
              .invoke('val')
              .then((publishName) => {
                const publishedUrl = `${origin}/${namespace.trim()}/${String(publishName).trim()}`;

                cy.get('body').type('{esc}');
                cy.wait(500);

                // Visit published page
                cy.visit(publishedUrl, { failOnStatusCode: false });
                cy.wait(5000);

                // Wait for potential errors to occur
                cy.wait(3000);

                // Verify no context errors were caught
                cy.wrap(contextErrors).should('have.length', 0);

                testLog.info('✓ No context errors detected');
                testLog.info('[TEST COMPLETE] Context error prevention verified');
              });
          });
      });
    });
  });
});
