import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';


import { waitForReactUpdate } from '../../support/selectors';

describe('Slash Menu - List Actions', () => {
  

  before(() => {
    logTestEnvironment();
  });

  beforeEach(() => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  });

  it('should show list options in slash menu', () => {
    let testEmail: string;

    cy.log(`[TEST START] Testing list options - Test email: ${testEmail}`);

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

      // Verify list options are visible
      cy.log('Verifying Bulleted list option');
      cy.contains('Bulleted list').should('be.visible');

      cy.log('Verifying Numbered list option');
      cy.contains('Numbered list').should('be.visible');

      // Close menu
      cy.get('body').type('{esc}');
      waitForReactUpdate(500);

      cy.log('List options verified successfully');
    });
  });

  it('should allow selecting Bulleted list from slash menu', () => {
    let testEmail: string;

    cy.log(`[TEST START] Testing Bulleted list selection - Test email: ${testEmail}`);

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

      // Click Bulleted list
      cy.contains('Bulleted list').should('be.visible').click();
      waitForReactUpdate(1000);

      // Type some text
      cy.focused().type('Test bullet item');
      waitForReactUpdate(500);

      // Verify the text was added
      cy.get('[data-slate-editor="true"]').should('contain.text', 'Test bullet item');

      cy.log('Bulleted list added successfully');
    });
  });

});