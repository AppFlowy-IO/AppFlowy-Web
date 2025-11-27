import { AuthTestUtils } from '../../support/auth-utils';
import { TestTool } from '../../support/page-utils';
import { ModalSelectors, PageSelectors, SidebarSelectors, TrashSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail, logAppFlowyEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('Delete Page, Verify in Trash, and Restore Tests', () => {
    let testEmail: string;
    let testPageName: string;

    before(() => {
        // Log environment configuration for debugging
        logAppFlowyEnvironment();
    });

    beforeEach(() => {
        // Generate unique test data for each test
        testEmail = generateRandomEmail();
        testPageName = `test-page-${Date.now()}`;
    });

    describe('Delete Page, Verify in Trash, and Restore', () => {
        it('should create a page, delete it, verify in trash, restore it, and verify it is back in sidebar', () => {
            // Handle uncaught exceptions during workspace creation
            cy.on('uncaught:exception', (err: Error) => {
                if (err.message.includes('No workspace or service found')) {
                    return false;
                }
                return true;
            });

            // Step 1: Login
            testLog.info('=== Step 1: Login ===');
            cy.visit('/login', { failOnStatusCode: false });
            cy.wait(2000);

            const authUtils = new AuthTestUtils();
            authUtils.signInWithTestUrl(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for the app to fully load
                testLog.info('Waiting for app to fully load...');

                // Wait for the loading screen to disappear and main app to appear
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');

                // Wait for the sidebar to be visible (indicates app is loaded)
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });

                // Wait for at least one page to exist in the sidebar
                PageSelectors.names().should('exist', { timeout: 30000 });

                // Additional wait for stability
                cy.wait(2000);

                // Now wait for the new page button to be available
                testLog.info('Looking for new page button...');
                PageSelectors.newPageButton()
                    .should('exist', { timeout: 20000 })
                    .then(() => {
                        testLog.info('New page button found!');
                    });

                // Step 2: Create a new page
                testLog.info(`=== Step 2: Creating page with title: ${testPageName} ===`);

                // Click new page button
                PageSelectors.newPageButton().click();
                waitForReactUpdate(1000);

                // Handle the new page modal
                ModalSelectors.newPageModal().should('be.visible').within(() => {
                    // Select the first available space
                    ModalSelectors.spaceItemInModal().first().click();
                    waitForReactUpdate(500);
                    // Click Add button
                    ModalSelectors.addButton().click();
                });

                // Wait for navigation to the new page
                cy.wait(3000);

                // Close any share/modal dialogs that might be open
                cy.get('body').then(($body: JQuery<HTMLBodyElement>) => {
                    if ($body.find('[role="dialog"]').length > 0 || $body.find('.MuiDialog-container').length > 0) {
                        testLog.info('Closing modal dialog');
                        cy.get('body').type('{esc}');
                        cy.wait(1000);
                    }
                });

                // Set the page title
                PageSelectors.titleInput().should('exist');
                cy.wait(1000);

                PageSelectors.titleInput()
                    .first()
                    .should('be.visible')
                    .click({ force: true })
                    .then($el => {
                        if ($el && $el.length > 0) {
                            cy.wrap($el)
                                .clear({ force: true })
                                .type(testPageName, { force: true })
                                .type('{enter}');
                            testLog.info(`Set page title to: ${testPageName}`);
                        }
                    });

                // Wait for the title to be saved
                cy.wait(2000);

                // Step 3: Verify the page exists in sidebar
                testLog.info('=== Step 3: Verifying page exists in sidebar ===');

                // Expand the first space to see its pages
                TestTool.expandSpace();
                cy.wait(1000);

                // Verify the page exists
                PageSelectors.names().then($pages => {
                    const pageNames = Array.from($pages).map((el: Element) => el.textContent?.trim());
                    testLog.info(`Found pages: ${pageNames.join(', ')}`);

                    // Check if our page exists
                    const pageExists = pageNames.some(name =>
                        name === testPageName || name === 'Untitled'
                    );

                    if (pageExists) {
                        testLog.info(`✓ Page created successfully`);
                    } else {
                        throw new Error(`Could not find created page. Expected "${testPageName}", found: ${pageNames.join(', ')}`);
                    }
                });

                // Step 4: Delete the page
                testLog.info(`=== Step 4: Deleting page: ${testPageName} ===`);

                // Find the page we want to delete
                PageSelectors.names().then($pages => {
                    const pageNames = Array.from($pages).map((el: Element) => el.textContent?.trim());

                    // Determine the actual name of the page to delete
                    let pageToDelete = testPageName;
                    if (!pageNames.includes(testPageName)) {
                        // If our custom name didn't save, it might be "Untitled"
                        const untitledPages = pageNames.filter(name => name === 'Untitled');
                        if (untitledPages.length > 0) {
                            pageToDelete = 'Untitled';
                            testLog.info(`Warning: Page title didn't save. Deleting "Untitled" page instead`);
                        }
                    }

                    // Delete the page
                    TestTool.deletePageByName(pageToDelete);
                    testLog.info(`✓ Deleted page: ${pageToDelete}`);
                });

                // Wait for deletion to complete
                cy.wait(2000);

                // Step 5: Navigate to trash page
                testLog.info('=== Step 5: Navigating to trash page ===');

                // Click on the trash button in the sidebar
                TrashSelectors.sidebarTrashButton().click();

                // Wait for navigation
                cy.wait(2000);

                // Verify we're on the trash page
                cy.url().should('include', '/app/trash');
                testLog.info('✓ Successfully navigated to trash page');

                // Step 6: Verify the deleted page exists in trash
                testLog.info('=== Step 6: Verifying deleted page exists in trash ===');

                // Wait for trash table to load
                TrashSelectors.table().should('be.visible');

                // Look for our deleted page in the trash table
                TrashSelectors.rows().then($rows => {
                    let foundPage = false;

                    // Check each row for our page name
                    $rows.each((index, row) => {
                        const rowText = Cypress.$(row).text();
                        testLog.info(`Trash row ${index + 1}: ${rowText}`);

                        // Check if this row contains our page (might be named as testPageName or "Untitled")
                        if (rowText.includes(testPageName) || rowText.includes('Untitled')) {
                            foundPage = true;
                            testLog.info(`✓ Found deleted page in trash: ${rowText}`);
                        }
                    });

                    // Verify we found the page
                    if (foundPage) {
                        testLog.info('✓✓✓ Test Passed: Deleted page was found in trash');
                    } else {
                        throw new Error(`Deleted page not found in trash. Expected to find "${testPageName}" or "Untitled"`);
                    }
                });

                // Step 7: Verify restore and permanent delete buttons are present
                testLog.info('=== Step 7: Verifying trash actions are available ===');

                TrashSelectors.rows().first().within(() => {
                    // Check for restore button
                    TrashSelectors.restoreButton().should('exist');
                    testLog.info('✓ Restore button found');

                    // Check for permanent delete button
                    TrashSelectors.deleteButton().should('exist');
                    testLog.info('✓ Permanent delete button found');
                });

                // Step 8: Restore the deleted page
                testLog.info('=== Step 8: Restoring the deleted page ===');

                // Store the actual page name we'll be restoring
                let restoredPageName = 'Untitled'; // Default to Untitled since that's what usually gets created

                // Click the restore button on the first row (our deleted page)
                TrashSelectors.rows().first().within(() => {
                    // Get the page name before restoring
                    TrashSelectors.cell().first().invoke('text').then((text) => {
                        restoredPageName = text.trim() || 'Untitled';
                        testLog.info(`Restoring page: ${restoredPageName}`);
                    });

                    // Click restore button
                    TrashSelectors.restoreButton().click();
                });

                // Wait for restore to complete
                cy.wait(2000);
                testLog.info('✓ Restore button clicked');

                // Step 9: Verify the page is removed from trash
                testLog.info('=== Step 9: Verifying page is removed from trash ===');

                // Wait a bit for the UI to update after restore
                cy.wait(2000);

                // Check if trash is now empty or doesn't contain our page
                // Use a more defensive approach - check if rows exist first
                cy.get('body').then($body => {
                    // Check if trash table rows exist
                    const rowsExist = $body.find('[data-testid="trash-table-row"]').length > 0;

                    if (!rowsExist) {
                        testLog.info('✓ Trash is now empty - page successfully removed from trash');
                    } else {
                        // Rows still exist, check if our page is among them
                        TrashSelectors.rows().then($rows => {
                            let pageStillInTrash = false;

                            $rows.each((index, row) => {
                                const rowText = Cypress.$(row).text();
                                if (rowText.includes(restoredPageName)) {
                                    pageStillInTrash = true;
                                }
                            });

                            if (pageStillInTrash) {
                                throw new Error(`Page "${restoredPageName}" is still in trash after restore`);
                            } else {
                                testLog.info(`✓ Page "${restoredPageName}" successfully removed from trash`);
                            }
                        });
                    }
                });

                // Step 10: Navigate back to the main workspace
                testLog.info('=== Step 10: Navigating back to workspace ===');

                // Click on the workspace/home to go back
                cy.visit(`/app`);
                cy.wait(3000);

                // Wait for the sidebar to load
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 10000 });
                testLog.info('✓ Navigated back to workspace');

                // Step 11: Verify the restored page exists in sidebar
                testLog.info('=== Step 11: Verifying restored page exists in sidebar ===');

                // Expand the space to see all pages
                TestTool.expandSpace();
                cy.wait(1000);

                // Verify the restored page exists in the sidebar
                PageSelectors.names().then($pages => {
                    const pageNames = Array.from($pages).map((el: Element) => el.textContent?.trim());
                    testLog.info(`Pages in sidebar after restore: ${pageNames.join(', ')}`);

                    // Check if our restored page exists
                    const pageRestored = pageNames.some(name =>
                        name === restoredPageName || name === testPageName || name === 'Untitled'
                    );

                    if (pageRestored) {
                        testLog.info(`✓✓✓ SUCCESS: Page "${restoredPageName}" has been successfully restored to the sidebar!`);
                    } else {
                        throw new Error(`Restored page not found in sidebar. Expected to find "${restoredPageName}", found: ${pageNames.join(', ')}`);
                    }
                });

                testLog.info('=== Test completed successfully! Page was deleted, verified in trash, and successfully restored! ===');
            });
        });
    });
});
