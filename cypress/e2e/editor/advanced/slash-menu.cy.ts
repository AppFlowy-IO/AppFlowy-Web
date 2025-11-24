import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, PageSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Editor Slash Menu', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  it('should trigger slash menu when typing / and display menu options', () => {
    const testEmail = generateRandomEmail();

    cy.log(`[TEST START] Testing slash menu trigger - Test email: ${testEmail}`);

    // Login
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Navigate to Getting started page
      cy.contains('Getting started').click();
      cy.wait(5000); // Give page time to fully load

      // Focus on editor
      EditorSelectors.slateEditor().should('exist').click();
      waitForReactUpdate(1000);

      // Type slash to open menu
      cy.focused().type('/');
      waitForReactUpdate(1000);

      // Verify main menu items are visible
      cy.contains('Ask AI Anything').should('be.visible');
      cy.contains('Text').should('be.visible');
      cy.contains('Heading 1').should('be.visible');
      cy.contains('Image').should('be.visible');
      cy.contains('Bulleted list').should('be.visible');

      // Close menu
      cy.get('body').type('{esc}');
      waitForReactUpdate(500);

      cy.log('Slash menu test completed successfully');
    });
  });

});
