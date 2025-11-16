import { v4 as uuidv4 } from 'uuid';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';
import { TestTool } from '../../support/page-utils';
import { PageSelectors, ModalSelectors, waitForReactUpdate } from '../../support/selectors';

describe('Page Edit Tests', () => {
    const { baseUrl, gotrueUrl, apiUrl } = TestConfig;
    const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;
    let testEmail: string;
    let testPageName: string;
    let testContent: string[];

    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
        testEmail = generateRandomEmail();
        testPageName = 'e2e test-edit page';

        // Generate random content for testing
        const randomId = uuidv4().slice(0, 8);
        testContent = [
            `AppFlowy Web`,
            `AppFlowy Web is a modern open-source project management tool that helps you manage your projects and tasks efficiently.`,
        ];
    });

    describe('Page Content Editing Tests', () => {
        it('should sign up, create a page, edit with multiple lines, and verify content', () => {
            // Step 1: Sign up with a new account using centralized login
            cy.loginTestUser().then((email) => {
                testEmail = email;
                TestTool.waitForPageLoad(3000);

                // Wait for the sidebar to load properly
                TestTool.waitForSidebarReady();
                cy.wait(2000);

                // Step 2: Create a new page using the simpler approach
                cy.task('log', '=== Starting Page Creation for Edit Test ===');
                cy.task('log', `Target page name: ${testPageName}`);

                // Click new page button
                PageSelectors.newPageButton().should('be.visible').click();
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

                // Close any modal dialogs
                cy.get('body').then(($body: JQuery<HTMLBodyElement>) => {
                    if ($body.find('[role="dialog"]').length > 0 || $body.find('.MuiDialog-container').length > 0) {
                        cy.task('log', 'Closing modal dialog');
                        cy.get('body').type('{esc}');
                        cy.wait(1000);
                    }
                });

                // Step 3: Add content to the page editor
                cy.task('log', '=== Adding Content to Page ===');

                // Find the editor and add content
                cy.get('[contenteditable="true"]').then($editors => {
                    cy.task('log', `Found ${$editors.length} editable elements`);

                    // Look for the main editor (not the title)
                    let editorFound = false;
                    $editors.each((index: number, el: HTMLElement) => {
                        const $el = Cypress.$(el);
                        // Skip title inputs
                        if (!$el.attr('data-testid')?.includes('title') && !$el.hasClass('editor-title')) {
                            cy.task('log', `Using editor at index ${index}`);
                            cy.wrap(el).click().type(testContent.join('{enter}'));
                            editorFound = true;
                            return false; // break the loop
                        }
                    });

                    if (!editorFound) {
                        // Fallback: use the last contenteditable element
                        cy.task('log', 'Using fallback: last contenteditable element');
                        cy.wrap($editors.last()).click().type(testContent.join('{enter}'));
                    }
                });

                // Wait for content to be saved
                cy.wait(2000);

                // Step 4: Verify the content was added
                cy.task('log', '=== Verifying Content ===');

                // Verify each line of content exists in the page
                testContent.forEach(line => {
                    cy.contains(line).should('exist');
                    cy.task('log', `✓ Found content: "${line}"`);
                });

                cy.task('log', '=== Test completed successfully ===');
            });
        });
    });
});