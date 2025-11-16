import { EditorSelectors, PageSelectors, waitForReactUpdate } from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

describe('Editor Slash Menu', () => {
  before(() => {
    logTestEnvironment();
  });

  beforeEach(() => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  });

  it('should trigger slash menu when typing / and display menu options', () => {
    let testEmail: string;

    cy.log(`[TEST START] Testing slash menu trigger`);

    // Login
    cy.loginTestUser().then((email) => {
      testEmail = email;
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