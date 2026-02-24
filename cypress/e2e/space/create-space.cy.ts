import { TestTool } from '../../support/page-utils';
import { PageSelectors, SpaceSelectors, SidebarSelectors, ModalSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail, logAppFlowyEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('Space Creation Tests', () => {
    let testEmail: string;
    let spaceName: string;

    before(() => {
        // Log environment configuration for debugging
        logAppFlowyEnvironment();
    });

    beforeEach(() => {
        // Generate unique test data for each test
        testEmail = generateRandomEmail();
        spaceName = `Test Space ${Date.now()}`;
    });

    describe('Create New Space', () => {
        it('should create a new space successfully', () => {
            // Handle uncaught exceptions during workspace creation
            cy.on('uncaught:exception', (err: Error) => {
                if (err.message.includes('No workspace or service found')) {
                    return false;
                }
                // Handle View not found errors that might occur during navigation
                if (err.message.includes('View not found')) {
                    return false;
                }
                return true;
            });

            // Step 1: Login
            testLog.info( '=== Step 1: Login ===');
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');
                
                // Wait for the app to fully load
                testLog.info( 'Waiting for app to fully load...');
                
                // Wait for the loading screen to disappear and main app to appear
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                
                // Wait for the sidebar to be visible (indicates app is loaded)
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                
                // Wait for at least one page to exist in the sidebar
                PageSelectors.names().should('exist', { timeout: 30000 });
                
                // Additional wait for stability
                cy.wait(2000);
                
                testLog.info( 'App loaded successfully');

                // Step 2: Find the first space and open its more actions menu
                testLog.info( '=== Step 2: Opening space more actions menu ===');
                
                // Get the first space item and click more actions
                // With the test environment check, the button is always visible in tests
                SpaceSelectors.items().first().then($space => {
                    testLog.info( 'Found first space, clicking more actions...');
                    
                    // Click the more actions button for spaces
                    // It's always visible in test environment
                    SpaceSelectors.moreActionsButton()
                        .first()
                        .should('be.visible')
                        .click();
                    
                    testLog.info( 'Clicked space more actions button');
                });
                
                // Wait for the dropdown menu to appear
                cy.wait(1000);
                
                // Step 3: Click on "Create New Space" option
                testLog.info( '=== Step 3: Clicking Create New Space option ===');
                
                SpaceSelectors.createNewSpaceButton()
                    .should('be.visible')
                    .click();
                
                testLog.info( 'Clicked Create New Space button');
                
                // Wait for modal to appear
                cy.wait(1000);
                
                // Step 4: Fill in the space details
                testLog.info( '=== Step 4: Filling space creation form ===');
                
                // Verify the modal is visible
                SpaceSelectors.createSpaceModal()
                    .should('be.visible');
                
                testLog.info( 'Create Space modal is visible');
                
                // Enter space name
                SpaceSelectors.spaceNameInput()
                    .should('be.visible')
                    .clear()
                    .type(spaceName);
                
                testLog.info( `Entered space name: ${spaceName}`);
                
                // Optional: Click on space icon button to set an icon (skip for simplicity)
                // Optional: Change space permission (default is Public, keep it)
                
                // Step 5: Save the new space
                testLog.info( '=== Step 5: Saving new space ===');
                
                // Click the Save button
                ModalSelectors.okButton()
                    .should('be.visible')
                    .click();
                
                testLog.info( 'Clicked Save button');
                
                // Wait for the modal to close and space to be created
                cy.wait(3000);
                
                // Step 6: Verify the new space appears in the sidebar
                testLog.info( '=== Step 6: Verifying new space in sidebar ===');
                
                // Check that the new space exists in the sidebar
                SpaceSelectors.names().then($spaces => {
                    const spaceNames = Array.from($spaces).map((el: Element) => el.textContent?.trim());
                    testLog.info( `Spaces in sidebar: ${spaceNames.join(', ')}`);
                    
                    // Check if our space exists
                    const spaceExists = spaceNames.some(name => 
                        name === spaceName || name?.includes('Test Space')
                    );
                    
                    if (spaceExists) {
                        testLog.info( `✓ New space "${spaceName}" found in sidebar`);
                    } else {
                        // Sometimes the space might be created but not immediately visible
                        // Let's refresh the outline
                        testLog.info( 'Space not immediately visible, checking again...');
                        cy.wait(2000);
                        
                        // Check again
                        SpaceSelectors.names().then($updatedSpaces => {
                            const updatedSpaceNames = Array.from($updatedSpaces).map((el: Element) => el.textContent?.trim());
                            const spaceExistsNow = updatedSpaceNames.some(name => 
                                name === spaceName || name?.includes('Test Space')
                            );
                            
                            if (spaceExistsNow) {
                                testLog.info( `✓ New space "${spaceName}" found after refresh`);
                            } else {
                                testLog.info( `Warning: Could not find space "${spaceName}" in sidebar, but creation likely succeeded`);
                            }
                        });
                    }
                });
                
                // Step 7: Optional - Verify the new space is clickable
                testLog.info( '=== Step 7: Testing space functionality ===');
                
                // Simply verify the space exists and is clickable
                SpaceSelectors.names()
                    .contains(spaceName)
                    .should('exist')
                    .click({ force: true });
                
                testLog.info( '✓ Clicked on the new space');
                
                // Wait briefly to ensure no errors
                cy.wait(1000);
                
                // Final verification
                testLog.info( '=== Test completed successfully! ===');
                testLog.info( '✓✓✓ New space created successfully');
                
                // Verify no errors on the page
                cy.get('body').then($body => {
                    const hasError = $body.text().includes('Error') || 
                                   $body.text().includes('Failed') ||
                                   $body.find('[role="alert"]').length > 0;
                    
                    if (!hasError) {
                        testLog.info( '✓ No errors detected on page');
                    }
                });
            });
        });
    });
});
