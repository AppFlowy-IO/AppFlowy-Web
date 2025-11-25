import { AuthTestUtils } from '../../../support/auth-utils';
import { waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Advanced Editor Features', () => {
  const authUtils = new AuthTestUtils();
  const testEmail = generateRandomEmail();

  before(() => {
    cy.viewport(1280, 720);
  });

  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        // Ignore PrismJS error often seen in tests
        err.message.includes("Cannot set properties of undefined (setting 'class-name')")) {
        return false;
      }
      return true;
    });

    cy.session(testEmail, () => {
      authUtils.signInWithTestUrl(testEmail);
    }, {
      validate: () => {
        cy.window().then((win) => {
          const token = win.localStorage.getItem('af_auth_token');
          expect(token).to.be.ok;
        });
      }
    });

    cy.visit('/app');
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.contains('Getting started', { timeout: 10000 }).should('be.visible').click();
    cy.wait(2000);
    
    // Ensure any open menus are closed
    cy.get('body').type('{esc}');
    
    cy.get('[data-slate-editor="true"]').should('exist').click({ force: true });
    cy.focused().type('{selectall}{backspace}');
    waitForReactUpdate(500);
  });

  describe('Slash Commands', () => {
    it('should insert Callout block', () => {
      cy.focused().type('/callout');
      waitForReactUpdate(1000);
      cy.focused().type('{enter}');
      waitForReactUpdate(500);
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

  describe('Slash Menu Interaction', () => {
    it('should trigger slash menu when typing / and display menu options', () => {
      // Ensure focus and clean state
      cy.get('[data-slate-editor="true"]').click('topLeft', { force: true });
      cy.focused().type('{selectall}{backspace}');
      waitForReactUpdate(200);
      
      // Type slash to open menu
      cy.focused().type('/', { delay: 100 });
      waitForReactUpdate(1000);
      
      // Verify main menu items are visible
      cy.get('[data-testid="slash-menu-askAIAnything"]').should('exist');
      cy.get('[data-testid="slash-menu-text"]').should('be.visible');
      cy.get('[data-testid="slash-menu-heading1"]').should('be.visible');
      cy.get('[data-testid="slash-menu-image"]').should('be.visible');
      cy.get('[data-testid="slash-menu-bulletedList"]').should('be.visible');
      
      cy.get('body').type('{esc}');
    });

    it('should show media options in slash menu', () => {
      cy.get('[data-slate-editor="true"]').click('topLeft', { force: true });
      cy.focused().type('{selectall}{backspace}');
      waitForReactUpdate(200);
      
      cy.focused().type('/', { delay: 100 });
      waitForReactUpdate(1000);
      
      cy.get('[data-testid="slash-menu-image"]').should('be.visible');
      cy.get('[data-testid="slash-menu-video"]').should('be.visible');
      
      cy.get('body').type('{esc}');
    });

    it('should allow selecting Image from slash menu', () => {
      cy.get('[data-slate-editor="true"]').click('topLeft', { force: true });
      cy.focused().type('{selectall}{backspace}');
      waitForReactUpdate(200);
      
      cy.focused().type('/', { delay: 100 });
      waitForReactUpdate(1000);
      
      cy.get('[data-testid="slash-menu-image"]').should('be.visible').click();
      waitForReactUpdate(1000);
      
      // Verify image block inserted
      cy.get('[data-block-type="image"]').should('exist');
    });
  });
});
