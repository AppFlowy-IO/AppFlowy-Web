import { TestTool } from '../../support/page-utils';
import { WorkspaceSelectors, SidebarSelectors, PageSelectors } from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

describe('User Feature Tests', () => {
    const { apiUrl, gotrueUrl, wsUrl } = TestConfig;

    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
        // Ensure viewport is set to MacBook Pro size for each test
        cy.viewport(1440, 900);
    });

    describe('User Login Tests', () => {
        it('should show AppFlowy Web login page, authenticate, and verify workspace', () => {
            let randomEmail: string;

            // Now test the authentication flow
            cy.loginTestUser().then((email) => {
                randomEmail = email;
                // Verify we're on the app page
                cy.url().should('include', '/app');

                cy.task('log', 'Authentication flow completed successfully');

                // Wait for workspace to be fully loaded by checking for key elements
                cy.task('log', 'Waiting for app to fully load...');
                
                // Wait for the loading screen to disappear and main app to appear
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                
                // Wait for the sidebar to be visible (indicates app is loaded)
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                
                // Wait for at least one page to exist in the sidebar
                PageSelectors.names().should('exist', { timeout: 30000 });
                
                // Wait for workspace dropdown to be available
                WorkspaceSelectors.dropdownTrigger().should('be.visible', { timeout: 30000 });
                
                cy.task('log', 'App fully loaded');
                
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
                cy.task('log', `Verified email ${randomEmail} is displayed in dropdown`);

                // Verify one member count
                TestTool.getWorkspaceMemberCounts()
                    .should('contain', '1 member');
                cy.task('log', 'Verified workspace has 1 member');

                // Verify exactly one workspace exists
                TestTool.getWorkspaceItems()
                    .should('have.length', 1);

                // Verify workspace name is present
                WorkspaceSelectors.itemName()
                    .should('exist')
                    .and('not.be.empty');
                cy.task('log', 'Verified one workspace exists');
            });
        });


    });

});