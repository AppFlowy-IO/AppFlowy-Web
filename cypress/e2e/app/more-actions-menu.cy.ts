import { AuthTestUtils } from '../../support/auth-utils';
import { DropdownSelectors, PageSelectors, SidebarSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';
import { TestTool } from '../../support/page-utils';

/**
 * Tests for More Actions menu after removing unnecessary useMemo.
 * Verifies that the menu renders correctly and all items function as expected.
 */
describe('More Actions Menu', () => {
  let testEmail: string;

  beforeEach(() => {
    testEmail = generateRandomEmail();

    cy.on('uncaught:exception', (err: Error) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return false;
      }
      return true;
    });
  });

  it('should render all menu items correctly in More Actions popover', () => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url().should('include', '/app');
      TestTool.waitForPageLoad(3000);
      TestTool.waitForSidebarReady();
      cy.wait(2000);

      testLog.info('Looking for page to test More Actions menu');

      // Find a page and hover to reveal more actions button
      cy.contains('Getting started')
        .parent()
        .parent()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });

      cy.wait(1000);

      // Click the more actions button
      PageSelectors.moreActionsButton().first().click({ force: true });
      testLog.info('Clicked more actions button');

      // Verify the menu is visible
      DropdownSelectors.content().should('exist').should('be.visible');

      // Verify core menu items are rendered
      DropdownSelectors.content().within(() => {
        cy.contains('Delete').should('exist');
        cy.contains('Duplicate').should('exist');
        cy.contains('Move to').should('exist');
      });

      testLog.info('All core menu items rendered correctly');
    });
  });

  it('should close menu on Escape key', () => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url().should('include', '/app');
      TestTool.waitForPageLoad(3000);
      TestTool.waitForSidebarReady();
      cy.wait(2000);

      // Find a page and hover to reveal more actions button
      cy.contains('Getting started')
        .parent()
        .parent()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });

      cy.wait(1000);

      // Click the more actions button to open menu
      PageSelectors.moreActionsButton().first().click({ force: true });

      // Verify menu is open
      DropdownSelectors.content().should('be.visible');

      // Press Escape to close
      cy.get('body').type('{esc}');
      waitForReactUpdate(500);

      // Verify menu is closed
      DropdownSelectors.content().should('not.exist');

      testLog.info('Menu closed correctly on Escape key');
    });
  });

  it('should not have render errors after removing useMemo', () => {
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url().should('include', '/app');
      TestTool.waitForPageLoad(3000);
      TestTool.waitForSidebarReady();
      cy.wait(2000);

      // Open more actions menu
      cy.contains('Getting started')
        .parent()
        .parent()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });

      cy.wait(1000);
      PageSelectors.moreActionsButton().first().click({ force: true });
      DropdownSelectors.content().should('be.visible');

      // Check for render errors in console
      cy.getConsoleLogs().then((consoleLogs) => {
        const renderErrors = consoleLogs.filter((log: any) => {
          const message = JSON.stringify(log.args || []).toLowerCase();
          return (
            log.type === 'error' &&
            (message.includes('moreactions') ||
              message.includes('cannot read property') ||
              message.includes('is not a function'))
          );
        });

        expect(renderErrors.length).to.equal(0, 'No render errors should occur in More Actions menu');
      });

      testLog.info('No render errors detected after useMemo removal');
    });
  });
});
