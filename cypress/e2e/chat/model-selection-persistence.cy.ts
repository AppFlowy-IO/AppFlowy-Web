import { TestTool } from '../../support/page-utils';
import { PageSelectors, SidebarSelectors, ModelSelectorSelectors } from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

describe('Chat Model Selection Persistence Tests', () => {
    let testEmail: string;

    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
    });

    describe('Model Selection Persistence', () => {
        it('should persist selected model after page reload', () => {
            // Step 1: Login
            cy.task('log', '=== Step 1: Login ===');

            cy.loginTestUser().then((email) => {
                testEmail = email;
                
                // Step 2: Create an AI Chat
                cy.task('log', '=== Step 2: Creating AI Chat ===');
                
                // Expand the first space to see its pages
                TestTool.expandSpace();
                cy.wait(1000);
                
                // Find the first page item and hover over it to show actions
                PageSelectors.items().first().then($page => {
                    cy.task('log', 'Hovering over first page to show action buttons...');
                    
                    // Hover over the page to reveal the action buttons
                    cy.wrap($page)
                        .trigger('mouseenter', { force: true })
                        .trigger('mouseover', { force: true });
                    
                    cy.wait(1000);
                    
                    // Click the inline add button (plus icon)
                    cy.wrap($page).within(() => {
                        cy.get('[data-testid="inline-add-page"]')
                            .first()
                            .should('be.visible')
                            .click({ force: true });
                    });
                });
                
                // Wait for the dropdown menu to appear
                cy.wait(1000);
                
                // Click on the AI Chat option from the dropdown
                cy.get('[data-testid="add-ai-chat-button"]')
                    .should('be.visible')
                    .click();
                
                cy.task('log', 'Created AI Chat');
                
                // Wait for navigation to the AI chat page
                cy.wait(3000);
                
                // Step 3: Open model selector and select a model
                cy.task('log', '=== Step 3: Selecting a Model ===');
                
                // Wait for the chat interface to load
                cy.wait(2000);
                
                // Click on the model selector button
                ModelSelectorSelectors.button()
                    .should('be.visible', { timeout: 10000 })
                    .click();
                
                cy.task('log', 'Opened model selector dropdown');
                
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
                            cy.task('log', `Selecting model: ${selectedModel}`);
                            cy.wrap(nonAutoOptions[0]).click();
                            
                            // Store the selected model name for verification
                            cy.wrap(selectedModel).as('selectedModel');
                        } else {
                            // If only Auto is available, select it explicitly
                            cy.task('log', 'Only Auto model available, selecting it');
                            ModelSelectorSelectors.optionByName('Auto').click();
                            cy.wrap('Auto').as('selectedModel');
                        }
                    });
                
                // Wait for the selection to be applied
                cy.wait(1000);
                
                // Verify the model is selected by checking the button text
                cy.get('@selectedModel').then((modelName) => {
                    cy.task('log', `Verifying model ${modelName} is displayed in button`);
                    ModelSelectorSelectors.button()
                        .should('contain.text', modelName);
                });
                
                // Step 4: Save the current URL for reload
                cy.task('log', '=== Step 4: Saving current URL ===');
                cy.url().then(url => {
                    cy.wrap(url).as('chatUrl');
                    cy.task('log', `Current chat URL: ${url}`);
                });
                
                // Step 5: Reload the page
                cy.task('log', '=== Step 5: Reloading page ===');
                cy.reload();
                
                // Wait for the page to reload completely
                cy.wait(3000);
                
                // Step 6: Verify the model selection persisted
                cy.task('log', '=== Step 6: Verifying Model Selection Persisted ===');
                
                // Wait for the model selector button to be visible again
                ModelSelectorSelectors.button()
                    .should('be.visible', { timeout: 10000 });
                
                // Verify the previously selected model is still displayed
                cy.get('@selectedModel').then((modelName) => {
                    cy.task('log', `Checking if model ${modelName} is still selected after reload`);
                    ModelSelectorSelectors.button()
                        .should('contain.text', modelName);
                    cy.task('log', `✓ Model ${modelName} persisted after page reload!`);
                });
                
                // Optional: Open the dropdown again to verify the selection visually
                cy.task('log', '=== Step 7: Double-checking selection in dropdown ===');
                ModelSelectorSelectors.button().click();
                cy.wait(1000);
                
                // Verify the selected model has the selected styling
                cy.get('@selectedModel').then((modelName) => {
                    ModelSelectorSelectors.optionByName(modelName as string)
                        .should('have.class', 'bg-fill-content-select');
                    cy.task('log', `✓ Model ${modelName} shows as selected in dropdown`);
                });
                
                // Close the dropdown
                cy.get('body').click(0, 0);
                
                // Final verification
                cy.task('log', '=== Test completed successfully! ===');
                cy.task('log', '✓✓✓ Model selection persisted after page reload');
            });
        });
    });
});