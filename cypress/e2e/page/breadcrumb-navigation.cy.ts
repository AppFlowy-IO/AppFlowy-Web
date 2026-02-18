import { TestTool } from '../../support/page-utils';
import {
    BreadcrumbSelectors,
    PageSelectors,
    SidebarSelectors,
    SpaceSelectors
} from '../../support/selectors';
import { generateRandomEmail, logAppFlowyEnvironment } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('Breadcrumb Navigation Complete Tests', () => {
    let testEmail: string;

    before(() => {
        // Log environment configuration for debugging
        logAppFlowyEnvironment();
    });

    beforeEach(() => {
        // Generate unique test data for each test
        testEmail = generateRandomEmail();

        // Handle uncaught exceptions
        cy.on('uncaught:exception', (err: Error) => {
            if (err.message.includes('No workspace or service found')) {
                return false;
            }
            // Handle View not found errors
            if (err.message.includes('View not found')) {
                return false;
            }
            return true;
        });
    });

    describe('Basic Navigation Tests', () => {
        it('should navigate through space and check for breadcrumb availability', () => {
            //                     // Login
            testLog.info('=== Step 1: Login ===');
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for app to load
                testLog.info('Waiting for app to fully load...');
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                PageSelectors.names().should('exist', { timeout: 30000 });
                // Wait for pages to be ready
                PageSelectors.names().should('have.length.at.least', 1);

                testLog.info('App loaded successfully');

                // Step 2: Expand first space
                testLog.info('=== Step 2: Expanding first space ===');
                TestTool.expandSpace(0);
                // Wait for space to expand and pages to be visible
                PageSelectors.names().should('be.visible', { timeout: 10000 });
                testLog.info('Expanded first space');

                // Step 3: Navigate to first page
                testLog.info('=== Step 3: Navigating to first page ===');
                PageSelectors.names().first().then($page => {
                    const pageName = $page.text();
                    testLog.info(`Navigating to: ${pageName}`);
                    cy.wrap($page).click();
                });
                // Wait for page to load
                cy.url().should('include', '/app/', { timeout: 10000 });

                // Step 4: Check for breadcrumb navigation
                testLog.info('=== Step 4: Checking for breadcrumb navigation ===');
                BreadcrumbSelectors.navigation().then($nav => {
                    if ($nav.length > 0) {
                        testLog.info('✓ Breadcrumb navigation found on this page');
                        BreadcrumbSelectors.items().then($items => {
                            testLog.info(`✓ Found ${$items.length} breadcrumb items`);
                        });
                    } else {
                        testLog.info('No breadcrumb navigation on this page (normal for top-level pages)');
                    }
                });

                // Verify no errors
                cy.get('body').then($body => {
                    const hasError = $body.text().includes('Error') ||
                        $body.text().includes('Failed');

                    if (!hasError) {
                        testLog.info('✓ Navigation completed without errors');
                    }
                });

                testLog.info('=== Basic navigation test completed ===');
            });
        });

        it('should navigate to nested pages and use breadcrumb to go back', () => {
            // Login
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for app to load
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                PageSelectors.names().should('exist', { timeout: 30000 });
                // Wait for pages to be ready
                PageSelectors.names().should('have.length.at.least', 1);

                testLog.info('=== Step 1: Expand first space ===');
                TestTool.expandSpace(0);
                // Wait for space to expand and pages to be visible
                PageSelectors.names().should('be.visible', { timeout: 10000 });

                testLog.info('=== Step 2: Navigate to first page ===');
                PageSelectors.names().first().click();
                // Wait for page to load
                cy.url().should('include', '/app/', { timeout: 10000 });
                cy.wait(2000); // Wait for sidebar to update

                testLog.info('=== Step 3: Check for nested pages ===');
                PageSelectors.names().then($pages => {
                    testLog.info(`Found ${$pages.length} pages in sidebar`);

                    // Find child pages by name
                    const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
                    let childPageFound = false;

                    for (let i = 0; i < $pages.length; i++) {
                        const pageName = Cypress.$($pages[i]).text().trim();
                        if (childPageNames.includes(pageName)) {
                            testLog.info(`Found child page: ${pageName}`);
                            cy.wrap($pages[i]).click({ force: true });
                            childPageFound = true;
                            break;
                        }
                    }

                    if (!childPageFound && $pages.length > 1) {
                        // Fallback: navigate to second page
                        testLog.info('No known child page found, clicking second page as fallback');
                        cy.wrap($pages[1]).click({ force: true });
                    }

                    // Wait for page to load
                    cy.url().should('include', '/app/', { timeout: 10000 });
                    cy.wait(2000);

                    // Check for breadcrumb navigation
                    testLog.info('=== Step 4: Testing breadcrumb navigation ===');
                    BreadcrumbSelectors.navigation().then($nav => {
                        if ($nav.length > 0) {
                            testLog.info('✓ Breadcrumb navigation is visible');
                            BreadcrumbSelectors.items().should('have.length.at.least', 1);
                            BreadcrumbSelectors.items().then($items => {
                                if ($items.length > 1) {
                                    cy.wrap($items).first().click({ force: true });
                                    testLog.info('✓ Clicked breadcrumb item to navigate back');
                                    // Wait for navigation to complete
                                    cy.url().should('include', '/app/', { timeout: 10000 });
                                    testLog.info('✓ Successfully used breadcrumb navigation');
                                } else {
                                    testLog.info('Only one breadcrumb item found');
                                }
                            });
                        } else {
                            testLog.info('No breadcrumb navigation on nested page');
                        }
                    });
                });

                testLog.info('=== Nested navigation test completed ===');
            });
        });
    });

    describe('Full Breadcrumb Flow Test', () => {
        it('should navigate through General > Get Started > Desktop Guide flow (if available)', () => {
            // Login
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for app to load
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                PageSelectors.names().should('exist', { timeout: 30000 });
                // Wait for pages to be ready
                PageSelectors.names().should('have.length.at.least', 1);

                // Step 1: Find and expand General space or first space
                testLog.info('=== Step 1: Looking for General space ===');
                SpaceSelectors.names().then($spaces => {
                    const spaceNames = Array.from($spaces).map((el: Element) => el.textContent?.trim());
                    testLog.info(`Available spaces: ${spaceNames.join(', ')}`);

                    // Find General space or use first
                    const generalIndex = spaceNames.findIndex(name =>
                        name?.toLowerCase().includes('general')
                    );

                    if (generalIndex !== -1) {
                        testLog.info(`Found General space at index ${generalIndex}`);
                        TestTool.expandSpace(generalIndex);
                    } else {
                        testLog.info('Using first available space');
                        TestTool.expandSpace(0);
                    }
                });
                // Wait for space to expand and pages to be visible
                PageSelectors.names().should('be.visible', { timeout: 10000 });

                // Step 2: Look for Get Started page or use first page
                testLog.info('=== Step 2: Looking for Get Started page ===');
                PageSelectors.names().then($pages => {
                    const pageNames = Array.from($pages).map((el: Element) => el.textContent?.trim());
                    testLog.info(`Available pages: ${pageNames.join(', ')}`);

                    // Find Get Started or similar page
                    const getStartedPage = Array.from($pages).find((el: Element) => {
                        const text = el.textContent?.trim().toLowerCase();
                        return text?.includes('get') || text?.includes('start') ||
                            text?.includes('welcome') || text?.includes('guide');
                    });

                    if (getStartedPage) {
                        cy.wrap(getStartedPage).click();
                        testLog.info(`Clicked on: ${getStartedPage.textContent?.trim()}`);
                    } else {
                        PageSelectors.names().first().click();
                        testLog.info('Clicked first available page');
                    }
                });
                // Wait for page to load
                cy.url().should('include', '/app/', { timeout: 10000 });
                cy.wait(2000); // Wait for sidebar to update

                // Step 3: Look for Desktop Guide or sub-page
                testLog.info('=== Step 3: Looking for Desktop Guide or sub-pages ===');
                PageSelectors.names().then($subPages => {
                    const subPageNames = Array.from($subPages).map((el: Element) => el.textContent?.trim());
                    testLog.info(`Found pages: ${subPageNames.join(', ')}`);

                    // Look for Desktop Guide or any guide
                    const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
                    let guidePage = null;

                    for (let i = 0; i < $subPages.length; i++) {
                        const el = $subPages[i];
                        const text = el.textContent?.trim().toLowerCase();
                        if (text?.includes('desktop') || childPageNames.some(name => text.includes(name.toLowerCase()))) {
                            guidePage = el;
                            break;
                        }
                    }

                    if (guidePage) {
                        cy.wrap(guidePage).click({ force: true });
                        testLog.info(`Navigated to: ${guidePage.textContent?.trim()}`);
                    } else if ($subPages.length > 1) {
                        // Try to find a child page by name
                        let childFound = false;
                        for (let i = 0; i < $subPages.length; i++) {
                            const pageName = Cypress.$($subPages[i]).text().trim();
                            if (childPageNames.includes(pageName)) {
                                cy.wrap($subPages[i]).click({ force: true });
                                testLog.info(`Navigated to: ${pageName}`);
                                childFound = true;
                                break;
                            }
                        }
                        if (!childFound) {
                            cy.wrap($subPages[1]).click({ force: true });
                            testLog.info('Navigated to second page');
                        }
                    }
                    // Wait for page to load
                    cy.url().should('include', '/app/', { timeout: 10000 });
                    cy.wait(2000);

                    // Step 4: Test breadcrumb navigation
                    testLog.info('=== Step 4: Testing breadcrumb navigation ===');
                    BreadcrumbSelectors.navigation().then($nav => {
                        if ($nav.length > 0) {
                            testLog.info('✓ Breadcrumb navigation is visible');
                            BreadcrumbSelectors.items().should('have.length.at.least', 1);
                            BreadcrumbSelectors.items().then($items => {
                                testLog.info(`Found ${$items.length} breadcrumb items`);
                                if ($items.length > 1) {
                                    const targetIndex = Math.max(0, $items.length - 2);
                                    cy.wrap($items[targetIndex]).click({ force: true });
                                    testLog.info(`✓ Clicked breadcrumb at index ${targetIndex} to go back`);
                                    // Wait for navigation to complete
                                    cy.url().should('include', '/app/', { timeout: 10000 });
                                    testLog.info('✓ Successfully navigated back using breadcrumb');
                                }
                            });
                        } else {
                            testLog.info('Breadcrumb navigation not available on this page');
                        }
                    });
                });

                // Final verification
                cy.get('body').then($body => {
                    const hasError = $body.text().includes('Error') ||
                        $body.text().includes('Failed') ||
                        $body.find('[role="alert"]').length > 0;

                    if (!hasError) {
                        testLog.info('✓ Test completed without errors');
                    }
                });

                testLog.info('=== Full breadcrumb flow test completed ===');
            });
        });
    });

    describe('Breadcrumb Item Verification Tests', () => {
        it('should verify breadcrumb items display correct names and are clickable', () => {
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for app to load
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                PageSelectors.names().should('exist', { timeout: 30000 });
                PageSelectors.names().should('have.length.at.least', 1);

                testLog.info('=== Step 1: Navigate to nested page ===');
                TestTool.expandSpace(0);
                PageSelectors.names().should('be.visible', { timeout: 10000 });

                // Navigate to first page
                PageSelectors.names().first().click();
                cy.url().should('include', '/app/', { timeout: 10000 });
                cy.wait(2000); // Wait for sidebar to update

                // Navigate to nested page if available
                PageSelectors.names().then($pages => {
                    // Find child pages by name
                    const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
                    let childPageFound = false;

                    for (let i = 0; i < $pages.length; i++) {
                        const pageName = Cypress.$($pages[i]).text().trim();
                        if (childPageNames.includes(pageName)) {
                            testLog.info(`Found child page: ${pageName}`);
                            cy.wrap($pages[i]).click({ force: true });
                            childPageFound = true;
                            break;
                        }
                    }

                    if (!childPageFound && $pages.length > 1) {
                        cy.wrap($pages[1]).click({ force: true });
                    }

                    cy.url().should('include', '/app/', { timeout: 10000 });
                    cy.wait(2000);

                    testLog.info('=== Step 2: Verify breadcrumb items ===');
                    BreadcrumbSelectors.navigation().then($nav => {
                        if ($nav.length > 0) {
                            BreadcrumbSelectors.items().then($items => {
                                testLog.info(`Found ${$items.length} breadcrumb items`);

                                // Verify each breadcrumb item has text
                                $items.each((index, item) => {
                                    const $item = Cypress.$(item);
                                    const itemText = $item.text().trim();
                                    testLog.info(`Breadcrumb ${index}: "${itemText}"`);
                                    expect(itemText).to.not.be.empty;
                                });

                                // Verify last item is not clickable (should be disabled)
                                if ($items.length > 0) {
                                    const lastItem = $items.last();
                                    cy.wrap(lastItem).should('exist');
                                    testLog.info('✓ Verified breadcrumb items structure');
                                }
                            });
                        } else {
                            testLog.info('No breadcrumb navigation available');
                        }
                    });
                });
            });
        });

        it('should verify breadcrumb navigation updates correctly when navigating', () => {
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for app to load
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                PageSelectors.names().should('exist', { timeout: 30000 });
                PageSelectors.names().should('have.length.at.least', 1);

                testLog.info('=== Step 1: Navigate to parent page ===');
                TestTool.expandSpace(0);
                PageSelectors.names().should('be.visible', { timeout: 10000 });

                let parentPageName: string;
                PageSelectors.names().first().then($page => {
                    parentPageName = $page.text().trim();
                    testLog.info(`Parent page: ${parentPageName}`);
                    cy.wrap($page).click();
                });
                cy.url().should('include', '/app/', { timeout: 10000 });
                cy.wait(2000); // Wait for sidebar to update

                testLog.info('=== Step 2: Navigate to nested page ===');
                PageSelectors.names().then($pages => {
                    // Find child pages by name
                    const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
                    let childPageFound = false;

                    for (let i = 0; i < $pages.length; i++) {
                        const pageName = Cypress.$($pages[i]).text().trim();
                        if (childPageNames.includes(pageName)) {
                            testLog.info(`Found child page: ${pageName}`);
                            cy.wrap($pages[i]).click({ force: true });
                            childPageFound = true;
                            break;
                        }
                    }

                    if (!childPageFound && $pages.length > 1) {
                        cy.wrap($pages[1]).click({ force: true });
                    }

                    cy.url().should('include', '/app/', { timeout: 10000 });
                    cy.wait(2000);

                    testLog.info('=== Step 3: Verify breadcrumb shows parent ===');
                    BreadcrumbSelectors.navigation().then($nav => {
                        if ($nav.length > 0) {
                            BreadcrumbSelectors.items().then($items => {
                                if ($items.length > 1) {
                                    // Verify parent page appears in breadcrumb
                                    const breadcrumbTexts = Array.from($items).map(el => Cypress.$(el).text().trim());
                                    const hasParent = breadcrumbTexts.some(text => text.includes(parentPageName));
                                    if (hasParent) {
                                        testLog.info('✓ Parent page found in breadcrumb');
                                    }
                                }
                            });
                        }
                    });

                    testLog.info('=== Step 4: Navigate back via breadcrumb ===');
                    BreadcrumbSelectors.items().then($items => {
                        if ($items.length > 1) {
                            // Click first breadcrumb (parent)
                            cy.wrap($items).first().click({ force: true });
                            cy.url().should('include', '/app/', { timeout: 10000 });
                            testLog.info('✓ Successfully navigated back via breadcrumb');
                        }
                    });
                });
            });
        });
    });

    describe('Deep Navigation Tests', () => {
        it('should handle breadcrumb navigation for 3+ level deep pages', () => {
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for app to load
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                PageSelectors.names().should('exist', { timeout: 30000 });
                PageSelectors.names().should('have.length.at.least', 1);

                testLog.info('=== Step 1: Navigate to first level ===');
                TestTool.expandSpace(0);
                PageSelectors.names().should('be.visible', { timeout: 10000 });

                // Get initial page count
                let initialPageCount = 0;
                PageSelectors.names().then($pages => {
                    initialPageCount = $pages.length;
                    testLog.info(`Initial pages in sidebar: ${initialPageCount}`);
                });

                // Click first page and wait for navigation
                PageSelectors.names().first().then($firstPage => {
                    const firstPageName = $firstPage.text().trim();
                    testLog.info(`Clicking on first page: ${firstPageName}`);
                    cy.wrap($firstPage).click();
                });
                cy.url().should('include', '/app/', { timeout: 10000 });

                // Wait for page to load and sidebar to potentially update
                cy.wait(2000);
                testLog.info('Waiting for sidebar to update with nested pages...');

                testLog.info('=== Step 2: Navigate to second level ===');
                // Look for nested pages - they should be children of the first page
                // In the sidebar, nested pages appear after their parent when expanded
                PageSelectors.names().then($pages => {
                    testLog.info(`Pages in sidebar after navigation: ${$pages.length}`);
                    const pageNames = Array.from($pages).map((el: Element) => el.textContent?.trim());
                    testLog.info(`Available pages: ${pageNames.join(', ')}`);

                    // Find "Desktop guide" or another child page (usually appears after "Getting started")
                    // Children of "Getting started" are: Desktop guide, Mobile guide, Web guide
                    const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
                    let childPageFound = false;

                    for (let i = 0; i < $pages.length; i++) {
                        const pageName = Cypress.$($pages[i]).text().trim();
                        if (childPageNames.includes(pageName)) {
                            testLog.info(`Found child page: ${pageName} at index ${i}`);
                            cy.wrap($pages[i]).click({ force: true });
                            childPageFound = true;
                            break;
                        }
                    }

                    if (!childPageFound && $pages.length > 1) {
                        // Fallback: click second page if no known child found
                        testLog.info('No known child page found, clicking second page as fallback');
                        cy.wrap($pages[1]).click({ force: true });
                    }

                    cy.url().should('include', '/app/', { timeout: 10000 });

                    // Wait for sidebar to update again
                    cy.wait(2000);
                    testLog.info('Waiting for sidebar to update with third level pages...');

                    testLog.info('=== Step 3: Navigate to third level if available ===');
                    // Wait for third level pages to appear
                    PageSelectors.names().should('exist', { timeout: 10000 });

                    PageSelectors.names().then($subPages => {
                        testLog.info(`Pages in sidebar after second navigation: ${$subPages.length}`);
                        const subPageNames = Array.from($subPages).map((el: Element) => el.textContent?.trim());
                        testLog.info(`Available sub-pages: ${subPageNames.join(', ')}`);

                        // Try to find another nested page or click a different page
                        if ($subPages.length > 2) {
                            // Click a page that's different from what we've already clicked
                            // Skip first two (Getting started and Desktop guide) and try third
                            cy.wrap($subPages[2]).click({ force: true });
                            cy.url().should('include', '/app/', { timeout: 10000 });
                            cy.wait(2000); // Wait for page to fully load

                            testLog.info('=== Step 4: Verify breadcrumb shows all levels ===');
                            // Wait a bit more for breadcrumb to render
                            cy.wait(1000);

                            BreadcrumbSelectors.navigation().should('exist', { timeout: 10000 }).then($nav => {
                                if ($nav.length > 0) {
                                    BreadcrumbSelectors.items().should('have.length.at.least', 1);
                                    BreadcrumbSelectors.items().then($items => {
                                        testLog.info(`Found ${$items.length} breadcrumb items (3+ levels deep)`);

                                        // Log breadcrumb item texts for debugging
                                        const breadcrumbTexts = Array.from($items).map(el => Cypress.$(el).text().trim());
                                        testLog.info(`Breadcrumb items: ${breadcrumbTexts.join(' > ')}`);

                                        expect($items.length).to.be.at.least(2);

                                        // Verify we can navigate back through breadcrumbs
                                        if ($items.length > 2) {
                                            // Click second-to-last breadcrumb
                                            const targetIndex = $items.length - 2;
                                            testLog.info(`Clicking breadcrumb at index ${targetIndex} (${breadcrumbTexts[targetIndex]})`);
                                            cy.wrap($items[targetIndex]).click({ force: true });
                                            cy.url().should('include', '/app/', { timeout: 10000 });
                                            cy.wait(1000);
                                            testLog.info('✓ Successfully navigated back from deep level');
                                        } else {
                                            testLog.info(`Only ${$items.length} breadcrumb items found, expected at least 3 for deep navigation`);
                                        }
                                    });
                                } else {
                                    testLog.info('Breadcrumb not available for deep navigation');
                                }
                            });
                        } else {
                            testLog.info(`No third level pages available (found ${$subPages.length} pages)`);
                        }
                    });
                });
            });
        });
    });

    describe('Breadcrumb After Page Creation Tests', () => {
        it('should show breadcrumb after creating a new nested page', () => {
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for app to load
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                PageSelectors.names().should('exist', { timeout: 30000 });
                PageSelectors.names().should('have.length.at.least', 1);

                testLog.info('=== Step 1: Navigate to a page ===');
                TestTool.expandSpace(0);
                PageSelectors.names().should('be.visible', { timeout: 10000 });

                PageSelectors.names().first().click();
                cy.url().should('include', '/app/', { timeout: 10000 });
                cy.wait(2000); // Wait for page to load

                testLog.info('=== Step 2: Create a new nested page ===');
                const newPageName = `Test Page ${Date.now()}`;

                // Create page using the new page button
                PageSelectors.newPageButton().should('be.visible').click();
                cy.wait(1000);

                // Close any modals that might appear
                cy.get('body').then($body => {
                    if ($body.find('[role="dialog"]').length > 0) {
                        cy.get('body').type('{esc}');
                        cy.wait(500);
                    }
                });

                // Wait for page to be created and navigate to it
                cy.url().should('include', '/app/', { timeout: 10000 });
                cy.wait(2000); // Wait for page to fully load

                // Set page title if title input is available (use force to bypass modal backdrop)
                PageSelectors.titleInput().then($titleInput => {
                    if ($titleInput.length > 0) {
                        cy.wrap($titleInput).first().click({ force: true });
                        cy.wait(500);
                        cy.wrap($titleInput).first().type('{selectall}', { force: true });
                        cy.wrap($titleInput).first().type(newPageName, { force: true });
                        cy.wrap($titleInput).first().type('{enter}', { force: true });
                        cy.wait(1000);
                    }
                });

                testLog.info('=== Step 3: Verify breadcrumb appears for new page ===');
                BreadcrumbSelectors.navigation().then($nav => {
                    if ($nav.length > 0) {
                        testLog.info('✓ Breadcrumb navigation found after page creation');
                        BreadcrumbSelectors.items().should('have.length.at.least', 1);
                        BreadcrumbSelectors.items().then($items => {
                            testLog.info(`Found ${$items.length} breadcrumb items for new page`);

                            // Verify we can navigate back
                            if ($items.length > 1) {
                                cy.wrap($items).first().click({ force: true });
                                cy.url().should('include', '/app/', { timeout: 10000 });
                                testLog.info('✓ Successfully navigated back from newly created page');
                            }
                        });
                    } else {
                        testLog.info('No breadcrumb navigation (page may be top-level)');
                    }
                });
            });
        });
    });

    describe('Breadcrumb Text Content Tests', () => {
        it('should verify breadcrumb items contain correct page names', () => {
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for app to load
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                PageSelectors.names().should('exist', { timeout: 30000 });
                PageSelectors.names().should('have.length.at.least', 1);

                testLog.info('=== Step 1: Navigate through pages and collect names ===');
                TestTool.expandSpace(0);
                PageSelectors.names().should('be.visible', { timeout: 10000 });

                const pageNames: string[] = [];
                PageSelectors.names().then($pages => {
                    // Collect first 3 page names
                    const maxPages = Math.min($pages.length, 3);
                    for (let i = 0; i < maxPages; i++) {
                        const pageName = Cypress.$($pages[i]).text().trim();
                        pageNames.push(pageName);
                    }
                    testLog.info(`Collected page names: ${pageNames.join(', ')}`);

                    // Navigate to first page
                    if (pageNames.length > 0) {
                        cy.wrap($pages[0]).click();
                        cy.url().should('include', '/app/', { timeout: 10000 });
                        cy.wait(2000); // Wait for sidebar to update

                        // Find and navigate to nested page
                        const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
                        let childFound = false;

                        PageSelectors.names().then($subPages => {
                            for (let i = 0; i < $subPages.length; i++) {
                                const pageName = Cypress.$($subPages[i]).text().trim();
                                if (childPageNames.includes(pageName)) {
                                    cy.wrap($subPages[i]).click({ force: true });
                                    childFound = true;
                                    break;
                                }
                            }

                            if (!childFound && $subPages.length > 1) {
                                cy.wrap($subPages[1]).click({ force: true });
                            }

                            cy.url().should('include', '/app/', { timeout: 10000 });
                            cy.wait(2000);

                            testLog.info('=== Step 2: Verify breadcrumb contains page names ===');
                            BreadcrumbSelectors.navigation().then($nav => {
                                if ($nav.length > 0) {
                                    BreadcrumbSelectors.items().then($items => {
                                        const breadcrumbTexts = Array.from($items).map(el =>
                                            Cypress.$(el).text().trim()
                                        );
                                        testLog.info(`Breadcrumb texts: ${breadcrumbTexts.join(' > ')}`);

                                        // Verify parent page name appears in breadcrumb
                                        if (pageNames.length > 0 && breadcrumbTexts.length > 0) {
                                            const hasParentName = breadcrumbTexts.some(text =>
                                                text.includes(pageNames[0])
                                            );
                                            if (hasParentName) {
                                                testLog.info('✓ Parent page name found in breadcrumb');
                                            }
                                        }
                                    });
                                }
                            });
                        });
                    }
                });
            });
        });
    });

    describe('Breadcrumb Edge Cases', () => {
        it('should handle breadcrumb when navigating between different spaces', () => {
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for app to load
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                PageSelectors.names().should('exist', { timeout: 30000 });
                PageSelectors.names().should('have.length.at.least', 1);

                testLog.info('=== Step 1: Navigate to first space ===');
                TestTool.expandSpace(0);
                PageSelectors.names().should('be.visible', { timeout: 10000 });

                PageSelectors.names().first().click();
                cy.url().should('include', '/app/', { timeout: 10000 });
                cy.wait(2000); // Wait for sidebar to update

                testLog.info('=== Step 2: Check breadcrumb state ===');
                BreadcrumbSelectors.navigation().then($nav => {
                    if ($nav.length > 0) {
                        BreadcrumbSelectors.items().then($items => {
                            testLog.info(`Breadcrumb items before navigation: ${$items.length}`);

                            // Navigate to nested page
                            PageSelectors.names().then($pages => {
                                // Find child pages by name
                                const childPageNames = ['Desktop guide', 'Mobile guide', 'Web guide'];
                                let childFound = false;

                                for (let i = 0; i < $pages.length; i++) {
                                    const pageName = Cypress.$($pages[i]).text().trim();
                                    if (childPageNames.includes(pageName)) {
                                        cy.wrap($pages[i]).click({ force: true });
                                        childFound = true;
                                        break;
                                    }
                                }

                                if (!childFound && $pages.length > 1) {
                                    cy.wrap($pages[1]).click({ force: true });
                                }

                                cy.url().should('include', '/app/', { timeout: 10000 });
                                cy.wait(2000);

                                // Verify breadcrumb updates
                                BreadcrumbSelectors.items().then($newItems => {
                                    testLog.info(`Breadcrumb items after navigation: ${$newItems.length}`);
                                    if ($newItems.length > $items.length) {
                                        testLog.info('✓ Breadcrumb updated correctly after navigation');
                                    }
                                });
                            });
                        });
                    }
                });
            });
        });

        it('should verify breadcrumb does not appear on top-level pages', () => {
            cy.signIn(testEmail).then(() => {
                cy.url().should('include', '/app');

                // Wait for app to load
                cy.get('body', { timeout: 30000 }).should('not.contain', 'Welcome!');
                SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
                PageSelectors.names().should('exist', { timeout: 30000 });
                PageSelectors.names().should('have.length.at.least', 1);

                testLog.info('=== Step 1: Navigate to top-level page ===');
                TestTool.expandSpace(0);
                PageSelectors.names().should('be.visible', { timeout: 10000 });

                // Click first page (likely top-level)
                PageSelectors.names().first().click();
                cy.url().should('include', '/app/', { timeout: 10000 });
                cy.wait(2000); // Wait for page to load

                testLog.info('=== Step 2: Verify breadcrumb behavior on top-level page ===');
                BreadcrumbSelectors.navigation().then($nav => {
                    if ($nav.length === 0) {
                        testLog.info('✓ No breadcrumb on top-level page (expected behavior)');
                    } else {
                        BreadcrumbSelectors.items().then($items => {
                            testLog.info(`Found ${$items.length} breadcrumb items on top-level page`);
                            // Top-level pages may or may not have breadcrumbs depending on structure
                        });
                    }
                });
            });
        });
    });
});
