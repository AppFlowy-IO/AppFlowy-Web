import { AuthTestUtils } from '../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

describe('Toolbar Interaction', () => {
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

  const showToolbar = (text = 'Link text') => {
    cy.focused().type('{selectall}');
    waitForReactUpdate(500);
    EditorSelectors.selectionToolbar().should('exist').should('be.visible');
  };

  it('should open Link popover via toolbar', () => {
    cy.focused().type('Link text');
    showToolbar('Link text');
    cy.get('[data-testid="selection-toolbar"]').within(() => {
      cy.get('[data-testid="link-button"]').click({ force: true });
    });
    waitForReactUpdate(200);
    cy.get('.MuiPopover-root').should('be.visible');
    cy.get('input[placeholder*="Paste link"]').should('exist');
  });

  it('should open Text Color picker via toolbar', () => {
    cy.focused().type('Colored text');
    showToolbar('Colored text');
    cy.get('[data-testid="selection-toolbar"]').within(() => {
      cy.get('[data-testid="text-color-button"]').click({ force: true });
    });
    waitForReactUpdate(200);
    cy.get('[data-slot="popover-content"]').should('exist').should('be.visible');
    cy.get('[data-slot="popover-content"]').find('div').should('have.length.gt', 0);
  });

  it('should open Background Color picker via toolbar', () => {
    cy.focused().type('Highlighted text');
    showToolbar('Highlighted text');
    cy.get('[data-testid="selection-toolbar"]').within(() => {
      cy.get('[data-testid="bg-color-button"]').click({ force: true });
    });
    waitForReactUpdate(200);
    cy.get('[data-slot="popover-content"]').should('exist').should('be.visible');
    cy.get('[data-slot="popover-content"]').find('div').should('have.length.gt', 0);
  });

  it('should allow converting block type via toolbar', () => {
    cy.focused().type('Convert me');
    showToolbar('Convert me');
    cy.get('[data-testid="selection-toolbar"]').within(() => {
      cy.get('[data-testid="heading-button"]').click({ force: true });
    });
    waitForReactUpdate(200);
    cy.get('.MuiPopover-root').should('be.visible');
    cy.get('[data-testid="heading-1-button"]').should('exist');
  });
});
