import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';


import { waitForReactUpdate } from '../../support/selectors';

describe('Slash Menu - Media Actions', () => {
  

  before(() => {
    logTestEnvironment();
  });

  beforeEach(() => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  });

  it('should show media options in slash menu', () => {
    let testEmail: string;

    cy.log(`[TEST START] Testing media options - Test email: ${testEmail}`);

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

      // Verify media options are visible
      cy.log('Verifying Image option');
      cy.contains('Image').should('be.visible');

      cy.log('Verifying Embed video option');
      cy.contains('Embed video').should('be.visible');

      // Close menu
      cy.get('body').type('{esc}');
      waitForReactUpdate(500);

      cy.log('Media options verified successfully');
    });
  });

  it('should allow selecting Image from slash menu', () => {
    let testEmail: string;

    cy.log(`[TEST START] Testing Image selection - Test email: ${testEmail}`);

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

      // Click Image
      cy.contains('Image').should('be.visible').click();
      waitForReactUpdate(1000);

      cy.log('Image option clicked successfully');
    });
  });
});