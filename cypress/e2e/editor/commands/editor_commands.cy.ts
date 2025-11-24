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
    
    EditorSelectors.firstEditor().click({ force: true });
    cy.focused().type('{selectall}{backspace}');
    waitForReactUpdate(500);
  });

  it('should Undo typing', () => {
    cy.focused().type('Undo Me');
    waitForReactUpdate(500);
    cy.contains('Undo Me').should('be.visible');
    
    // Use realPress for robust undo shortcut
    if (Cypress.platform === 'darwin') {
      cy.realPress(['Meta', 'z']);
    } else {
      cy.realPress(['Control', 'z']);
    }
    waitForReactUpdate(500);
    
    cy.get('[contenteditable]').should('not.contain', 'Undo Me');
  });

  it('should Redo typing', () => {
    cy.focused().type('Redo Me');
    waitForReactUpdate(500);
    
    // Undo first
    if (Cypress.platform === 'darwin') {
      cy.realPress(['Meta', 'z']);
    } else {
      cy.realPress(['Control', 'z']);
    }
    waitForReactUpdate(500);
    cy.contains('Redo Me').should('not.exist');
    
    // Redo
    if (Cypress.platform === 'darwin') {
      cy.realPress(['Meta', 'Shift', 'z']);
    } else {
      cy.realPress(['Control', 'Shift', 'z']);
    }
    waitForReactUpdate(500);
    
    cy.contains('Redo Me').should('be.visible');
  });

  it('should insert soft break on Shift+Enter', () => {
    cy.focused().type('Line 1');
    cy.focused().type('{shift}{enter}');
    waitForReactUpdate(200);
    cy.focused().type('Line 2');
    cy.get('[data-block-type="paragraph"]').should('have.length', 1);
    cy.contains('Line 1').should('be.visible');
    cy.contains('Line 2').should('be.visible');
  });
});
