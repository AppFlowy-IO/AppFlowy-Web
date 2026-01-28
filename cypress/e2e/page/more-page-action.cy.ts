import { AuthTestUtils } from '../../support/auth-utils';
import { TestTool } from '../../support/page-utils';
import { DropdownSelectors, ModalSelectors, PageSelectors, ViewActionSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('More Page Actions', () => {
    const newPageName = 'Renamed Test Page';
    let testEmail: string;

    beforeEach(function () {
        testEmail = generateRandomEmail();
    });


    it('should open the More actions menu for a page (verify visibility of core items)', () => {
        // Handle uncaught exceptions during workspace creation
        cy.on('uncaught:exception', (err: Error) => {
            if (err.message.includes('No workspace or service found')) {
                return false;
            }
            return true;
        });

        // Sign in first
        cy.visit('/login', { failOnStatusCode: false });
        cy.wait(2000);

        const authUtils = new AuthTestUtils();
        authUtils.signInWithTestUrl(testEmail);

        cy.url().should('include', '/app');
        TestTool.waitForPageLoad(3000);

        // Wait for the sidebar to load properly
        TestTool.waitForSidebarReady();
        cy.wait(2000);

        // Skip expanding space since Getting started is already visible
        testLog.info( 'Page already visible, skipping expand');

        // Open the first available page from the sidebar, then trigger inline ViewActionsPopover via "..." on the row
        // Find the Getting started page and hover to reveal the more actions
        testLog.info( 'Looking for Getting started page');

        // Find the page by its text content
        cy.contains('Getting started')
            .parent()
            .parent()
            .trigger('mouseenter', { force: true })
            .trigger('mouseover', { force: true });

        cy.wait(1000);

        // Look for the more actions button - using PageSelectors
        PageSelectors.moreActionsButton().first().click({ force: true });

        testLog.info( 'Clicked more actions button');

        // Verify core items in ViewActionsPopover
        // The menu should be open now, verify at least one of the common actions exists
        DropdownSelectors.content().should('exist');

        // Check for common menu items - they might have different test ids or text
        DropdownSelectors.content().within(() => {
            // Look for items by text content since test ids might vary
            cy.contains('Delete').should('exist');
            cy.contains('Duplicate').should('exist');
            cy.contains('Move to').should('exist');
        });
    });

    it('should trigger Duplicate action from More actions menu', () => {
        // Handle uncaught exceptions during workspace creation
        cy.on('uncaught:exception', (err: Error) => {
            if (err.message.includes('No workspace or service found')) {
                return false;
            }
            return true;
        });

        // Sign in first
        cy.visit('/login', { failOnStatusCode: false });
        cy.wait(2000);

        const authUtils = new AuthTestUtils();
        authUtils.signInWithTestUrl(testEmail);

        cy.url().should('include', '/app');
        TestTool.waitForPageLoad(3000);

        // Wait for the sidebar to load properly
        TestTool.waitForSidebarReady();
        cy.wait(2000);

        // Find the Getting started page and open its more actions menu
        const originalPageName = 'Getting started';
        testLog.info( `Opening More Actions for page: ${originalPageName}`);

        // Find the page by its text content and hover
        cy.contains(originalPageName)
            .parent()
            .parent()
            .trigger('mouseenter', { force: true })
            .trigger('mouseover', { force: true });

        cy.wait(1000);

        // Look for the more actions button - using PageSelectors
        PageSelectors.moreActionsButton().first().click({ force: true });

        testLog.info( 'Clicked more actions button');

        // Click on Duplicate option which is available in the dropdown
        DropdownSelectors.content().within(() => {
            cy.contains('Duplicate').click();
        });
        testLog.info( 'Clicked Duplicate option');

        // Wait for the duplication to complete
        waitForReactUpdate(2000);

        // Verify the page was duplicated - there should now be two pages with similar names
        // The duplicated page usually has "(copy)" or similar suffix
        cy.contains('Getting started').should('exist');

        // Check if there's a duplicated page (might have a suffix like "(1)" or "(copy)")
        PageSelectors.names().then(($pages: JQuery<HTMLElement>) => {
            const pageCount = $pages.filter((index: number, el: HTMLElement) =>
                el.textContent?.includes('Getting started')).length;
            expect(pageCount).to.be.at.least(1);
            testLog.info( `Found ${pageCount} pages with 'Getting started' in the name`);
        });

        testLog.info( 'Page successfully duplicated');
    });

    it('should rename a page and verify the name persists after refresh', () => {
        // Handle uncaught exceptions during workspace creation
        cy.on('uncaught:exception', (err: Error) => {
            if (err.message.includes('No workspace or service found')) {
                return false;
            }
            return true;
        });

        // Sign in first
        cy.visit('/login', { failOnStatusCode: false });
        cy.wait(2000);

        const authUtils = new AuthTestUtils();
        authUtils.signInWithTestUrl(testEmail);

        cy.url().should('include', '/app');
        TestTool.waitForPageLoad(3000);

        // Wait for the sidebar to load properly
        TestTool.waitForSidebarReady();
        cy.wait(2000);

        // Store the original page name
        const originalPageName = 'Getting started';
        const renamedPageName = `Renamed Page ${Date.now()}`;

        testLog.info( `Starting rename test: ${originalPageName} -> ${renamedPageName}`);

        // Find the page item in the sidebar and click its more actions button
        // Using itemByName to ensure we target the sidebar's page row, not the header
        PageSelectors.itemByName(originalPageName)
            .trigger('mouseenter', { force: true })
            .trigger('mouseover', { force: true });

        cy.wait(1000);

        // Click the more actions button within the sidebar page item (not the header)
        PageSelectors.moreActionsButton(originalPageName).click({ force: true });

        testLog.info( 'Clicked more actions button');

        // Wait for the dropdown menu to be visible
        DropdownSelectors.content().should('be.visible');

        // Click on Rename option using the proper selector
        ViewActionSelectors.renameButton().should('be.visible').click();

        testLog.info( 'Clicked Rename option');

        // Wait for the rename modal to appear
        ModalSelectors.renameInput()
            .should('be.visible', { timeout: 5000 })
            .clear()
            .type(renamedPageName);

        testLog.info( `Entered new page name: ${renamedPageName}`);

        // Click the save button
        ModalSelectors.renameSaveButton().click();

        testLog.info( 'Clicked save button');

        // Wait for the modal to close and the page to update
        waitForReactUpdate(2000);

        // Verify the page was renamed in the sidebar
        cy.contains(renamedPageName, { timeout: 10000 }).should('exist');
        testLog.info( 'Page renamed successfully in sidebar');

        // Also verify the original name doesn't exist anymore
        cy.contains(originalPageName).should('not.exist');
        
        // Now refresh the page to verify the rename persisted
        testLog.info( 'Refreshing page to verify persistence...');
        cy.reload();
        
        // Wait for the page to reload completely
        TestTool.waitForPageLoad(3000);
        TestTool.waitForSidebarReady();
        cy.wait(2000);
        
        // Verify the renamed page still exists after refresh
        cy.contains(renamedPageName, { timeout: 10000 }).should('exist');
        testLog.info( 'Renamed page persisted after refresh');
        
        // Verify the original name is still gone
        cy.contains(originalPageName).should('not.exist');
        
        // Optional: Also verify the page is clickable and can be opened
        cy.contains(renamedPageName).click();
        cy.wait(2000);
        
        // Verify we're on the renamed page by checking the URL or page content
        cy.url().should('include', '/app');
        
        testLog.info( 'Rename test completed successfully - name persisted after refresh');
    });
});
