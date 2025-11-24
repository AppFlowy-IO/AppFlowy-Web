import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Editor Selection and Deletion', () => {
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

  it('should select all and delete multiple blocks', () => {
    // Setup 3 blocks
    cy.focused().type('Block 1{enter}Block 2{enter}Block 3');
    waitForReactUpdate(500);
    
    // Select All
    cy.focused().type('{selectall}');
    waitForReactUpdate(200);
    
    // Delete
    cy.focused().type('{backspace}');
    waitForReactUpdate(200);
    
    // Verify empty (or single empty block)
    cy.contains('Block 1').should('not.exist');
    cy.contains('Block 2').should('not.exist');
    cy.contains('Block 3').should('not.exist');
  });

  it('should replace selection with typed text', () => {
    cy.focused().type('Hello World');
    
    // Select "World" (5 chars)
    cy.focused().type('{shift}{leftArrow}{leftArrow}{leftArrow}{leftArrow}{leftArrow}');
    
    // Type replacement
    cy.focused().type('AppFlowy');
    
    // Verify
    cy.contains('Hello AppFlowy').should('be.visible');
    cy.contains('Hello World').should('not.exist');
  });

  it('should delete selected text within a block', () => {
    cy.focused().type('Hello World');
    waitForReactUpdate(500);
    
    // Select "World" (5 chars)
    cy.focused().type('{shift}{leftArrow}{leftArrow}{leftArrow}{leftArrow}{leftArrow}');
    waitForReactUpdate(200);
    
    // Delete
    cy.focused().type('{backspace}');
    waitForReactUpdate(500);
    
    // Verify
    cy.contains('Hello').should('be.visible');
    cy.contains('World').should('not.exist');
  });
});
