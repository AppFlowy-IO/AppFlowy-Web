import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail, getCmdKey } from '../../../support/test-config';

describe('Editor Text Styling & Formatting', () => {
  const testEmail = generateRandomEmail();
  const cmdKey = getCmdKey();

  before(() => {
    cy.viewport(1280, 720);
  });

  beforeEach(() => {
    cy.on('uncaught:exception', () => false);
    
    // Use cy.session to cache the login session
    cy.session(testEmail, () => {
      // Logic to sign in
      // We need to ensure this runs fully only once
      cy.signIn(testEmail);
    }, {
      validate: () => {
        // Validate session is still active by checking cookies or localStorage
        cy.window().then((win) => {
          const token = win.localStorage.getItem('af_auth_token');
          expect(token).to.be.ok;
        });
      }
    });

    // After session restoration, visit the app
    cy.visit('/app');
    cy.url({ timeout: 30000 }).should('include', '/app');
    cy.contains('Getting started', { timeout: 10000 }).should('be.visible').click();
    cy.wait(2000); // Wait for editor load
    
    // Focus and clear editor
    EditorSelectors.firstEditor().click({ force: true });
    cy.focused().type('{selectall}{backspace}');
    waitForReactUpdate(500);
  });

  // Helper to show toolbar
  const showToolbar = (text = 'SelectMe') => {
    cy.focused().type(text);
    waitForReactUpdate(200);
    cy.focused().type('{selectall}');
    waitForReactUpdate(500);
    EditorSelectors.selectionToolbar().should('exist').should('be.visible');
  };

  describe('Keyboard Shortcuts', () => {
    it('should apply Bold using shortcut', () => {
      cy.focused().type('Normal ');
      cy.focused().type(`${cmdKey}b`);
      cy.focused().type('Bold');
      waitForReactUpdate(200);
      cy.get('strong').should('contain.text', 'Bold');
    });

    it('should apply Italic using shortcut', () => {
      cy.focused().type('Normal ');
      cy.focused().type(`${cmdKey}i`);
      cy.focused().type('Italic');
      waitForReactUpdate(200);
      cy.get('em').should('contain.text', 'Italic');
    });

    it('should apply Underline using shortcut', () => {
      cy.focused().type('Normal ');
      cy.focused().type(`${cmdKey}u`);
      cy.focused().type('Underline');
      waitForReactUpdate(200);
      cy.get('u').should('contain.text', 'Underline');
    });

    it('should apply Strikethrough using shortcut', () => {
      cy.focused().type('Normal ');
      cy.focused().type(`${cmdKey}{shift}x`);
      cy.focused().type('Strikethrough');
      waitForReactUpdate(200);
      cy.get('s, del, strike, [style*="text-decoration: line-through"]').should('contain.text', 'Strikethrough');
    });

    it('should apply Code using shortcut', () => {
      cy.focused().type('Normal Code');
      waitForReactUpdate(200);
      cy.focused().type('{selectall}');
      waitForReactUpdate(500);
      
      // Use realPress for robust shortcut
      if (Cypress.platform === 'darwin') {
        cy.realPress(['Meta', 'e']);
      } else {
        cy.realPress(['Control', 'e']);
      }
      waitForReactUpdate(500);
      
      cy.get('span.bg-border-primary').should('contain.text', 'Code');
    });
  });

  describe('Toolbar Buttons', () => {
    it('should apply Bold via toolbar', () => {
      showToolbar('Bold Text');
      EditorSelectors.boldButton().click({ force: true });
      waitForReactUpdate(500);
      cy.get('strong').should('contain.text', 'Bold Text');
    });

    it('should apply Italic via toolbar', () => {
      showToolbar('Italic Text');
      EditorSelectors.italicButton().click({ force: true });
      waitForReactUpdate(500);
      cy.get('em').should('contain.text', 'Italic Text');
    });

    it('should apply Underline via toolbar', () => {
      showToolbar('Underline Text');
      EditorSelectors.underlineButton().click({ force: true });
      waitForReactUpdate(500);
      cy.get('u').should('contain.text', 'Underline Text');
    });

    it('should apply Strikethrough via toolbar', () => {
      showToolbar('Strike Text');
      EditorSelectors.strikethroughButton().click({ force: true });
      waitForReactUpdate(500);
      cy.get('s, del, strike, [style*="text-decoration: line-through"]').should('contain.text', 'Strike Text');
    });
  });
});
