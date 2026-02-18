import { TestTool } from '../../support/page-utils';
import { AddPageSelectors, PageSelectors, SidebarSelectors, ModelSelectorSelectors } from '../../support/selectors';
import { generateRandomEmail, logAppFlowyEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('Chat Model Selection Persistence Tests', () => {
    let testEmail: string;

    before(() => {
        // Log environment configuration for debugging
        logAppFlowyEnvironment();
    });

    beforeEach(() => {
        // Generate unique test data for each test
        testEmail = generateRandomEmail();
    });

    describe('Model Selection Persistence', () => {
        it('should persist selected model after page reload', () => {
            // Handle uncaught exceptions during workspace creation
            cy.on('uncaught:exception', (err: Error) => {
                if (err.message.includes('No workspace or service found')) {
                    return false;
                }
                if (err.message.includes('View not found')) {
                    return false;
                }
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
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                
                // Wait for at least one page to exist in the sidebar
                PageSelectors.names().should('exist', { timeout: 30000 });
                
                // Additional wait for stability
                cy.wait(2000);
                
                // Step 2: Create an AI Chat
                testLog.info( '=== Step 2: Creating AI Chat ===');
                
                // Expand the first space to see its pages
                TestTool.expandSpace();
                cy.wait(1000);
                
                // Find the first page item and hover over it to show actions
                PageSelectors.items().first().then($page => {
                    testLog.info( 'Hovering over first page to show action buttons...');
                    
                    // Hover over the page to reveal the action buttons
                    cy.wrap($page)
                        .trigger('mouseenter', { force: true })
                        .trigger('mouseover', { force: true });
                    
                    cy.wait(1000);
                    
                    // Click the inline add button (plus icon)
                    cy.wrap($page).within(() => {
                        AddPageSelectors.inlineAddButton()
                            .first()
                            .should('be.visible')
                            .click({ force: true });
                    });
                });
                
                // Wait for the dropdown menu to appear
                cy.wait(1000);
                
                // Click on the AI Chat option from the dropdown
                AddPageSelectors.addAIChatButton()
                    .should('be.visible')
                    .click();
                
                testLog.info( 'Created AI Chat');
                
                // Wait for navigation to the AI chat page
                cy.wait(3000);
                
                // Step 3: Open model selector and select a model
                testLog.info( '=== Step 3: Selecting a Model ===');
                
                // Wait for the chat interface to load
                cy.wait(2000);
                
                // Click on the model selector button
                ModelSelectorSelectors.button()
                    .should('be.visible', { timeout: 10000 })
                    .click();
                
                testLog.info( 'Opened model selector dropdown');
                
                // Wait for the dropdown to appear and models to load
                cy.wait(2000);
                
                // Select a specific model (we'll select the first non-Auto model if available)
                ModelSelectorSelectors.options()
                    .then($options => {
                        // Find a model that's not "Auto"
                        const nonAutoOptions = $options.filter((i, el) => {
                            const testId = el.getAttribute('data-testid');
                            return testId && !testId.includes('model-option-Auto');
                        });
                        
                        if (nonAutoOptions.length > 0) {
                            // Click the first non-Auto model
                            const selectedModel = nonAutoOptions[0].getAttribute('data-testid')?.replace('model-option-', '');
                            testLog.info( `Selecting model: ${selectedModel}`);
                            cy.wrap(nonAutoOptions[0]).click();
                            
                            // Store the selected model name for verification
                            cy.wrap(selectedModel).as('selectedModel');
                        } else {
                            // If only Auto is available, select it explicitly
                            testLog.info( 'Only Auto model available, selecting it');
                            ModelSelectorSelectors.optionByName('Auto').click();
                            cy.wrap('Auto').as('selectedModel');
                        }
                    });
                
                // Wait for the selection to be applied
                cy.wait(1000);
                
                // Verify the model is selected by checking the button text
                cy.get('@selectedModel').then((modelName) => {
                    testLog.info( `Verifying model ${modelName} is displayed in button`);
                    ModelSelectorSelectors.button()
                        .should('contain.text', modelName);
                });
                
                // Step 4: Save the current URL for reload
                testLog.info( '=== Step 4: Saving current URL ===');
                cy.url().then(url => {
                    cy.wrap(url).as('chatUrl');
                    testLog.info( `Current chat URL: ${url}`);
                });
                
                // Step 5: Reload the page
                testLog.info( '=== Step 5: Reloading page ===');
                cy.reload();
                
                // Wait for the page to reload completely
                cy.wait(3000);
                
                // Step 6: Verify the model selection persisted
                testLog.info( '=== Step 6: Verifying Model Selection Persisted ===');
                
                // Wait for the model selector button to be visible again
                ModelSelectorSelectors.button()
                    .should('be.visible', { timeout: 10000 });
                
                // Verify the previously selected model is still displayed
                cy.get('@selectedModel').then((modelName) => {
                    testLog.info( `Checking if model ${modelName} is still selected after reload`);
                    ModelSelectorSelectors.button()
                        .should('contain.text', modelName);
                    testLog.info( `✓ Model ${modelName} persisted after page reload!`);
                });
                
                // Optional: Open the dropdown again to verify the selection visually
                testLog.info( '=== Step 7: Double-checking selection in dropdown ===');
                ModelSelectorSelectors.button().click();
                cy.wait(1000);
                
                // Verify the selected model has the selected styling
                cy.get('@selectedModel').then((modelName) => {
                    ModelSelectorSelectors.optionByName(modelName as string)
                        .should('have.class', 'bg-fill-content-select');
                    testLog.info( `✓ Model ${modelName} shows as selected in dropdown`);
                });
                
                // Close the dropdown
                cy.get('body').click(0, 0);
                
                // Final verification
                testLog.info( '=== Test completed successfully! ===');
                testLog.info( '✓✓✓ Model selection persisted after page reload');
            });
        });
    });
});
