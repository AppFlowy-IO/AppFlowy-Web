import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Editor Lists Manipulation', () => {
  const testEmail = generateRandomEmail();

  before(() => {
    cy.viewport(1280, 720);
  });

  beforeEach(() => {
    cy.on('uncaught:exception', () => false);
    
    cy.session(testEmail, () => {
      cy.signIn(testEmail);
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

  describe('List Items', () => {
    it('should indent and outdent list items', () => {
      cy.focused().type('- Item 1{enter}Item 2');
      waitForReactUpdate(200);
      cy.focused().trigger('keydown', { key: 'Tab', keyCode: 9, which: 9 });
      waitForReactUpdate(200);
      cy.focused().trigger('keydown', { key: 'Tab', keyCode: 9, which: 9, shiftKey: true });
      waitForReactUpdate(200);
    });

    it('should convert empty list item to paragraph on Enter', () => {
      cy.focused().type('- Item 1{enter}');
      cy.focused().type('{enter}');
      cy.focused().type('Paragraph Text');
      cy.contains('Paragraph Text').should('be.visible');
    });

    it('should toggle todo checkbox', () => {
      cy.focused().type('[] Todo Item');
      waitForReactUpdate(200);
      cy.get('span.text-block-icon').first().click();
      waitForReactUpdate(200);
      cy.get('.checked').should('exist');
      cy.get('span.text-block-icon').first().click();
      cy.get('.checked').should('not.exist');
    });
  });

  describe('Slash Menu Lists', () => {
    it('should show list options in slash menu', () => {
      cy.focused().type('/');
      waitForReactUpdate(1000);
      cy.contains('Bulleted list').should('be.visible');
      cy.contains('Numbered list').should('be.visible');
      cy.get('body').type('{esc}');
    });

    it('should allow selecting Bulleted list from slash menu', () => {
      cy.focused().type('/');
      waitForReactUpdate(1000);
      cy.contains('Bulleted list').should('be.visible').click();
      waitForReactUpdate(1000);
      cy.focused().type('Test bullet item');
      waitForReactUpdate(500);
      EditorSelectors.slateEditor().should('contain.text', 'Test bullet item');
    });
  });
});
