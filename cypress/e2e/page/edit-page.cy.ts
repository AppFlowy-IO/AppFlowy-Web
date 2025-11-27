import { AuthTestUtils } from '../../support/auth-utils';
import { TestTool } from '../../support/page-utils';
import { AddPageSelectors, DropdownSelectors, EditorSelectors, ModalSelectors, PageSelectors, SpaceSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('Page Edit Tests', () => {
    let testEmail: string;
    let testPageName: string;
    let testContent: string[];

    beforeEach(() => {
        testEmail = generateRandomEmail();
        testPageName = 'e2e test-edit page';

        // Generate random content for testing
        testContent = [
            `AppFlowy Web`,
            `AppFlowy Web is a modern open-source project management tool that helps you manage your projects and tasks efficiently.`,
        ];
    });

    describe('Page Content Editing Tests', () => {
        it('should sign up, create a page, edit with multiple lines, and verify content', () => {
            // Handle uncaught exceptions during workspace creation
            cy.on('uncaught:exception', (err: Error) => {
                if (err.message.includes('No workspace or service found')) {
                    return false;
                }
                return true;
            });

            // Step 1: Sign up with a new account
            cy.visit('/login', {
                failOnStatusCode: false
            });
            cy.wait(2000);

            const authUtils = new AuthTestUtils();
            authUtils.signInWithTestUrl(testEmail);

            cy.url().should('include', '/app');
            TestTool.waitForPageLoad(3000);

            // Wait for the sidebar to load properly
            TestTool.waitForSidebarReady();
            cy.wait(2000);

            // Step 2: Create a new page using the simpler approach
            testLog.info('=== Starting Page Creation for Edit Test ===');
            testLog.info(`Target page name: ${testPageName}`);

            // Expand General space to ensure we can see the content
            testLog.info('Expanding General space');
            SpaceSelectors.itemByName('General').first().click();
            waitForReactUpdate(500);

            // Use inline add button on General space
            testLog.info('Creating new page in General space');
            SpaceSelectors.itemByName('General').first().within(() => {
                AddPageSelectors.inlineAddButton().first().should('be.visible').click();
            });
            waitForReactUpdate(1000);

            // Select first item (Page) from the menu
            DropdownSelectors.menuItem().first().click();
            waitForReactUpdate(1000);

            // Handle the new page modal if it appears (defensive)
            cy.get('body').then(($body) => {
                if ($body.find('[data-testid="new-page-modal"]').length > 0) {
                    testLog.info('Handling new page modal');
                    ModalSelectors.newPageModal().should('be.visible').within(() => {
                        ModalSelectors.spaceItemInModal().first().click();
                        waitForReactUpdate(500);
                        ModalSelectors.addButton().click();
                    });
                    cy.wait(3000);
                }
            });

            // Close any remaining modal dialogs
            cy.get('body').then(($body: JQuery<HTMLBodyElement>) => {
                if ($body.find('[role="dialog"]').length > 0 || $body.find('.MuiDialog-container').length > 0) {
                    testLog.info('Closing modal dialog');
                    cy.get('body').type('{esc}');
                    cy.wait(1000);
                }
            });

            // Click the newly created "Untitled" page
            testLog.info('Selecting the new Untitled page');
            PageSelectors.itemByName('Untitled').should('be.visible').click();
            waitForReactUpdate(1000);

            // Step 3: Add content to the page editor
            testLog.info('=== Adding Content to Page ===');

            // Wait for editor to be available and add content
            testLog.info('Waiting for editor to be available');
            EditorSelectors.firstEditor().should('exist', { timeout: 15000 });

            testLog.info('Writing content to editor');
            EditorSelectors.firstEditor().click().type(testContent.join('{enter}'));

            // Wait for content to be saved
            cy.wait(2000);

            // Step 4: Verify the content was added
            testLog.info('=== Verifying Content ===');

            // Verify each line of content exists in the page
            testContent.forEach(line => {
                cy.contains(line).should('exist');
                testLog.info(`✓ Found content: "${line}"`);
            });

            testLog.info('=== Test completed successfully ===');
        });
    });
});
