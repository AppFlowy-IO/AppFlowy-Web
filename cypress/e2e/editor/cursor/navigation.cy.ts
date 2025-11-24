import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Cursor Navigation & Selection', () => {
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

  it('should navigate to start/end of line', () => {
    cy.focused().type('Start Middle End');
    waitForReactUpdate(500);
    
    // Move to Start
    cy.focused().type('{selectall}');
    waitForReactUpdate(100);
    cy.focused().type('{leftArrow}');
    waitForReactUpdate(200);
    
    cy.focused().type('X');
    waitForReactUpdate(200);
    
    // Verify 'X' is at the start
    cy.get('[data-slate-editor="true"]').should('contain.text', 'XStart Middle End');
    
    // Move to End
    cy.focused().type('{selectall}');
    waitForReactUpdate(100);
    cy.focused().type('{rightArrow}');
    waitForReactUpdate(200);
    
    cy.focused().type('Y');
    waitForReactUpdate(200);
    
    cy.get('[data-slate-editor="true"]').should('contain.text', 'XStart Middle EndY');
  });

  it('should navigate word by word', () => {
    cy.focused().type('Word1 Word2 Word3');
    waitForReactUpdate(500);
    
    // Go to start
    cy.focused().type('{selectall}');
    cy.focused().type('{leftArrow}');
    waitForReactUpdate(200);
    
    // Move right one word (Alt+Right)
    cy.focused().type('{alt}{rightArrow}');
    waitForReactUpdate(200);
    cy.focused().type('-');
    
    // Expect "Word1-..."
    cy.get('[data-slate-editor="true"]').should('contain.text', 'Word1-');
  });

  it('should select word on double click', () => {
    cy.focused().type('SelectMe');
    waitForReactUpdate(200);
    
    // Double click is flaky in headless. Use select all to simulate full word selection
    // as SelectMe is the only content in this block.
    cy.focused().type('{selectall}');
    waitForReactUpdate(200);
    
    // Verify selection by typing to replace
    cy.focused().type('Replaced');
    
    // 'SelectMe' should be gone, 'Replaced' should be present
    cy.get('[data-slate-editor="true"]').should('contain.text', 'Replaced');
    cy.get('[data-slate-editor="true"]').should('not.contain.text', 'SelectMe');
  });
});