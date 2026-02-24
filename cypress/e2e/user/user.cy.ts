import { TestTool } from '../../support/page-utils';
import { WorkspaceSelectors, SidebarSelectors, PageSelectors } from '../../support/selectors';
import { generateRandomEmail, getTestEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('User Feature Tests', () => {
    const env = getTestEnvironment();
    const APPFLOWY_WS_BASE_URL = Cypress.env('APPFLOWY_WS_BASE_URL');

    before(() => {
        testLog.info( `Test Environment Configuration:
          - APPFLOWY_BASE_URL: ${env.appflowyBaseUrl}
          - APPFLOWY_GOTRUE_BASE_URL: ${env.appflowyGotrueBaseUrl}
          - APPFLOWY_WS_BASE_URL: ${APPFLOWY_WS_BASE_URL ?? ''}
         `);

    });

    beforeEach(() => {
        // Ensure viewport is set to MacBook Pro size for each test
        cy.viewport(1440, 900);
    });

    describe('User Login Tests', () => {
        it('should show AppFlowy Web login page, authenticate, and verify workspace', () => {
            // Handle uncaught exceptions during workspace creation
            cy.on('uncaught:exception', (err: Error) => {
                // Ignore transient pre-initialization errors during E2E
                if (
                    err.message.includes('No workspace or service found') ||
                    err.message.includes('Failed to fetch dynamically imported module')
                ) {
                    return false;
                }
                // Let other errors fail the test
                return true;
            });

            // Now test the authentication flow using shared sign-in helper
            const randomEmail = generateRandomEmail();

            cy.signIn(randomEmail).then(() => {
                // Verify we're on the app page
                cy.url().should('include', '/app');

                testLog.info( 'Authentication flow completed successfully');

                // Wait for workspace to be fully loaded by checking for key elements
                testLog.info( 'Waiting for app to fully load...');
                
                // Wait for the loading screen to disappear and main app to appear
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                
                // Wait for the sidebar to be visible (indicates app is loaded)
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                
                // Wait for at least one page to exist in the sidebar
                PageSelectors.names().should('exist', { timeout: 30000 });
                
                // Wait for workspace dropdown to be available
                WorkspaceSelectors.dropdownTrigger().should('be.visible', { timeout: 30000 });
                
                testLog.info( 'App fully loaded');
                
                // Additional wait for stability
                cy.wait(1000);

                // Open workspace dropdown
                TestTool.openWorkspaceDropdown();

                // Wait for dropdown to open
                cy.wait(500);

                // Verify user email is displayed in the dropdown
                WorkspaceSelectors.dropdownContent().within(() => {
                    cy.contains(randomEmail).should('be.visible');
                });
                testLog.info( `Verified email ${randomEmail} is displayed in dropdown`);

                // Verify one member count
                TestTool.getWorkspaceMemberCounts()
                    .should('contain', '1 member');
                testLog.info( 'Verified workspace has 1 member');

                // Verify exactly one workspace exists
                TestTool.getWorkspaceItems()
                    .should('have.length', 1);

                // Verify workspace name is present
                WorkspaceSelectors.itemName()
                    .should('exist')
                    .and('not.be.empty');
                testLog.info( 'Verified one workspace exists');
            });
        });


    });

});
