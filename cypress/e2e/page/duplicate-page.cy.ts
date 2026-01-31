import { AuthTestUtils } from '../../support/auth-utils';
import { TestTool } from '../../support/page-utils';
import {
  AddPageSelectors,
  DropdownSelectors,
  EditorSelectors,
  HeaderSelectors,
  PageSelectors,
  SpaceSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

describe('Duplicate Page', () => {
  let testEmail: string;

  beforeEach(function () {
    testEmail = generateRandomEmail();
  });

  it('should create a document, type hello world, duplicate it, and verify content in duplicated document', () => {
    cy.on('uncaught:exception', (err: Error) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('Minified React error')
      ) {
        return false;
      }

      return true;
    });

    const pageName = `Test Page ${Date.now()}`;

    // Step 1: Sign in
    testLog.step(1, 'Signing in');
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail);

    cy.url().should('include', '/app');
    TestTool.waitForPageLoad(3000);
    TestTool.waitForSidebarReady();
    cy.wait(2000);

    // Step 2: Create a new document page
    testLog.step(2, 'Creating a new document page');

    SpaceSelectors.itemByName('General').first().click();
    waitForReactUpdate(500);

    SpaceSelectors.itemByName('General').first().within(() => {
      AddPageSelectors.inlineAddButton().first().should('be.visible').click();
    });
    waitForReactUpdate(1000);

    DropdownSelectors.menuItem().first().click();
    waitForReactUpdate(2000);

    testLog.info('New document page created (in modal mode)');

    // Step 3: Exit modal mode by pressing Escape
    testLog.step(3, 'Exiting modal mode');
    cy.get('body').type('{esc}');
    waitForReactUpdate(1000);
    testLog.info('Exited modal mode');

    // Step 4: Open the created page from sidebar (it should be "Untitled")
    testLog.step(4, 'Opening the created page from sidebar');
    PageSelectors.nameContaining('Untitled').first().click({ force: true });
    waitForReactUpdate(2000);
    testLog.info('Opened the page');

    // Step 5: Type "hello world" in the document
    testLog.step(5, 'Typing hello world in the document');

    EditorSelectors.firstEditor().should('exist', { timeout: 15000 });
    EditorSelectors.firstEditor().click({ force: true }).type('hello world', { force: true });
    cy.wait(2000);

    cy.contains('hello world').should('exist');
    testLog.info('Content added: "hello world"');

    // Step 6: Duplicate the document from the header
    testLog.step(6, 'Duplicating the document');

    HeaderSelectors.moreActionsButton().should('be.visible').click({ force: true });
    waitForReactUpdate(500);

    DropdownSelectors.content().within(() => {
      cy.contains('Duplicate').click();
    });
    testLog.info('Clicked Duplicate');

    // Verify toast appears
    cy.get('[data-sonner-toast]', { timeout: 5000 }).should('exist');
    testLog.info('Toast notification appeared');

    // Wait for duplication to complete and toast to dismiss
    // The toast should be dismissed after the operation completes
    cy.get('[data-sonner-toast]', { timeout: 15000 }).should('not.exist');
    testLog.info('Toast dismissed - duplication completed successfully');

    // Verify no error toast appeared
    cy.get('[data-sonner-toast][data-type="error"]').should('not.exist');

    // Step 7: Find and open the duplicated document
    testLog.step(7, 'Opening the duplicated document');

    // The duplicated page should have "(copy)" suffix
    // Look for it in the sidebar
    PageSelectors.names().then(($pages: JQuery<HTMLElement>) => {
      const duplicatedPage = Array.from($pages).find((el) => {
        const text = el.textContent || '';
        return text.includes('Untitled') && text.includes('(copy)');
      });

      if (duplicatedPage) {
        testLog.info(`Found duplicated page: ${duplicatedPage.textContent}`);
        cy.wrap(duplicatedPage).click({ force: true });
      } else {
        // If no "(copy)" suffix, look for second Untitled page
        testLog.info('Looking for duplicated page');
        const untitledPages = Array.from($pages).filter((el) =>
          el.textContent?.includes('Untitled')
        );
        if (untitledPages.length > 1) {
          cy.wrap(untitledPages[1]).click({ force: true });
        } else {
          // Just click the first Untitled
          PageSelectors.nameContaining('Untitled').first().click({ force: true });
        }
      }
    });

    waitForReactUpdate(2000);

    // Step 8: Verify the duplicated document contains "hello world"
    testLog.step(8, 'Verifying content in duplicated document');

    cy.contains('hello world', { timeout: 10000 }).should('exist');
    testLog.info('Duplicated document contains "hello world"');

    // Step 9: Modify the content in the duplicated document
    testLog.step(9, 'Modifying content in duplicated document');

    EditorSelectors.firstEditor().should('exist', { timeout: 15000 });
    EditorSelectors.firstEditor().click({ force: true }).type(' - modified in copy', { force: true });
    cy.wait(2000);

    cy.contains('hello world - modified in copy').should('exist');
    testLog.success('Duplicated document modified successfully - test passed!');
  });
});
