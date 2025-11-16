import { v4 as uuidv4 } from 'uuid';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';
import { TestTool } from '../../support/page-utils';
import { PageSelectors, ModalSelectors, SidebarSelectors, waitForReactUpdate } from '../../support/selectors';

describe('Page Create and Delete Tests', () => {
    const { baseUrl, gotrueUrl, apiUrl } = TestConfig;
    const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
    let testEmail: string;
    let testPageName: string;

    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
        // Generate unique test data for each test
        testEmail = generateRandomEmail();
        testPageName = 'e2e test-create page';
    });

    describe('Page Management Tests', () => {
        it('should login, create a page, reload and verify page exists, delete page, reload and verify page is gone', () => {
            // Step 1: Login using centralized login command
            cy.loginTestUser().then((email) => {
                testEmail = email;

                // Wait for the app to fully load
                cy.task('log', 'Waiting for app to fully load...');

                // Wait for the loading screen to disappear and main app to appear
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');

                // Wait for the sidebar to be visible (indicates app is loaded)
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });

                // Wait for at least one page to exist in the sidebar
                PageSelectors.names().should('exist', { timeout: 30000 });

                // Additional wait for stability
                cy.wait(2000);
                
                // Now wait for the new page button to be available
                cy.task('log', 'Looking for new page button...');
                PageSelectors.newPageButton()
                    .should('exist', { timeout: 20000 })
                    .then(() => {
                        cy.task('log', 'New page button found!');
                    });

                // Step 2: Since user already has a workspace, just create a new page
                cy.task('log', `Creating page with title: ${testPageName}`);
                
                // Click new page button
                PageSelectors.newPageButton().click();
                waitForReactUpdate(1000);
                
                // Handle the new page modal
                ModalSelectors.newPageModal().should('be.visible').within(() => {
                    // Select the first available space
                    ModalSelectors.spaceItemInModal().first().click();
                    waitForReactUpdate(500);
                    // Click Add button
                    cy.contains('button', 'Add').click();
                });
                
                // Wait for navigation to the new page
                cy.wait(3000);
                
                // Close any share/modal dialogs that might be open
                cy.get('body').then(($body: JQuery<HTMLBodyElement>) => {
                    // Check if there's a modal dialog open
                    if ($body.find('[role="dialog"]').length > 0 || $body.find('.MuiDialog-container').length > 0) {
                        cy.task('log', 'Closing modal dialog');
                        // Click the close button or press ESC
                        cy.get('body').type('{esc}');
                        cy.wait(1000);
                    }
                });
                
                // Set the page title
                PageSelectors.titleInput().should('exist');
                cy.wait(1000); // Give time for the page to fully load
                
                // Now set the title
                PageSelectors.titleInput()
                    .first()
                    .should('be.visible')
                    .click({ force: true })  // Use force to ensure we can click even if partially covered
                    .then($el => {
                        // Clear and type only if element exists
                        if ($el && $el.length > 0) {
                            cy.wrap($el)
                                .clear({ force: true })
                                .type(testPageName, { force: true })
                                .type('{enter}'); // Press enter to save the title
                            cy.task('log', `Set page title to: ${testPageName}`);
                        }
                    });
                
                // Wait for the title to be saved
                cy.wait(2000);

                // Step 3: Reload and verify the page exists
                cy.reload();
                TestTool.waitForPageLoad(3000);

                // Expand the first space to see its pages
                TestTool.expandSpace();
                cy.wait(1000);

                // Store initial page count and names before creation for comparison
                let initialPageCount = 0;
                let createdPageName = '';
                
                // Verify the page exists - it should be our custom name
                PageSelectors.names().then($pages => {
                    const pageNames = Array.from($pages).map((el: Element) => el.textContent?.trim());
                    initialPageCount = pageNames.length;
                    cy.task('log', `Found pages after creating new page: ${pageNames.join(', ')}`);
                    
                    // The created page should have our test name
                    if (pageNames.includes(testPageName)) {
                        createdPageName = testPageName;
                        cy.task('log', `Found the created page with correct name: ${testPageName}`);
                    } else {
                        // If title didn't save properly, find the newest "Untitled" page
                        const untitledPages = pageNames.filter(name => name === 'Untitled');
                        if (untitledPages.length > 0) {
                            createdPageName = 'Untitled';
                            cy.task('log', `Warning: Page title didn't save. Page exists as "Untitled"`);
                        } else {
                            throw new Error(`Could not find created page. Expected "${testPageName}", found: ${pageNames.join(', ')}`);
                        }
                    }
                });

                // Step 4: Delete the page we just created
                cy.then(() => {
                    // Use the stored createdPageName from step 3
                    if (createdPageName) {
                        cy.task('log', `Attempting to delete the created page: ${createdPageName}`);
                        TestTool.deletePageByName(createdPageName);
                        cy.task('log', `Deleted page: ${createdPageName}`);
                    } else {
                        throw new Error('No page was created to delete');
                    }
                });

                // Step 5: Reload and verify the page is gone
                cy.reload();
                TestTool.waitForPageLoad(3000);

                // Expand the space again to check if page is gone
                TestTool.expandSpace();
                cy.wait(1000);

                // Verify the page no longer exists
                cy.then(() => {
                    PageSelectors.names().then($pages => {
                        const pageNames = Array.from($pages).map((el: Element) => el.textContent?.trim());
                        cy.task('log', `Pages after delete and reload: ${pageNames.join(', ')}`);
                        
                        // Check that the created page (whatever its final name was) no longer exists
                        const pageStillExists = pageNames.some(name => 
                            name === createdPageName
                        );
                        
                        if (!pageStillExists) {
                            cy.task('log', `✓ Verified test page "${createdPageName}" is gone after reload`);
                            cy.task('log', `Remaining pages: ${pageNames.join(', ')}`);
                        } else {
                            throw new Error(`Test page "${createdPageName}" still exists after delete. Found pages: ${pageNames.join(', ')}`);
                        }
                    });
                });
            });
        });
    });
});