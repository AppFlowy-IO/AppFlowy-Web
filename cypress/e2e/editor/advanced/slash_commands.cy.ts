import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Advanced Slash Commands', () => {
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

  it('should insert Callout block', () => {
    cy.focused().type('/callout');
    waitForReactUpdate(1000);
    cy.focused().type('{enter}');
    waitForReactUpdate(500);
    
    // Verify Callout exists (look for icon or specific class)
    // Callout usually has an icon
    cy.get('[data-block-type="callout"]').should('exist');
    cy.focused().type('Callout Content');
    cy.contains('Callout Content').should('be.visible');
  });

  it('should insert Code block', () => {
    cy.focused().type('/code');
    waitForReactUpdate(1000);
    cy.focused().type('{enter}');
    waitForReactUpdate(500);
    
    cy.get('[data-block-type="code"]').should('exist');
    cy.focused().type('console.log("Hello");');
    cy.contains('console.log("Hello");').should('be.visible');
  });

  it('should insert Divider', () => {
    cy.focused().type('/divider');
    waitForReactUpdate(1000);
    cy.focused().type('{enter}');
    waitForReactUpdate(500);
    
    cy.get('[data-block-type="divider"]').should('exist');
  });

  it('should insert Toggle List', () => {
    cy.focused().type('/toggle');
    waitForReactUpdate(1000);
    // Select "Toggle list"
    cy.contains('Toggle list').click();
    waitForReactUpdate(500);
    
    cy.get('[data-block-type="toggle_list"]').should('exist');
    cy.focused().type('Toggle Header');
    cy.contains('Toggle Header').should('be.visible');
  });

  it('should insert Math Equation', () => {
    cy.focused().type('/math');
    waitForReactUpdate(1000);
    cy.focused().type('{enter}');
    waitForReactUpdate(500);
    
    cy.get('[data-block-type="math_equation"]').should('exist');
  });
});
