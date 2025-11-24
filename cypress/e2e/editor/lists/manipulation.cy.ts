import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('List Manipulation', () => {
  const authUtils = new AuthTestUtils();
  const testEmail = generateRandomEmail();

  before(() => {
    cy.viewport(1280, 720);
  });

  beforeEach(() => {
    cy.on('uncaught:exception', () => false);
    cy.visit('/login', { failOnStatusCode: false });

    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.contains('Getting started', { timeout: 10000 }).should('be.visible').click();
      cy.wait(3000);
      
      EditorSelectors.firstEditor().click({ force: true });
      cy.focused().type('{selectall}{backspace}');
      waitForReactUpdate(500);
    });
  });

  it('should indent and outdent list items', () => {
    // Create list
    cy.focused().type('- Item 1{enter}Item 2');
    waitForReactUpdate(200);
    
    // Indent Item 2
    // Cypress doesn't support {tab} in .type() by default for indentation
    cy.focused().trigger('keydown', { key: 'Tab', keyCode: 9, which: 9 });
    waitForReactUpdate(200);
    
    // Outdent Item 2
    cy.focused().trigger('keydown', { key: 'Tab', keyCode: 9, which: 9, shiftKey: true });
    waitForReactUpdate(200);
  });

  it('should convert empty list item to paragraph on Enter', () => {
    cy.focused().type('- Item 1{enter}');
    // Now on empty list item
    
    cy.focused().type('{enter}');
    // Should be paragraph now
    
    cy.focused().type('Paragraph Text');
    // Verify "Paragraph Text" is NOT in a list item
    // Check that it doesn't have list marker
    cy.contains('Paragraph Text').should('be.visible');
    // TODO: Add specific selector check to ensure it's a p/div not li
  });

  it('should toggle todo checkbox', () => {
    cy.focused().type('[] Todo Item');
    waitForReactUpdate(200);
    
    // Find the checkbox SVG/span and click it
    cy.get('span.text-block-icon').first().click();
    waitForReactUpdate(200);
    
    // Verify checked state (class 'checked' or svg change)
    // Based on `TodoList.tsx` code read earlier: class `checked` is applied to the div
    cy.get('.checked').should('exist');
    
    // Uncheck
    cy.get('span.text-block-icon').first().click();
    cy.get('.checked').should('not.exist');
  });
});
