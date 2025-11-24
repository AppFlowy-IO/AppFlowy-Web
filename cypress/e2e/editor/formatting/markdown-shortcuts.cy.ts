import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Editor Markdown Shortcuts', () => {
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

  it('should convert "# " to Heading 1', () => {
    cy.focused().type('# Heading 1');
    waitForReactUpdate(500);
    cy.contains('h1, div', 'Heading 1').should('exist');
  });

  it('should convert "## " to Heading 2', () => {
    cy.focused().type('## Heading 2');
    waitForReactUpdate(500);
    cy.contains('h2, div', 'Heading 2').should('exist');
  });

  it('should convert "### " to Heading 3', () => {
    cy.focused().type('### Heading 3');
    waitForReactUpdate(500);
    cy.contains('h3, div', 'Heading 3').should('exist');
  });

  it('should convert "- " to Bullet List', () => {
    cy.focused().type('- Bullet Item');
    waitForReactUpdate(500);
    cy.contains('Bullet Item').should('be.visible');
    cy.contains('- Bullet Item').should('not.exist');
  });

  it('should convert "1. " to Numbered List', () => {
    cy.focused().type('1. Numbered Item');
    waitForReactUpdate(500);
    cy.contains('Numbered Item').should('be.visible');
    cy.contains('1. Numbered Item').should('not.exist');
  });

  it('should convert "[] " to Todo List', () => {
    cy.focused().type('[] Todo Item');
    waitForReactUpdate(500);
    cy.contains('Todo Item').should('be.visible');
    cy.get('span.text-block-icon svg').should('exist');
    cy.contains('[] Todo Item').should('not.exist');
  });

  it('should convert "> " to Quote', () => {
    cy.focused().type('> Quote Text');
    waitForReactUpdate(500);
    cy.contains('Quote Text').should('be.visible');
    cy.contains('> Quote Text').should('not.exist');
  });

  it('should convert `code` to inline code', () => {
    cy.focused().type('Normal `Inline Code` Normal');
    waitForReactUpdate(500);
    cy.contains('code, span', 'Inline Code').should('exist');
    cy.contains('`Inline Code`').should('not.exist');
  });
});