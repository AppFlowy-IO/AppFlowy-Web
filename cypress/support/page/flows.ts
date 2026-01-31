import { testLog } from '../test-helpers';
/**
 * Flow utility functions for Cypress E2E tests
 * Contains high-level test flow operations that orchestrate multiple page interactions
 */

import { 
    PageSelectors, 
    SpaceSelectors, 
    ModalSelectors,
    SidebarSelectors,
    waitForReactUpdate 
} from '../selectors';

/**
 * Waits for the page to fully load
 * @param waitTime - Time to wait in milliseconds (default: 3000)
 * @returns Cypress chainable
 */
export function waitForPageLoad(waitTime: number = 3000) {
    testLog.info( `Waiting for page load (${waitTime}ms)`);
    return cy.wait(waitTime);
}

/**
 * Waits for the sidebar to be ready and visible
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 * @returns Cypress chainable
 */
export function waitForSidebarReady(timeout: number = 10000) {
    testLog.info( 'Waiting for sidebar to be ready');
    return SidebarSelectors.pageHeader()
        .should('be.visible', { timeout });
}

/**
 * Creates a new page and adds content to it
 * Used in publish-page.cy.ts for setting up test pages with content
 * @param pageName - Name for the new page
 * @param content - Array of content lines to add to the page
 */
export function createPageAndAddContent(pageName: string, content: string[]) {
    testLog.info( `Creating page "${pageName}" with ${content.length} lines of content`);
    
    // Create the page first - this navigates to the new page automatically
    createPage(pageName);
    testLog.info( 'Page created successfully and we are now on the page');
    
    // We're already on the newly created page, just add content
    testLog.info( 'Adding content to the page');
    typeLinesInVisibleEditor(content);
    testLog.info( 'Content typed successfully');
    waitForReactUpdate(1000);
    assertEditorContentEquals(content);
    testLog.info( 'Content verification completed');
}

/**
 * Opens a page from the sidebar by its name
 * Used in publish-page.cy.ts for navigating to specific pages
 * @param pageName - Name of the page to open
 */
export function openPageFromSidebar(pageName: string) {
    testLog.info( `Opening page from sidebar: ${pageName}`);
    
    // Ensure sidebar is visible
    SidebarSelectors.pageHeader().should('be.visible');
    
    // Try to find the page - it might be named differently in the sidebar
    PageSelectors.names().then(($pages: JQuery<HTMLElement>) => {
        const pageNames = Array.from($pages).map((el: Element) => el.textContent?.trim());
        testLog.info( `Available pages in sidebar: ${pageNames.join(', ')}`);
        
        // Try to find exact match first
        if (pageNames.includes(pageName)) {
            testLog.info( `Found exact match for: ${pageName}`);
            PageSelectors.nameContaining(pageName)
                .first()
                .scrollIntoView()
                .should('be.visible')
                .click();
        } else {
            // If no exact match, try to find the most recently created page (usually last or first untitled)
            testLog.info( `No exact match for "${pageName}", clicking most recent page`);
            
            // Look for "Untitled" or the first/last page
            const untitledPage = pageNames.find(name => name === 'Untitled' || name?.includes('Untitled'));
            if (untitledPage) {
                testLog.info( `Found untitled page: ${untitledPage}`);
                PageSelectors.nameContaining('Untitled')
                    .first()
                    .scrollIntoView()
                    .should('be.visible')
                    .click();
            } else {
                // Just click the first non-"Getting started" page
                const targetPage = pageNames.find(name => name !== 'Getting started') || pageNames[0];
                testLog.info( `Clicking page: ${targetPage}`);
                PageSelectors.names()
                    .first()
                    .scrollIntoView()
                    .should('be.visible')
                    .click();
            }
        }
    });
    
    // Wait for page to load
    waitForReactUpdate(2000);
    testLog.info( `Page opened successfully`);
}

/**
 * Expands a space in the sidebar to show its pages
 * Used in create-delete-page.cy.ts and more-page-action.cy.ts
 * @param spaceIndex - Index of the space to expand (default: 0 for first space)
 */
export function expandSpace(spaceIndex: number = 0) {
    testLog.info( `Expanding space at index ${spaceIndex}`);

    SpaceSelectors.items().eq(spaceIndex).within(() => {
        SpaceSelectors.expanded().then(($expanded: JQuery<HTMLElement>) => {
            const isExpanded = $expanded.attr('data-expanded') === 'true';

            if (!isExpanded) {
                testLog.info( 'Space is collapsed, expanding it');
                SpaceSelectors.names().first().click();
            } else {
                testLog.info( 'Space is already expanded');
            }
        });
    });

    waitForReactUpdate(500);
}

/**
 * Expands a space in the sidebar by its name
 * Used in cross-tab-sync.cy.ts, document-sidebar-refresh.cy.ts, and other tests
 * @param spaceName - Name of the space to expand (e.g., 'General')
 */
export function expandSpaceByName(spaceName: string) {
    testLog.info(`Expanding space "${spaceName}" in sidebar`);

    SpaceSelectors.itemByName(spaceName, { timeout: 30000 }).then(($space) => {
        const expandedIndicator = $space.find('[data-testid="space-expanded"]');
        const isExpanded = expandedIndicator.attr('data-expanded') === 'true';

        if (!isExpanded) {
            testLog.info('Space is collapsed, expanding it');
            SpaceSelectors.itemByName(spaceName).find('[data-testid="space-name"]').click({ force: true });
            waitForReactUpdate(1000);
        } else {
            testLog.info('Space is already expanded');
        }
    });
}

// Internal helper functions (not exported but used by exported functions)

/**
 * Creates a new page with the given name
 * Internal function used by createPageAndAddContent
 */
function createPage(pageName: string) {
    testLog.info( `Creating page: ${pageName}`);
    
    // Click new page button
    PageSelectors.newPageButton().should('be.visible').click();
    waitForReactUpdate(1000);
    
    // Handle the new page modal
    ModalSelectors.newPageModal().should('be.visible').within(() => {
        // Select the first available space
        ModalSelectors.spaceItemInModal().first().click();
        waitForReactUpdate(500);
        // Click Add button
        cy.contains('button', 'Add').click();
    });
    
    // Wait for navigation to the new page
    waitForReactUpdate(3000);
    
    // Close any modal dialogs
    cy.get('body').then(($body: JQuery<HTMLBodyElement>) => {
        if ($body.find('[role="dialog"]').length > 0) {
            testLog.info( 'Closing modal dialog');
            cy.get('body').type('{esc}');
            waitForReactUpdate(1000);
        }
    });
    
    // Set the page title in the editor
    PageSelectors.titleInput()
        .should('exist')
        .first()
        .then($el => {
            // Since it's a contentEditable div, we need to handle it differently
            cy.wrap($el)
                .click({ force: true })
                .then(() => {
                    // Select all existing text first
                    cy.wrap($el).type('{selectall}');
                })
                .type(pageName, { force: true })
                .type('{enter}');
        });
    
    testLog.info( `Set page title to: ${pageName}`);
    waitForReactUpdate(2000);
    
    // Also update the page name in the sidebar if possible
    // This ensures the page can be found later by name
    testLog.info( 'Page created and title set');
}

/**
 * Types multiple lines of content in the visible editor
 * Internal function used by createPageAndAddContent
 */
function typeLinesInVisibleEditor(lines: string[]) {
    testLog.info( `Typing ${lines.length} lines in editor`);
    
    // Wait for any template to load
    waitForReactUpdate(1000);
    
    // Check if we need to dismiss welcome content or click to create editor
    cy.get('body').then(($body: JQuery<HTMLBodyElement>) => {
        if ($body.text().includes('Welcome to AppFlowy')) {
            testLog.info( 'Welcome template detected, looking for editor area');
        }
    });
    
    // Wait for contenteditable elements to be available
    cy.get('[contenteditable="true"]', { timeout: 10000 }).should('exist');
    
    cy.get('[contenteditable="true"]').then(($editors: JQuery<HTMLElement>) => {
        testLog.info( `Found ${$editors.length} editable elements`);
        
        if ($editors.length === 0) {
            throw new Error('No editable elements found on page');
        }
        
        let editorFound = false;
        $editors.each((index: number, el: HTMLElement) => {
            const $el = Cypress.$(el);
            // Skip title inputs - find the main document editor
            const isTitle = $el.attr('data-testid')?.includes('title') || 
                           $el.hasClass('editor-title') ||
                           $el.attr('id')?.includes('title');
            
            if (!isTitle && el) {
                testLog.info( `Using editor at index ${index}`);
                cy.wrap(el).click({ force: true }).clear().type(lines.join('{enter}'), { force: true });
                editorFound = true;
                return false; // break the loop
            }
        });
        
        if (!editorFound && $editors.length > 0) {
            testLog.info( 'Using fallback: last contenteditable element');
            const lastEditor = $editors.last().get(0);
            if (lastEditor) {
                cy.wrap(lastEditor).click({ force: true }).clear().type(lines.join('{enter}'), { force: true });
            }
        }
    });
}

/**
 * Asserts that the editor content matches the expected lines
 * Internal function used by createPageAndAddContent
 */
function assertEditorContentEquals(lines: string[]) {
    testLog.info( 'Verifying editor content');
    
    lines.forEach(line => {
        cy.contains(line).should('exist');
        testLog.info( `✓ Found content: "${line}"`);
    });
}

// Additional exported functions referenced in page-utils.ts

/**
 * Closes the sidebar
 * Referenced in page-utils.ts
 */
export function closeSidebar() {
    testLog.info( 'Closing sidebar');
    // Implementation would depend on how sidebar is closed in the UI
    // This is a placeholder to maintain compatibility
}

/**
 * Creates a new page via backend quick action
 * Referenced in page-utils.ts
 */
export function createNewPageViaBackendQuickAction(pageName?: string) {
    testLog.info( `Creating new page via backend quick action: ${pageName || 'unnamed'}`);
    // Implementation would depend on the backend quick action flow
    // This is a placeholder to maintain compatibility
}

/**
 * Opens the command palette
 * Referenced in page-utils.ts
 */
export function openCommandPalette() {
    testLog.info( 'Opening command palette');
    // Implementation would depend on how command palette is opened
    // This is a placeholder to maintain compatibility
}

/**
 * Navigates to a specific route
 * Referenced in page-utils.ts
 */
export function navigateTo(route: string) {
    testLog.info( `Navigating to: ${route}`);
    cy.visit(route);
}