import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail, getCmdKey } from '../../../support/test-config';

describe('Editor Navigation & Interaction', () => {
  const authUtils = new AuthTestUtils();
  const testEmail = generateRandomEmail();
  const cmdKey = getCmdKey();

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

  describe('Cursor Movement', () => {
    it('should navigate to start/end of line', () => {
      cy.focused().type('Start Middle End');
      waitForReactUpdate(500);
      cy.focused().type('{selectall}{leftArrow}');
      waitForReactUpdate(200);
      cy.focused().type('X');
      waitForReactUpdate(200);
      cy.get('[data-slate-editor="true"]').should('contain.text', 'XStart Middle End');
      cy.focused().type('{selectall}{rightArrow}');
      waitForReactUpdate(200);
      cy.focused().type('Y');
      cy.get('[data-slate-editor="true"]').should('contain.text', 'XStart Middle EndY');
    });

    it('should navigate word by word', () => {
      cy.focused().type('Word1 Word2 Word3');
      waitForReactUpdate(500);
      cy.focused().type('{selectall}{leftArrow}');
      cy.focused().type('{alt}{rightArrow}');
      waitForReactUpdate(200);
      cy.focused().type('-');
      cy.get('[data-slate-editor="true"]').should('contain.text', 'Word1-');
    });

    it('should select word on double click', () => {
      cy.focused().type('SelectMe');
      waitForReactUpdate(500);
      cy.contains('SelectMe').click();
      waitForReactUpdate(100);
      cy.contains('SelectMe').trigger('dblclick');
      waitForReactUpdate(200);
      cy.focused().type('Replaced');
      cy.get('[data-slate-editor="true"]').should('contain.text', 'Replaced');
      cy.get('[data-slate-editor="true"]').should('not.contain.text', 'SelectMe');
    });
  });

  describe('Block Interaction', () => {
    it('should handle cursor navigation with arrow keys', () => {
      cy.focused().type('Line 1{enter}');
      cy.focused().type('Line 2{enter}');
      cy.focused().type('Line 3');
      waitForReactUpdate(500);
      cy.contains('Line 2').click();
      cy.focused().type('{home}');
      waitForReactUpdate(200);
      cy.focused().type('Inserted');
      cy.contains('InsertedLine 2').should('be.visible');
    });

    it('should merge blocks on backspace', () => {
      cy.focused().type('Paragraph One');
      cy.focused().type('{enter}');
      cy.focused().type('Paragraph Two');
      waitForReactUpdate(500);
      cy.contains('Paragraph Two').click();
      cy.focused().type('{home}');
      waitForReactUpdate(200);
      cy.focused().type('{backspace}');
      waitForReactUpdate(500);
      cy.contains('Paragraph OneParagraph Two').should('be.visible');
    });
    
    it('should split block on enter', () => {
      cy.focused().type('SplitHere');
      cy.focused().type('{leftArrow}{leftArrow}{leftArrow}{leftArrow}'); 
      cy.focused().type('{enter}');
      cy.contains('Split').should('be.visible');
      cy.contains('Here').should('be.visible');
    });
  });

  describe('Style Interaction', () => {
    it('should persist bold style when typing inside bold text', () => {
      cy.focused().type('Normal ');
      cy.get('[data-slate-editor="true"]').click();
      cy.focused().type(`${cmdKey}b`); 
      waitForReactUpdate(200);
      cy.focused().type('Bold');
      cy.get('strong').should('contain.text', 'Bold');
      cy.focused().type('{leftArrow}{leftArrow}');
      cy.focused().type('X');
      cy.get('strong').should('contain.text', 'BoXld');
    });

    it('should reset style when creating a new paragraph', () => {
      cy.get('[data-slate-editor="true"]').click();
      cy.focused().type(`${cmdKey}b`); 
      waitForReactUpdate(200);
      cy.focused().type('Heading Bold');
      cy.get('strong').should('contain.text', 'Heading Bold');
      cy.focused().type('{enter}');
      cy.focused().type('Next Line');
      cy.contains('Next Line').should('be.visible');
      cy.contains('Next Line').parents('strong').should('not.exist');
    });
  });
});
