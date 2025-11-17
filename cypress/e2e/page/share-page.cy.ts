import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';
import { v4 as uuidv4 } from 'uuid';
import { AuthTestUtils } from '../../support/auth-utils';
import { TestTool } from '../../support/page-utils';
import { PageSelectors, WorkspaceSelectors, waitForReactUpdate } from '../../support/selectors';

describe('Share Page Test', () => {
    const { apiUrl, gotrueUrl } = TestConfig;
    const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;

    let userAEmail: string;
    let userBEmail: string;

    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
        userAEmail = generateRandomEmail();
        userBEmail = generateRandomEmail();
    });

    it('should invite user B to page via email and then remove their access', () => {
        // 1. Sign in as user A
        cy.visit('/login', { failOnStatusCode: false });
        cy.wait(1000);
        const authUtils = new AuthTestUtils();
        authUtils.signInWithTestUrl(userAEmail).then(() => {
            cy.url().should('include', '/app');
            cy.task('log', 'User A signed in');

            // 2. Wait for app to load
            TestTool.waitForPageLoad();
            TestTool.waitForSidebarReady();

            // 3. Create a new page
            cy.task('log', 'Creating a new page');
            PageSelectors.newPageButton().click();
            waitForReactUpdate(1000);

            // 4. Get the page name
            PageSelectors.names().last().invoke('text').then((pageTitle) => {
                cy.task('log', `Page created: ${pageTitle}`);

                // Wait for any modals to close after page creation
                cy.wait(1000);

                // Close any open modals or dialogs
                cy.get('body').then($body => {
                    if ($body.find('[role="dialog"]').length > 0) {
                        cy.get('body').type('{esc}');
                        cy.wait(500);
                    }
                });

                // 5. Open share dialog
                cy.task('log', 'Opening share dialog');
                cy.get('[data-testid="share-button"]').first().click({ force: true });
                waitForReactUpdate(500);

                // 6. Input user B's email
                cy.task('log', `Inviting ${userBEmail} to the page`);
                cy.get('[data-testid="share-input"]').type(userBEmail);
                waitForReactUpdate(500);

                // 7. Select permission level
                cy.get('[data-testid="permission-dropdown"]').click();
                cy.get('[data-testid="permission-can-edit"]').click();
                waitForReactUpdate(500);

                // 8. Click invite button
                cy.get('[data-testid="share-invite-button"]').click();
                cy.wait(2000); // Wait for invitation to be sent

                // 9. Verify user B appears in the share list
                cy.task('log', 'Verifying user B appears in share list');
                cy.get('[data-testid="share-member-list"]').should('contain', userBEmail);

                // 10. Sign out as user A
                cy.task('log', 'Signing out as user A');
                WorkspaceSelectors.dropdownTrigger().click();
                cy.get('[data-testid="logout-button"]').click();
                cy.wait(2000);

                // 11. Sign in as user B
                cy.task('log', 'Signing in as user B');
                cy.visit('/login', { failOnStatusCode: false });
                cy.wait(1000);
                authUtils.signInWithTestUrl(userBEmail).then(() => {
                    cy.url().should('include', '/app');
                    cy.task('log', 'User B signed in');

                    // 12. Wait for app to load
                    TestTool.waitForPageLoad();
                    TestTool.waitForSidebarReady();

                    // 13. Look for the shared page in the sidebar
                    cy.task('log', 'Looking for shared page');
                    cy.get('[data-testid="shared-with-me-section"]').click();
                    cy.wait(1000);
                    cy.contains(pageTitle).should('exist');
                    cy.task('log', 'Shared page found');

                    // 14. Sign out as user B
                    cy.task('log', 'Signing out as user B');
                    WorkspaceSelectors.dropdownTrigger().click();
                    cy.get('[data-testid="logout-button"]').click();
                    cy.wait(2000);

                    // 15. Sign back in as user A
                    cy.task('log', 'Signing back in as user A');
                    cy.visit('/login', { failOnStatusCode: false });
                    cy.wait(1000);
                    authUtils.signInWithTestUrl(userAEmail).then(() => {
                        cy.url().should('include', '/app');
                        cy.task('log', 'User A signed back in');

                        // 16. Wait for app to load
                        TestTool.waitForPageLoad();
                        TestTool.waitForSidebarReady();

                        // 17. Navigate to the created page
                        cy.contains(pageTitle).click();
                        cy.wait(1000);

                        // 18. Open share dialog again
                        cy.task('log', 'Opening share dialog to remove user B');
                        cy.get('[data-testid="share-button"]').click();
                        waitForReactUpdate(500);

                        // 19. Remove user B's access
                        cy.task('log', 'Removing user B access');
                        cy.get(`[data-testid="remove-member-${userBEmail}"]`).click();
                        cy.wait(2000);

                        // 20. Verify user B is removed from the share list
                        cy.task('log', 'Verifying user B is removed from share list');
                        cy.get('[data-testid="share-member-list"]').should('not.contain', userBEmail);

                        // 21. Close the share dialog
                        cy.get('[data-testid="share-dialog-close"]').click();
                        cy.task('log', 'Test completed successfully');
                    });
                });
            });
        });
    });
});