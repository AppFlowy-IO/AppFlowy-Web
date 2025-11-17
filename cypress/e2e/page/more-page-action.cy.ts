import { logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';
import { TestTool } from '../../support/page-utils';
import { PageSelectors, waitForReactUpdate } from '../../support/selectors';

describe('More Page Actions', () => {
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

            // Hover over the Getting started page to reveal more actions
            cy.task('log', 'Hovering over Getting started page');
            cy.contains('Getting started')
                .parent()
                .parent()
                .trigger('mouseenter', { force: true })
                .trigger('mouseover', { force: true });

            cy.wait(1000);

            // Click the more actions button
            cy.task('log', 'Clicking more actions button');
            PageSelectors.moreActionsButton().first().click({ force: true });

            waitForReactUpdate(500);

            // Verify the menu is open
            cy.task('log', 'Verifying menu is open');
            cy.get('[data-slot="dropdown-menu-content"]', { timeout: 5000 }).should('exist');

            // Now verify the expected menu items
            cy.task('log', 'Verifying menu items');
            cy.get('[data-slot="dropdown-menu-content"]').within(() => {
                // Look for items by text content since test ids might vary
                cy.contains('Delete').should('exist');
                cy.contains('Duplicate').should('exist');
                cy.contains('Move to').should('exist');
            });

            cy.task('log', 'Successfully verified all core menu items');

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
                        .parent()
                        .parent()
                        .trigger('mouseenter', { force: true })
                        .trigger('mouseover', { force: true });

                    cy.wait(1000);

                    // Click the more actions button
                    cy.task('log', 'Clicking more actions button');
                    PageSelectors.moreActionsButton().first().click({ force: true });

                    waitForReactUpdate(500);

                    // Click Rename option
                    cy.task('log', 'Clicking Rename option');
                    cy.get('[data-slot="dropdown-menu-content"]').within(() => {
                        cy.contains('Rename').click();
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