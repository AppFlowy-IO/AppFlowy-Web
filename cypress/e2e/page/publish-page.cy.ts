import { logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';
import { TestTool } from '../../support/page-utils';
import { PageSelectors, ShareSelectors, SidebarSelectors } from '../../support/selectors';

describe('Publish Page Test', () => {
    let testEmail: string;
    const pageName = 'publish page';
    const pageContent = 'This is a publish page content';

    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
    });

    it('publish page, copy URL, open in browser, unpublish, and verify inaccessible', () => {
        // 1. Sign in
        cy.loginTestUser().then((email) => {
            testEmail = email;
            cy.url().should('include', '/app');
            cy.task('log', 'Signed in');

            // 2. Wait for app to load
            TestTool.waitForPageLoad();
            TestTool.waitForSidebarReady();

            // 3. Create a new page
            cy.task('log', 'Creating a new page');
            PageSelectors.newPageButton().click();
            cy.wait(3000); // Stable wait for page creation

            // 4. Edit page details
            cy.task('log', 'Editing page details');
            TestTool.editPageTitle(pageName);
            TestTool.addParagraph(pageContent);
            cy.wait(2000); // Wait for changes to save

            // 5. Open share options
            cy.task('log', 'Opening share options');
            ShareSelectors.shareButton().click();
            cy.wait(1000); // Wait for dialog to open

            // 6. Click Publish tab
            cy.task('log', 'Clicking Publish tab');
            ShareSelectors.publishTabButton().click();
            cy.wait(1000);

            // 7. Publish the page
            cy.task('log', 'Publishing the page');
            ShareSelectors.publishConfirmButton().click();
            cy.wait(3000); // Wait for publish action to complete

            // 8. Copy the publish URL
            cy.task('log', 'Copying publish URL');
            ShareSelectors.publishUrlInput().should('exist').and('be.visible');

            ShareSelectors.publishUrlInput().invoke('val').then((url) => {
                expect(url).to.be.a('string').and.not.be.empty;
                cy.task('log', `Publish URL: ${url}`);

                // 9. Open the URL in a new window to verify it's accessible
                cy.task('log', 'Verifying published page is accessible');
                cy.visit(url as string, { failOnStatusCode: false });
                cy.wait(3000); // Wait for page to load

                // Verify that the page is accessible and contains expected content
                cy.contains(pageName, { timeout: 10000 }).should('be.visible');
                cy.contains(pageContent).should('be.visible');
                cy.task('log', 'Published page is accessible');

                // 10. Go back to the main app
                cy.task('log', 'Returning to main app');
                cy.visit('/app');
                TestTool.waitForPageLoad();
                TestTool.waitForSidebarReady();

                // Navigate back to the created page
                cy.task('log', 'Navigating back to the created page');
                cy.contains(pageName).click();
                cy.wait(2000);

                // 11. Open share options again
                cy.task('log', 'Opening share options again');
                ShareSelectors.shareButton().click();
                cy.wait(1000);

                // 12. Click Publish tab
                cy.task('log', 'Clicking Publish tab');
                ShareSelectors.publishTab().click();
                cy.wait(1000);

                // 13. Unpublish the page
                cy.task('log', 'Unpublishing the page');
                ShareSelectors.unpublishButton().click();
                cy.wait(3000); // Wait for unpublish action to complete

                // 14. Verify the page is no longer accessible at the published URL
                cy.task('log', 'Verifying unpublished page is inaccessible');
                cy.visit(url as string, { failOnStatusCode: false });
                cy.wait(3000);

                // The page should now show an error or not be found
                cy.get('body').should('not.contain', pageContent);
                cy.task('log', 'Unpublished page is no longer accessible');
            });
        });
    });
});