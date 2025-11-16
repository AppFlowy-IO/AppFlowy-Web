import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';
import { TestTool } from '../../support/page-utils';
import { PageSelectors, waitForReactUpdate } from '../../support/selectors';

describe('More Page Actions', () => {
    const { apiUrl, gotrueUrl } = TestConfig;
    const newPageName = 'Renamed Test Page';
    let testEmail: string;

    before(() => {
        logTestEnvironment();
    });

    beforeEach(function () {
        setupCommonExceptionHandlers();
    });

    it('should open the More actions menu for a page (verify visibility of core items)', () => {
        // Sign in first
        cy.loginTestUser().then((email) => {
            testEmail = email;

            cy.url().should('include', '/app');
            TestTool.waitForPageLoad(3000);

            // Wait for the sidebar to load properly
            TestTool.waitForSidebarReady();
            cy.wait(2000);

            // Skip expanding space since Getting started is already visible
            cy.task('log', 'Page already visible, skipping expand');

            // Open the first available page from the sidebar, then trigger inline ViewActionsPopover via "..." on the row
            // Find the Getting started page and hover to reveal the more actions
            cy.task('log', 'Looking for Getting started page');

            // Find the page by its text content
            cy.contains('Getting started').should('exist').and('be.visible');

            // Hover over the page item to reveal the more actions button
            cy.task('log', 'Hovering over page item to reveal more actions');
            cy.contains('Getting started')
                .parents('[data-testid*="view-item"]')
                .first()
                .trigger('mouseenter', { force: true })
                .wait(500);

            // Find and click the more actions button (...)
            cy.task('log', 'Looking for more actions button');
            cy.contains('Getting started')
                .parents('[data-testid*="view-item"]')
                .first()
                .within(() => {
                    // Try multiple ways to find the more actions button
                    cy.get('[data-testid="view-item-more-actions"]')
                        .should('exist')
                        .and('be.visible')
                        .click({ force: true });
                });

            waitForReactUpdate(500);

            // Verify the popover is open
            cy.task('log', 'Verifying popover is open');
            cy.get('[data-testid="more-actions-popover"]').should('exist').and('be.visible');
            cy.wait(500);

            // Now verify the expected menu items
            cy.task('log', 'Verifying menu items in popover');
            cy.get('[data-testid="more-actions-popover"]').within(() => {
                // Check for Delete option
                cy.task('log', 'Checking for Delete option');
                cy.get('[data-testid="delete-page-option"]')
                    .should('exist')
                    .and('be.visible')
                    .and('contain.text', 'Delete');

                // Check for Rename option
                cy.task('log', 'Checking for Rename option');
                cy.get('[data-testid="rename-page-option"]')
                    .should('exist')
                    .and('be.visible')
                    .and('contain.text', 'Rename');

                // Check for Duplicate option
                cy.task('log', 'Checking for Duplicate option');
                cy.get('[data-testid="duplicate-page-option"]')
                    .should('exist')
                    .and('be.visible')
                    .and('contain.text', 'Duplicate');

                // Optional: Check for additional menu items
                cy.task('log', 'Successfully verified all core menu items in More actions popover');
            });

            // Close the popover
            cy.task('log', 'Closing popover');
            cy.get('body').click(0, 0);
        });
    });

    it('should rename a page using More actions menu', () => {
        // Sign in first
        cy.loginTestUser().then((email) => {
            testEmail = email;

            cy.url().should('include', '/app');
            TestTool.waitForPageLoad(3000);

            // Wait for the sidebar to load properly
            TestTool.waitForSidebarReady();
            cy.wait(2000);

            // Create a new page first
            cy.task('log', 'Creating a new page to rename');
            PageSelectors.newPageButton().click();
            waitForReactUpdate(1000);

            // Get the created page name
            cy.task('log', 'Getting the newly created page');
            PageSelectors.names()
                .last()
                .invoke('text')
                .then((pageName) => {
                    cy.task('log', `Created page: ${pageName}`);

                    // Hover over the created page to reveal more actions
                    cy.task('log', 'Hovering over the created page');
                    PageSelectors.names()
                        .last()
                        .parents('[data-testid*="view-item"]')
                        .first()
                        .trigger('mouseenter', { force: true })
                        .wait(500);

                    // Click the more actions button
                    cy.task('log', 'Clicking more actions button');
                    PageSelectors.names()
                        .last()
                        .parents('[data-testid*="view-item"]')
                        .first()
                        .within(() => {
                            cy.get('[data-testid="view-item-more-actions"]')
                                .should('exist')
                                .and('be.visible')
                                .click({ force: true });
                        });

                    waitForReactUpdate(500);

                    // Click Rename option
                    cy.task('log', 'Clicking Rename option');
                    cy.get('[data-testid="more-actions-popover"]').within(() => {
                        cy.get('[data-testid="rename-page-option"]').click();
                    });

                    waitForReactUpdate(500);

                    // Type the new name
                    cy.task('log', `Renaming to: ${newPageName}`);
                    cy.focused()
                        .clear()
                        .type(newPageName)
                        .type('{enter}');

                    waitForReactUpdate(1000);

                    // Verify the rename was successful
                    cy.task('log', 'Verifying rename was successful');
                    cy.contains(newPageName).should('exist').and('be.visible');
                });
        });
    });
});