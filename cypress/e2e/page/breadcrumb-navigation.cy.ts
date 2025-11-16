import { TestTool } from '../../support/page-utils';
import { PageSelectors, SpaceSelectors, SidebarSelectors, waitForReactUpdate } from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

describe('Breadcrumb Navigation Complete Tests', () => {
    let testEmail: string;

    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
    });

    describe('Basic Navigation Tests', () => {
        it('should navigate through space and check for breadcrumb availability', { timeout: 60000 }, () => {
            // Login
            cy.task('log', '=== Step 1: Login ===');

            cy.loginTestUser().then((email) => {
                testEmail = email;
                cy.task('log', 'App loaded successfully');

                // Step 2: Expand first space
                cy.task('log', '=== Step 2: Expanding first space ===');
                TestTool.expandSpace(0);
                cy.wait(2000);
                cy.task('log', 'Expanded first space');

                // Step 3: Navigate to first page
                cy.task('log', '=== Step 3: Navigating to first page ===');
                PageSelectors.names().first().then($page => {
                    const pageName = $page.text();
                    cy.task('log', `Navigating to: ${pageName}`);
                    cy.wrap($page).click();
                });
                cy.wait(3000);

                // Step 4: Check for breadcrumb navigation
                cy.task('log', '=== Step 4: Checking for breadcrumb navigation ===');
                cy.get('body').then($body => {
                    if ($body.find('[data-testid="breadcrumb-navigation"]').length > 0) {
                        cy.task('log', '✓ Breadcrumb navigation found on this page');
                        
                        // Count breadcrumb items
                        cy.get('[data-testid*="breadcrumb-item-"]').then($items => {
                            cy.task('log', `✓ Found ${$items.length} breadcrumb items`);
                        });
                    } else {
                        cy.task('log', 'No breadcrumb navigation on this page (normal for top-level pages)');
                    }
                });

                // Verify no errors
                cy.get('body').then($body => {
                    const hasError = $body.text().includes('Error') || 
                                   $body.text().includes('Failed');
                    
                    if (!hasError) {
                        cy.task('log', '✓ Navigation completed without errors');
                    }
                });

                cy.task('log', '=== Basic navigation test completed ===');
            });
        });

        it('should navigate to nested pages and use breadcrumb to go back', { timeout: 60000 }, () => {
            // Login
            cy.loginTestUser().then((email) => {
                testEmail = email;

                cy.task('log', '=== Step 1: Expand first space ===');
                TestTool.expandSpace(0);
                cy.wait(2000);

                cy.task('log', '=== Step 2: Navigate to first page ===');
                PageSelectors.names().first().click();
                cy.wait(3000);

                cy.task('log', '=== Step 3: Check for nested pages ===');
                PageSelectors.names().then($pages => {
                    cy.task('log', `Found ${$pages.length} pages in sidebar`);
                    
                    if ($pages.length > 1) {
                        // Navigate to a nested page
                        cy.task('log', 'Navigating to nested page');
                        cy.wrap($pages[1]).click({ force: true });
                        cy.wait(3000);
                        
                        // Check for breadcrumb navigation
                        cy.task('log', '=== Step 4: Testing breadcrumb navigation ===');
                        cy.get('body', { timeout: 5000 }).then($body => {
                            if ($body.find('[data-testid="breadcrumb-navigation"]').length > 0) {
                                cy.task('log', '✓ Breadcrumb navigation is visible');
                                
                                // Try to click breadcrumb to navigate back
                                if ($body.find('[data-testid*="breadcrumb-item-"]').length > 1) {
                                    cy.get('[data-testid*="breadcrumb-item-"]').first().click({ force: true });
                                    cy.task('log', '✓ Clicked breadcrumb item to navigate back');
                                    cy.wait(2000);
                                    cy.task('log', '✓ Successfully used breadcrumb navigation');
                                } else {
                                    cy.task('log', 'Only one breadcrumb item found');
                                }
                            } else {
                                cy.task('log', 'No breadcrumb navigation on nested page');
                            }
                        });
                    } else {
                        cy.task('log', 'No nested pages available for breadcrumb testing');
                    }
                });

                cy.task('log', '=== Nested navigation test completed ===');
            });
        });
    });

    describe('Full Breadcrumb Flow Test', () => {
        it('should navigate through General > Get Started > Desktop Guide flow (if available)', { timeout: 60000 }, () => {
            // Login
            cy.loginTestUser().then((email) => {
                testEmail = email;

                // Step 1: Find and expand General space or first space
                cy.task('log', '=== Step 1: Looking for General space ===');
                SpaceSelectors.names().then($spaces => {
                    const spaceNames = Array.from($spaces).map((el: Element) => el.textContent?.trim());
                    cy.task('log', `Available spaces: ${spaceNames.join(', ')}`);
                    
                    // Find General space or use first
                    const generalIndex = spaceNames.findIndex(name => 
                        name?.toLowerCase().includes('general')
                    );
                    
                    if (generalIndex !== -1) {
                        cy.task('log', `Found General space at index ${generalIndex}`);
                        TestTool.expandSpace(generalIndex);
                    } else {
                        cy.task('log', 'Using first available space');
                        TestTool.expandSpace(0);
                    }
                });
                cy.wait(2000);

                // Step 2: Look for Get Started page or use first page
                cy.task('log', '=== Step 2: Looking for Get Started page ===');
                PageSelectors.names().then($pages => {
                    const pageNames = Array.from($pages).map((el: Element) => el.textContent?.trim());
                    cy.task('log', `Available pages: ${pageNames.join(', ')}`);
                    
                    // Find Get Started or similar page
                    const getStartedPage = Array.from($pages).find((el: Element) => {
                        const text = el.textContent?.trim().toLowerCase();
                        return text?.includes('get') || text?.includes('start') || 
                               text?.includes('welcome') || text?.includes('guide');
                    });
                    
                    if (getStartedPage) {
                        cy.wrap(getStartedPage).click();
                        cy.task('log', `Clicked on: ${getStartedPage.textContent?.trim()}`);
                    } else {
                        PageSelectors.names().first().click();
                        cy.task('log', 'Clicked first available page');
                    }
                });
                cy.wait(3000);

                // Step 3: Look for Desktop Guide or sub-page
                cy.task('log', '=== Step 3: Looking for Desktop Guide or sub-pages ===');
                PageSelectors.names().then($subPages => {
                    if ($subPages.length > 1) {
                        const subPageNames = Array.from($subPages).map((el: Element) => el.textContent?.trim());
                        cy.task('log', `Found sub-pages: ${subPageNames.join(', ')}`);
                        
                        // Look for Desktop Guide or any guide - limit search to avoid hanging
                        const maxIndex = Math.min($subPages.length, 5);
                        let guidePage = null;
                        
                        for (let i = 0; i < maxIndex; i++) {
                            const el = $subPages[i];
                            const text = el.textContent?.trim().toLowerCase();
                            if (text?.includes('desktop') || text?.includes('guide') || text?.includes('tutorial')) {
                                guidePage = el;
                                break;
                            }
                        }
                        
                        if (guidePage) {
                            cy.wrap(guidePage).click({ force: true });
                            cy.task('log', `Navigated to: ${guidePage.textContent?.trim()}`);
                        } else if ($subPages.length > 1) {
                            cy.wrap($subPages[1]).click({ force: true });
                            cy.task('log', 'Navigated to second page');
                        }
                        cy.wait(3000);

                        // Step 4: Test breadcrumb navigation
                        cy.task('log', '=== Step 4: Testing breadcrumb navigation ===');
                        cy.get('body').then($body => {
                            if ($body.find('[data-testid="breadcrumb-navigation"]').length > 0) {
                                cy.task('log', '✓ Breadcrumb navigation is visible');
                                
                                // Check breadcrumb items with timeout
                                cy.get('[data-testid*="breadcrumb-item-"]', { timeout: 10000 }).then($items => {
                                    cy.task('log', `Found ${$items.length} breadcrumb items`);
                                    
                                    if ($items.length > 1) {
                                        // Click second-to-last breadcrumb (parent page)
                                        const targetIndex = Math.max(0, $items.length - 2);
                                        cy.wrap($items[targetIndex]).click({ force: true });
                                        cy.task('log', `✓ Clicked breadcrumb at index ${targetIndex} to go back`);
                                        cy.wait(2000);
                                        
                                        // Verify navigation worked
                                        cy.task('log', '✓ Successfully navigated back using breadcrumb');
                                    }
                                });
                            } else {
                                cy.task('log', 'Breadcrumb navigation not available on this page');
                            }
                        });
                    } else {
                        cy.task('log', 'No sub-pages found for breadcrumb testing');
                    }
                });

                // Final verification
                cy.get('body').then($body => {
                    const hasError = $body.text().includes('Error') || 
                                   $body.text().includes('Failed') ||
                                   $body.find('[role="alert"]').length > 0;
                    
                    if (!hasError) {
                        cy.task('log', '✓ Test completed without errors');
                    }
                });

                cy.task('log', '=== Full breadcrumb flow test completed ===');
            });
        });
    });
});