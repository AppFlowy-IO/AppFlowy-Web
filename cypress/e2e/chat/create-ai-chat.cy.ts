import { TestTool } from '../../support/page-utils';
import { AddPageSelectors, PageSelectors, ModalSelectors, SidebarSelectors, ChatSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail, logAppFlowyEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('AI Chat Creation and Navigation Tests', () => {
    let testEmail: string;
    let chatName: string;

    before(() => {
        // Log environment configuration for debugging
        logAppFlowyEnvironment();
    });

    beforeEach(() => {
        // Generate unique test data for each test
        testEmail = generateRandomEmail();
        chatName = `AI Chat ${Date.now()}`;
    });

    describe('Create AI Chat and Open Page', () => {
        it('should create an AI chat and open the chat page without errors', () => {
            // Handle uncaught exceptions during workspace creation
            cy.on('uncaught:exception', (err: Error) => {
                if (err.message.includes('No workspace or service found')) {
                    return false;
                }
                // Handle View not found errors that might occur during navigation
                if (err.message.includes('View not found')) {
                    return false;
                }
                // Also handle any WebSocket related errors for chat
                if (err.message.includes('WebSocket') || err.message.includes('connection')) {
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
                SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
                
                // Wait for at least one page to exist in the sidebar
                PageSelectors.names({ timeout: 30000 }).should('exist');
                
                // Additional wait for stability
                cy.wait(2000);
                
                // Now wait for the new page button to be available
                testLog.info( 'Looking for new page button...');
                PageSelectors.newPageButton({ timeout: 20000 })
                    .should('exist')
                    .then(() => {
                        testLog.info( 'New page button found!');
                    });

                // Step 2: Find a space/document that has the add button
                testLog.info( '=== Step 2: Finding a space/document with add button ===');
                
                // Expand the first space to see its pages
                TestTool.expandSpace();
                cy.wait(1000);
                
                // Find the first page item and hover over it to show actions
                testLog.info( 'Finding first page item to access add actions...');
                
                // Get the first page and hover to show the inline actions
                PageSelectors.items().first().then($page => {
                    testLog.info( 'Hovering over first page to show action buttons...');
                    
                    // Hover over the page to reveal the action buttons
                    cy.wrap($page)
                        .trigger('mouseenter', { force: true })
                        .trigger('mouseover', { force: true });
                    
                    cy.wait(1000);
                    
                    // Click the inline add button (plus icon) - use first() since there might be multiple
                    cy.wrap($page).within(() => {
                        AddPageSelectors.inlineAddButton()
                            .first()
                            .should('be.visible')
                            .click({ force: true });
                    });
                    
                    testLog.info( 'Clicked inline add page button');
                });
                
                // Wait for the dropdown menu to appear
                cy.wait(1000);
                
                // Step 3: Click on AI Chat option from the dropdown
                testLog.info( '=== Step 3: Creating AI Chat ===');
                
                // Click on the AI Chat option in the dropdown
                AddPageSelectors.addAIChatButton()
                    .should('be.visible')
                    .click();
                
                testLog.info( 'Clicked AI Chat option from dropdown');
                
                // Wait for navigation to the AI chat page
                cy.wait(3000);
                
                // Step 4: Verify AI Chat page loaded successfully
                testLog.info( '=== Step 4: Verifying AI Chat page loaded ===');
                
                // Check that the URL contains a view ID (indicating navigation to chat)
                cy.url({ timeout: 20000 }).should('match', /\/app\/[^/]+\/[^/?#]+/);
                testLog.info( '✓ Navigated to AI Chat page');
                
                // Verify AI Chat container renders (chat UI may load async after container is mounted)
                ChatSelectors.aiChatContainer({ timeout: 30000 }).should('be.visible');
                testLog.info( '✓ AI Chat container exists');
                
                // Verify no error messages are displayed
                cy.get('body').then($body => {
                    // Check that there are no error alerts or error pages
                    const hasError = $body.find('.error-message').length > 0 || 
                                   $body.find('[role="alert"]').length > 0 ||
                                   $body.text().includes('Error') ||
                                   $body.text().includes('Something went wrong');
                    
                    if (hasError) {
                        throw new Error('Error detected on AI Chat page');
                    }
                    
                    testLog.info( '✓ No errors detected on page');
                });
                
                // Step 5: Basic verification that we're on a chat page
                testLog.info( '=== Step 5: Final verification ===');
                
                // Simply verify that:
                // 1. We navigated to a new page (URL changed)
                // 2. No major errors are visible
                // 3. The page appears to have loaded
                
                cy.url().then(url => {
                    testLog.info( `Current URL: ${url}`);
                    
                    // Verify we're on a view page
                    if (url.includes('/app/') && url.split('/').length >= 5) {
                        testLog.info( '✓ Successfully navigated to a view page');
                    }
                });
                
                // Final verification
                testLog.info( '=== Test completed successfully! ===');
                testLog.info( '✓✓✓ AI Chat created and opened without errors');
            });
        });
    });
});
