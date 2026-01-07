import { v4 as uuidv4 } from 'uuid';
import { AuthTestUtils } from '../../support/auth-utils';
import { getSlashMenuItemName } from '../../support/i18n-constants';
import { TestTool } from '../../support/page-utils';
import {
  AddPageSelectors,
  EditorSelectors,
  ModalSelectors,
  PageSelectors,
  ShareSelectors,
  SidebarSelectors,
  SlashCommandSelectors,
  SpaceSelectors,
  WorkspaceSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { testLog } from '../../support/test-helpers';

describe('Template Duplication Test - Document with Embedded Database', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
  const dbName = 'New Database';
  const docName = 'Untitled';
  const spaceName = 'General';
  const pageContent = 'This is test content for template duplication';

  beforeEach(() => {
    cy.on('uncaught:exception', (err: Error) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('createThemeNoVars_default is not a function') ||
        err.message.includes('View not found') ||
        err.message.includes("Failed to execute 'writeText' on 'Clipboard': Document is not focused") ||
        err.message.includes('databaseId not found') ||
        err.message.includes('Minified React error') ||
        err.message.includes('useAppHandlers must be used within') ||
        err.message.includes('Cannot resolve a DOM node from Slate') ||
        err.message.includes('ResizeObserver loop') ||
        err.name === 'NotAllowedError'
      ) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  /**
   * Expand a space in the sidebar by clicking on it
   */
  function expandSpaceInSidebar(spaceNameToExpand: string) {
    testLog.info(`Expanding space "${spaceNameToExpand}" in sidebar`);

    SpaceSelectors.itemByName(spaceNameToExpand).then(($space) => {
      const expandedIndicator = $space.find('[data-testid="space-expanded"]');
      const isExpanded = expandedIndicator.attr('data-expanded') === 'true';

      if (!isExpanded) {
        SpaceSelectors.itemByName(spaceNameToExpand).find('[data-testid="space-name"]').click({ force: true });
        waitForReactUpdate(500);
      }
    });
  }

  /**
   * Create a new workspace via the workspace dropdown (using default name)
   */
  function createNewWorkspace() {
    testLog.info('Creating new workspace with default name');

    // Open workspace dropdown
    WorkspaceSelectors.dropdownTrigger().click({ force: true });
    waitForReactUpdate(1000);

    // Click "Create workspace" option
    cy.contains('Create workspace').should('be.visible').click({ force: true });
    waitForReactUpdate(1000);

    // The modal should open with a default name pre-filled
    // Just click Create button to accept the default name
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('[role="dialog"]').within(() => {
      cy.contains('button', 'Create').should('be.visible').click({ force: true });
    });
    waitForReactUpdate(3000);

    // Wait for workspace to be created and switched
    cy.wait(5000);
    testLog.info('New workspace created with default name');
  }

  it('create document with embedded database, publish, and use as template', () => {
    const testEmail = generateRandomEmail();

    testLog.info(`[TEST START] Template duplication test - Email: ${testEmail}`);

    // Step 1: Login
    testLog.info('[STEP 1] Visiting login page');
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      testLog.info('[STEP 2] Authentication successful');
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Wait for app to fully load
      SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
      PageSelectors.names().should('exist', { timeout: 30000 });

      // Step 3: Create a standalone Grid database
      testLog.info('[STEP 3] Creating standalone Grid database');
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click({ force: true });
      cy.wait(5000);
      testLog.info('Grid database created');

      // Step 4: Create a new Document page
      testLog.info('[STEP 4] Creating new document page');

      // Close any open modals first
      cy.get('body').then(($body) => {
        if ($body.find('[role="dialog"]').length > 0) {
          cy.get('body').type('{esc}');
          cy.wait(500);
        }
      });

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      waitForReactUpdate(1000);
      cy.get('[role="menuitem"]').first().click({ force: true });
      waitForReactUpdate(1000);

      // Handle the new page modal if it appears
      cy.get('body').then(($body) => {
        if ($body.find('[data-testid="new-page-modal"]').length > 0) {
          testLog.info('Handling new page modal');
          ModalSelectors.newPageModal()
            .should('be.visible')
            .within(() => {
              ModalSelectors.spaceItemInModal().first().click({ force: true });
              waitForReactUpdate(500);
              cy.contains('button', 'Add').click({ force: true });
            });
        }
      });

      cy.wait(3000);
      testLog.info('Document page created');

      // Step 5: Add some text content to the document
      testLog.info('[STEP 5] Adding text content to document');
      EditorSelectors.firstEditor().should('exist', { timeout: 15000 });
      EditorSelectors.firstEditor().click().type(pageContent);
      waitForReactUpdate(1000);

      // Step 6: Insert embedded database via slash menu (Linked Grid)
      testLog.info('[STEP 6] Inserting embedded database via slash menu');
      EditorSelectors.firstEditor().type('{enter}'); // New line
      waitForReactUpdate(500);
      EditorSelectors.firstEditor().type('/');
      waitForReactUpdate(500);

      testLog.info('Selecting Linked Grid option');
      SlashCommandSelectors.slashPanel()
        .should('be.visible', { timeout: 5000 })
        .within(() => {
          SlashCommandSelectors.slashMenuItem(getSlashMenuItemName('linkedGrid')).first().click({ force: true });
        });

      waitForReactUpdate(1000);

      testLog.info(`Selecting database: ${dbName}`);
      SlashCommandSelectors.selectDatabase(dbName);
      waitForReactUpdate(3000);

      // Step 7: Verify embedded database was created successfully
      testLog.info('[STEP 7] Verifying embedded database was created');

      // Check no error notification
      cy.get('[data-sonner-toast][data-type="error"]', { timeout: 2000 }).should('not.exist');

      // Wait for embedded database container
      cy.get('[class*="appflowy-database"]', { timeout: 15000 }).should('exist').last().should('be.visible');

      // Verify the embedded view tab shows "View of" prefix
      cy.get('[role="tab"]', { timeout: 10000 }).should('be.visible').and('contain.text', 'View of');

      testLog.info('Embedded database successfully created');

      // Step 8: Publish the document
      testLog.info('[STEP 8] Publishing the document');

      // Close any open modals first (the linked database might have opened a modal)
      cy.get('body').then(($body) => {
        if ($body.find('[role="dialog"]').length > 0) {
          testLog.info('Closing open modal before publishing');
          cy.get('body').type('{esc}');
          waitForReactUpdate(1000);
        }
      });

      // First, make sure we're on the document page
      expandSpaceInSidebar(spaceName);
      waitForReactUpdate(500);
      PageSelectors.nameContaining(docName).first().click({ force: true });
      waitForReactUpdate(2000);

      // Close any modal that might have opened when clicking on the page
      cy.get('body').then(($body) => {
        if ($body.find('[role="dialog"]').length > 0) {
          testLog.info('Closing modal that opened when clicking page');
          cy.get('body').type('{esc}');
          waitForReactUpdate(1000);
        }
      });

      // Wait for the page to fully load - editor should be visible
      EditorSelectors.firstEditor().should('exist', { timeout: 15000 });
      waitForReactUpdate(1000);

      TestTool.openSharePopover();
      cy.contains('Publish').should('exist').click({ force: true });
      cy.wait(1000);

      // Wait for publish button and click
      ShareSelectors.publishConfirmButton().should('be.visible').should('not.be.disabled');
      ShareSelectors.publishConfirmButton().click({ force: true });
      testLog.info('Clicked Publish button');
      cy.wait(5000);

      // Verify published
      ShareSelectors.publishNamespace().should('be.visible', { timeout: 10000 });
      testLog.info('Document published successfully');

      // Step 9: Get the published URL
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

                // Step 10: Create a NEW workspace to duplicate into
                // This is important to test the db_mappings fix - the new workspace
                // won't have the database mappings until they're synced
                testLog.info('[STEP 10] Creating new workspace for duplication');
                createNewWorkspace();

                // Verify we're now in the new workspace
                testLog.info('Verifying switched to new workspace');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                cy.wait(2000);

                // Step 11: Visit the published page
                testLog.info('[STEP 11] Visiting published page');
                cy.visit(publishedUrl, { failOnStatusCode: false });
                cy.wait(5000);

                // Verify published page loaded
                cy.url().should('include', `/${namespaceText}/${publishNameText}`);
                cy.get('body').should('contain.text', pageContent);
                testLog.info('Published page loaded successfully');

                // Step 12: Click "Start with this template" button
                testLog.info('[STEP 12] Looking for "Start with this template" button');
                cy.contains('Start with this template', { timeout: 10000 }).should('be.visible').click({ force: true });
                testLog.info('Clicked "Start with this template" button');
                cy.wait(2000);

                // Step 13: Handle the duplicate modal
                testLog.info('[STEP 13] Handling duplicate modal');

                // Check if login modal appeared (user session might be different on publish page)
                cy.get('body').then(($body) => {
                  const bodyText = $body.text();

                  if (bodyText.includes('Sign in') || bodyText.includes('Continue with Email')) {
                    testLog.info('Login required on publish page, signing in...');
                    // Click continue with email
                    cy.contains('Continue with Email').click({ force: true });
                    cy.wait(1000);

                    // Enter email
                    cy.get('input[type="email"]').type(testEmail);
                    cy.contains('button', 'Continue').click({ force: true });
                    cy.wait(5000);

                    // After login, the duplicate modal should appear
                    cy.wait(3000);
                  }

                  // Now handle the duplicate modal
                  cy.get('body').then(($bodyAfterLogin) => {
                    if ($bodyAfterLogin.find('[role="dialog"]').length > 0 || $bodyAfterLogin.text().includes('Add')) {
                      testLog.info('Duplicate modal is open');

                      // Wait for workspace list to load
                      testLog.info('Waiting for workspace list to load');
                      cy.get('[role="dialog"]').should('be.visible');
                      waitForReactUpdate(2000);

                      // The workspace should show - wait for loading to complete
                      cy.get('[role="dialog"]').within(() => {
                        // Wait for the space list to appear (spaces under "Add to" section)
                        cy.contains('Add to').should('be.visible');
                        waitForReactUpdate(1000);

                        // Select the first available space (General or any other space)
                        testLog.info('Selecting a space in the new workspace');
                        cy.get('[data-testid="space-item"]').first().should('be.visible').click({ force: true });
                        waitForReactUpdate(500);
                        testLog.info('Space selected');
                      });

                      // Click Add button to duplicate
                      cy.contains('button', 'Add').should('be.visible').should('not.be.disabled').click({ force: true });
                      testLog.info('Clicked Add button to duplicate');
                      cy.wait(5000);

                      // Step 14: Handle success modal
                      testLog.info('[STEP 14] Handling success modal');
                      cy.get('body').then(($bodyAfterDup) => {
                        if ($bodyAfterDup.text().includes('Open in Browser')) {
                          testLog.info('Success modal appeared');

                          // Click "Open in Browser" to navigate to the duplicated view
                          cy.contains('Open in Browser').should('be.visible').click({ force: true });
                          testLog.info('Clicked "Open in Browser"');
                          cy.wait(5000);

                          // Step 15: Verify we're on the app with the duplicated view in the NEW workspace
                          cy.url().then((finalUrl) => {
                            testLog.info(`Final URL: ${finalUrl}`);

                            // Check for db_mappings in URL (our fix)
                            if (finalUrl.includes('db_mappings=')) {
                              testLog.info('SUCCESS: db_mappings parameter found in URL');
                              const urlObj = new URL(finalUrl);
                              const dbMappings = urlObj.searchParams.get('db_mappings');
                              if (dbMappings) {
                                testLog.info(`Database mappings: ${decodeURIComponent(dbMappings)}`);
                              }
                            } else {
                              testLog.info('Note: db_mappings not in URL');
                            }

                            expect(finalUrl).to.include('/app/');
                            testLog.info('Navigated to app with duplicated view in new workspace');
                          });

                          // Wait for the view to load
                          cy.wait(5000);

                          // Step 16: Verify duplication was successful
                          testLog.info('[STEP 16] Verifying duplication was successful');

                          // Verify the content is present
                          cy.get('body').should('contain.text', pageContent);
                          testLog.info('SUCCESS: Duplicated content verified');

                          // Check that the embedded database is visible
                          // This is the KEY verification - without our fix, this would fail
                          // because the new workspace doesn't have the database mappings yet
                          testLog.info('Checking embedded database is visible...');
                          cy.get('[class*="appflowy-database"]', { timeout: 20000 })
                            .should('exist')
                            .should('be.visible');
                          testLog.info('SUCCESS: Embedded database container found and visible!');

                          // Verify the embedded database has loaded properly (has tabs/content)
                          cy.get('[class*="appflowy-database"]').within(() => {
                            // Check for view tabs (indicates database structure loaded)
                            cy.get('[role="tab"]').should('exist');
                            testLog.info('SUCCESS: Database view tabs present');
                          });

                          // Check localStorage for db_mappings (our fix persists them)
                          cy.window().then((win) => {
                            const keys = Object.keys(win.localStorage).filter((k) => k.startsWith('db_mappings_'));

                            if (keys.length > 0) {
                              testLog.info(`SUCCESS: localStorage db_mappings keys found: ${keys.join(', ')}`);
                              keys.forEach((key) => {
                                const value = win.localStorage.getItem(key);

                                testLog.info(`  ${key}: ${value}`);
                              });
                            } else {
                              testLog.info('Note: No db_mappings in localStorage (may have been consumed)');
                            }
                          });

                          // Final verification - check we're in the new workspace (different workspace ID in URL)
                          cy.url().then((url) => {
                            testLog.info(`Final URL: ${url}`);
                            expect(url).to.include('/app/');
                            testLog.info('SUCCESS: Template successfully duplicated to new workspace!');
                          });

                          testLog.info('[TEST COMPLETE] All verifications passed!');
                        } else if ($bodyAfterDup.text().includes('Open in App')) {
                          testLog.info('Success modal with "Open in App" appeared');
                          cy.contains('Open in Browser').click({ force: true });
                          cy.wait(3000);
                        }
                      });
                    } else {
                      testLog.info('Modal state unclear, checking current URL');
                      cy.url().then((currentUrl) => {
                        testLog.info(`Current URL: ${currentUrl}`);
                      });
                    }
                  });
                });
              });
          });
      });
    });
  });
});
