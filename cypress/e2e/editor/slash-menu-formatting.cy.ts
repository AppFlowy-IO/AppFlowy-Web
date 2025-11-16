import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';


import { waitForReactUpdate } from '../../support/selectors';

describe('Slash Menu - Text Formatting', () => {
  

  before(() => {
    logTestEnvironment();
  });

  beforeEach(() => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  });

  it('should show text formatting options in slash menu', () => {
    let testEmail: string;

    cy.log(`[TEST START] Testing text formatting options - Test email: ${testEmail}`);

    // Login
    
    

    
    cy.loginTestUser().then((email) => {
      testEmail = email;
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Navigate to Getting started page
      cy.contains('Getting started').click();
      cy.wait(5000); // Give page time to fully load

      // Focus on editor
      cy.get('[data-slate-editor="true"]').should('exist').click();
      waitForReactUpdate(1000);

      // Type slash to open menu
      cy.focused().type('/');
      waitForReactUpdate(1000);

      // Verify text formatting options are visible
      cy.log('Verifying Text option');
      cy.contains('Text').should('be.visible');

      cy.log('Verifying Heading 1 option');
      cy.contains('Heading 1').should('be.visible');

      cy.log('Verifying Heading 2 option');
      cy.contains('Heading 2').should('be.visible');

      cy.log('Verifying Heading 3 option');
      cy.contains('Heading 3').should('be.visible');

      // Close menu
      cy.get('body').type('{esc}');
      waitForReactUpdate(500);

      cy.log('Text formatting options verified successfully');
    });
  });

  it('should allow selecting Heading 1 from slash menu', () => {
    let testEmail: string;

    cy.log(`[TEST START] Testing Heading 1 selection - Test email: ${testEmail}`);

    // Login
    
    

    
    cy.loginTestUser().then((email) => {
      testEmail = email;
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Navigate to Getting started page
      cy.contains('Getting started').click();
      cy.wait(5000);

      // Focus on editor and move to end
      cy.get('[data-slate-editor="true"]').should('exist').click();
      cy.focused().type('{end}');
      cy.focused().type('{enter}{enter}'); // Add some space
      waitForReactUpdate(1000);

      // Type slash to open menu
      cy.focused().type('/');
      waitForReactUpdate(1000);

      // Click Heading 1
      cy.contains('Heading 1').should('be.visible').click();
      waitForReactUpdate(1000);

      // Type some text
      cy.focused().type('Test Heading');
      waitForReactUpdate(500);

      // Verify the text was added
      cy.get('[data-slate-editor="true"]').should('contain.text', 'Test Heading');

      cy.log('Heading 1 added successfully');
    });
  });
});