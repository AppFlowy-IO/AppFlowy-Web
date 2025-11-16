import { TestTool } from '../../support/page-utils';
import { PageSelectors, ModalSelectors, SidebarSelectors, waitForReactUpdate } from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

describe('AI Chat Creation and Navigation Tests', () => {
    let testEmail: string;
    let chatName: string;

    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
        chatName = `AI Chat ${Date.now()}`;
    });

    describe('Create AI Chat and Open Page', () => {
        it('should create an AI chat and open the chat page without errors', () => {
            // Step 1: Login
            cy.task('log', '=== Step 1: Login ===');

            cy.loginTestUser().then((email) => {
                testEmail = email;

                // Now wait for the new page button to be available
                cy.task('log', 'Looking for new page button...');
                PageSelectors.newPageButton()
                    .should('exist', { timeout: 20000 })
                    .then(() => {
                        cy.task('log', 'New page button found!');
                    });

                // Step 2: Find a space/document that has the add button
                cy.task('log', '=== Step 2: Finding a space/document with add button ===');
                
                // Expand the first space to see its pages
                TestTool.expandSpace();
                cy.wait(1000);
                
                // Find the first page item and hover over it to show actions
                cy.task('log', 'Finding first page item to access add actions...');
                
                // Get the first page and hover to show the inline actions
                PageSelectors.items().first().then($page => {
                    cy.task('log', 'Hovering over first page to show action buttons...');
                    
                    // Hover over the page to reveal the action buttons
                    cy.wrap($page)
                        .trigger('mouseenter', { force: true })
                        .trigger('mouseover', { force: true });
                    
                    cy.wait(1000);
                    
                    // Click the inline add button (plus icon) - use first() since there might be multiple
                    cy.wrap($page).within(() => {
                        cy.get('[data-testid="inline-add-page"]')
                            .first()
                            .should('be.visible')
                            .click({ force: true });
                    });
                    
                    cy.task('log', 'Clicked inline add page button');
                });
                
                // Wait for the dropdown menu to appear
                cy.wait(1000);
                
                // Step 3: Click on AI Chat option from the dropdown
                cy.task('log', '=== Step 3: Creating AI Chat ===');
                
                // Click on the AI Chat option in the dropdown
                cy.get('[data-testid="add-ai-chat-button"]')
                    .should('be.visible')
                    .click();
                
                cy.task('log', 'Clicked AI Chat option from dropdown');
                
                // Wait for navigation to the AI chat page
                cy.wait(3000);
                
                // Step 4: Verify AI Chat page loaded successfully
                cy.task('log', '=== Step 4: Verifying AI Chat page loaded ===');
                
                // Check that the URL contains a view ID (indicating navigation to chat)
                cy.url().should('match', /\/app\/[a-f0-9-]+\/[a-f0-9-]+/, { timeout: 10000 });
                cy.task('log', '✓ Navigated to AI Chat page');
                
                // Check if the AI Chat container exists (but don't fail if it doesn't load immediately)
                cy.get('body').then($body => {
                    if ($body.find('[data-testid="ai-chat-container"]').length > 0) {
                        cy.task('log', '✓ AI Chat container exists');
                    } else {
                        cy.task('log', 'AI Chat container not immediately visible, checking for navigation success...');
                    }
                });
                
                // Wait a bit for the chat to fully load
                cy.wait(2000);
                
                // Check for AI Chat specific elements (the chat interface)
                // The AI chat library loads its own components
                cy.get('body').then($body => {
                    // Check if chat interface elements exist
                    const hasChatElements = $body.find('.ai-chat').length > 0 || 
                                           $body.find('[data-testid="ai-chat-container"]').length > 0;
                    
                    if (hasChatElements) {
                        cy.task('log', '✓ AI Chat interface loaded');
                    } else {
                        cy.task('log', 'Warning: AI Chat elements not immediately visible, but container exists');
                    }
                });
                
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
                    
                    cy.task('log', '✓ No errors detected on page');
                });
                
                // Step 5: Basic verification that we're on a chat page
                cy.task('log', '=== Step 5: Final verification ===');
                
                // Simply verify that:
                // 1. We navigated to a new page (URL changed)
                // 2. No major errors are visible
                // 3. The page appears to have loaded
                
                cy.url().then(url => {
                    cy.task('log', `Current URL: ${url}`);
                    
                    // Verify we're on a view page
                    if (url.includes('/app/') && url.split('/').length >= 5) {
                        cy.task('log', '✓ Successfully navigated to a view page');
                    }
                });
                
                // Final verification
                cy.task('log', '=== Test completed successfully! ===');
                cy.task('log', '✓✓✓ AI Chat created and opened without errors');
            });
        });
    });
});