import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Formatting Shortcuts', () => {
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

  it('should apply Italic using shortcut', () => {
    cy.focused().type('Normal ');
    cy.focused().type('{cmd}i');
    cy.focused().type('Italic');
    waitForReactUpdate(200);
    cy.get('em').should('contain.text', 'Italic');
  });

  it('should apply Underline using shortcut', () => {
    cy.focused().type('Normal ');
    cy.focused().type('{cmd}u');
    cy.focused().type('Underline');
    waitForReactUpdate(200);
    cy.get('u').should('contain.text', 'Underline');
  });

  it('should apply Strikethrough using shortcut', () => {
    cy.focused().type('Normal ');
    // Common shortcut is Cmd+Shift+X or Cmd+Shift+S. 
    // AppFlowy uses Cmd+Shift+X typically.
    cy.focused().type('{cmd}{shift}x');
    cy.focused().type('Strikethrough');
    waitForReactUpdate(200);
    // Check for s, del, or style text-decoration: line-through
    cy.get('s, del, strike, [style*="text-decoration: line-through"]').should('contain.text', 'Strikethrough');
  });

  it('should apply Code using shortcut', () => {
    cy.focused().type('Normal Code');
    waitForReactUpdate(200);
    
    // Select "Normal Code"
    cy.focused().type('{selectall}');
    waitForReactUpdate(500);
    
    // Apply Code shortcut using realPress for native event simulation
    if (Cypress.platform === 'darwin') {
      cy.realPress(['Meta', 'e']);
    } else {
      cy.realPress(['Control', 'e']);
    }
    waitForReactUpdate(500);
    
    // Verify "Code" has the specific class for inline code
    // We check for the span with specific class used by AppFlowy for inline code
    cy.get('span.bg-border-primary').should('contain.text', 'Code');
  });
});
