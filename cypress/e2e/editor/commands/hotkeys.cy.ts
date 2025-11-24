import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Editor Commands', () => {
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
      
      // Focus and clear editor
      EditorSelectors.firstEditor().click({ force: true });
      cy.focused().type('{selectall}{backspace}');
      waitForReactUpdate(500);
    });
  });

  it('should Undo typing', () => {
    cy.focused().type('Undo Me');
    waitForReactUpdate(200);
    cy.contains('Undo Me').should('be.visible');
    
    // Undo (Cmd+Z)
    cy.focused().type('{cmd}z');
    waitForReactUpdate(200);
    
    // Text should be gone (or partially gone depending on undo stack granularity)
    // In AppFlowy/Yjs, undo usually undoes the last transaction. Typing "Undo Me" might be one or more transactions.
    // We check for change.
    cy.get('[contenteditable]').should('not.contain', 'Undo Me');
  });

  it('should Redo typing', () => {
    cy.focused().type('Redo Me');
    waitForReactUpdate(200);
    
    // Undo
    cy.focused().type('{cmd}z');
    waitForReactUpdate(200);
    cy.contains('Redo Me').should('not.exist');
    
    // Redo (Cmd+Shift+Z)
    cy.focused().type('{cmd}{shift}z');
    waitForReactUpdate(200);
    
    // Text should be back
    cy.contains('Redo Me').should('be.visible');
  });

  it('should insert soft break on Shift+Enter', () => {
    cy.focused().type('Line 1');
    
    // Shift+Enter
    cy.focused().type('{shift}{enter}');
    waitForReactUpdate(200);
    
    cy.focused().type('Line 2');
    
    // Verify they are in the same block (or at least visually separated but not a new paragraph block)
    // In AppFlowy, soft break adds a \n in the text node, not a new Block node.
    // We can check block count.
    
    cy.get('[data-block-type="paragraph"]').should('have.length', 1);
    cy.contains('Line 1').should('be.visible');
    cy.contains('Line 2').should('be.visible');
  });
});
