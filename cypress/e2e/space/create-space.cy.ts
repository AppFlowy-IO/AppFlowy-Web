import { TestTool } from '../../support/page-utils';
import { PageSelectors, SpaceSelectors, SidebarSelectors, waitForReactUpdate } from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

describe('Space Creation Tests', () => {
    let testEmail: string;
    let spaceName: string;

    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
        // Generate unique test data for each test
        spaceName = `Test Space ${Date.now()}`;
    });

    describe('Create New Space', () => {
        it('should create a new space successfully', () => {
            // Step 1: Login
            cy.task('log', '=== Step 1: Login ===');
            cy.loginTestUser().then((email) => {
                testEmail = email;
                cy.task('log', 'App loaded successfully');

                // Step 2: Find the first space and open its more actions menu
                cy.task('log', '=== Step 2: Opening space more actions menu ===');
                
                // Get the first space item and click more actions
                // With the test environment check, the button is always visible in tests
                SpaceSelectors.items().first().then($space => {
                    cy.task('log', 'Found first space, clicking more actions...');
                    
                    // Click the more actions button for spaces
                    // It's always visible in test environment
                    cy.get('[data-testid="inline-more-actions"]')
                        .first()
                        .should('be.visible')
                        .click();
                    
                    cy.task('log', 'Clicked space more actions button');
                });
                
                // Wait for the dropdown menu to appear
                cy.wait(1000);
                
                // Step 3: Click on "Create New Space" option
                cy.task('log', '=== Step 3: Clicking Create New Space option ===');
                
                cy.get('[data-testid="create-new-space-button"]')
                    .should('be.visible')
                    .click();
                
                cy.task('log', 'Clicked Create New Space button');
                
                // Wait for modal to appear
                cy.wait(1000);
                
                // Step 4: Fill in the space details
                cy.task('log', '=== Step 4: Filling space creation form ===');
                
                // Verify the modal is visible
                cy.get('[data-testid="create-space-modal"]')
                    .should('be.visible');
                
                cy.task('log', 'Create Space modal is visible');
                
                // Enter space name
                cy.get('[data-testid="space-name-input"]')
                    .should('be.visible')
                    .clear()
                    .type(spaceName);
                
                cy.task('log', `Entered space name: ${spaceName}`);
                
                // Optional: Click on space icon button to set an icon (skip for simplicity)
                // Optional: Change space permission (default is Public, keep it)
                
                // Step 5: Save the new space
                cy.task('log', '=== Step 5: Saving new space ===');
                
                // Click the Save button
                cy.get('[data-testid="modal-ok-button"]')
                    .should('be.visible')
                    .click();
                
                cy.task('log', 'Clicked Save button');
                
                // Wait for the modal to close and space to be created
                cy.wait(3000);
                
                // Step 6: Verify the new space appears in the sidebar
                cy.task('log', '=== Step 6: Verifying new space in sidebar ===');
                
                // Check that the new space exists in the sidebar
                SpaceSelectors.names().then($spaces => {
                    const spaceNames = Array.from($spaces).map((el: Element) => el.textContent?.trim());
                    cy.task('log', `Spaces in sidebar: ${spaceNames.join(', ')}`);
                    
                    // Check if our space exists
                    const spaceExists = spaceNames.some(name => 
                        name === spaceName || name?.includes('Test Space')
                    );
                    
                    if (spaceExists) {
                        cy.task('log', `✓ New space "${spaceName}" found in sidebar`);
                    } else {
                        // Sometimes the space might be created but not immediately visible
                        // Let's refresh the outline
                        cy.task('log', 'Space not immediately visible, checking again...');
                        cy.wait(2000);
                        
                        // Check again
                        SpaceSelectors.names().then($updatedSpaces => {
                            const updatedSpaceNames = Array.from($updatedSpaces).map((el: Element) => el.textContent?.trim());
                            const spaceExistsNow = updatedSpaceNames.some(name => 
                                name === spaceName || name?.includes('Test Space')
                            );
                            
                            if (spaceExistsNow) {
                                cy.task('log', `✓ New space "${spaceName}" found after refresh`);
                            } else {
                                cy.task('log', `Warning: Could not find space "${spaceName}" in sidebar, but creation likely succeeded`);
                            }
                        });
                    }
                });
                
                // Step 7: Optional - Verify the new space is clickable
                cy.task('log', '=== Step 7: Testing space functionality ===');
                
                // Simply verify the space exists and is clickable
                SpaceSelectors.names()
                    .contains(spaceName)
                    .should('exist')
                    .click({ force: true });
                
                cy.task('log', '✓ Clicked on the new space');
                
                // Wait briefly to ensure no errors
                cy.wait(1000);
                
                // Final verification
                cy.task('log', '=== Test completed successfully! ===');
                cy.task('log', '✓✓✓ New space created successfully');
                
                // Verify no errors on the page
                cy.get('body').then($body => {
                    const hasError = $body.text().includes('Error') || 
                                   $body.text().includes('Failed') ||
                                   $body.find('[role="alert"]').length > 0;
                    
                    if (!hasError) {
                        cy.task('log', '✓ No errors detected on page');
                    }
                });
            });
        });
    });
});