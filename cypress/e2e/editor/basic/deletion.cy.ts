import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Basic Text Input & Deletion', () => {
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

  it('should delete character forward using Delete key', () => {
    // Type "Test Text"
    cy.focused().type('Test Text');
    
    // Move cursor to before "Text" (index 5)
    // "Test |Text"
    cy.focused().type('{leftArrow}{leftArrow}{leftArrow}{leftArrow}');
    waitForReactUpdate(200);
    
    // Press Delete
    cy.focused().type('{del}');
    waitForReactUpdate(200);
    
    // Expect "Test ext"
    cy.contains('Test ext').should('be.visible');
  });

  it('should delete word backward using Cmd+Backspace', () => {
    // Type "Hello World Test"
    cy.focused().type('Hello World Test');
    
    // Press Cmd+Backspace
    cy.focused().type('{cmd}{backspace}');
    waitForReactUpdate(200);
    
    // Expect "Hello World " (or "Hello World" if space is consumed, usually space remains or consumed depending on implementation)
    // Standard MacOS: "Hello World Test" -> Cmd+Backspace -> "Hello World "
    cy.contains('Hello World').should('be.visible');
    cy.contains('Test').should('not.exist');
  });

  it('should delete word forward using Option+Delete', () => {
    // Note: Cmd+Delete usually deletes to end of line on Mac. Option+Delete deletes word forward.
    // Let's test Option+Delete (Alt+Delete) as "Delete Word Forward".
    
    // Type "Hello World Test"
    cy.focused().type('Hello World Test');
    
    // Move cursor to before "World"
    // "Hello |World Test"
    cy.focused().type('{home}'); // Start of line
    cy.focused().type('{rightArrow}{rightArrow}{rightArrow}{rightArrow}{rightArrow}{rightArrow}'); // Move past "Hello "
    
    // Press Alt+Delete (Option+Delete on Mac)
    cy.focused().type('{alt}{del}');
    waitForReactUpdate(200);
    
    // Expect "Hello  Test" (World deleted)
    cy.contains('Hello').should('be.visible');
    cy.contains('Test').should('be.visible');
    cy.contains('World').should('not.exist');
  });
});
