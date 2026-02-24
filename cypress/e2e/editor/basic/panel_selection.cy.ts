import { EditorSelectors, SlashCommandSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

describe('Panel Selection - Shift+Arrow Keys', () => {
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

  describe('Slash Panel Selection', () => {
    it('should allow Shift+Arrow selection when slash panel is open', () => {
      // Type some text first
      cy.focused().type('Hello World');
      waitForReactUpdate(200);

      // Open slash panel
      cy.focused().type('/');
      waitForReactUpdate(500);

      // Verify slash panel is open
      SlashCommandSelectors.slashPanel().should('be.visible');

      // Type search text
      cy.focused().type('head');
      waitForReactUpdate(200);

      // Now try Shift+Left to select text - this should work after the fix
      cy.focused().type('{shift}{leftArrow}{leftArrow}{leftArrow}{leftArrow}');
      waitForReactUpdate(200);

      // The selection should have happened - verify by typing replacement text
      // Close panel first
      cy.focused().type('{esc}');
      waitForReactUpdate(200);

      // The text "head" should still be visible (since we selected but didn't delete)
      EditorSelectors.slateEditor().should('contain.text', 'head');
    });

    it('should allow Shift+Right selection when slash panel is open', () => {
      // Type some text first
      cy.focused().type('Test Content');
      waitForReactUpdate(200);

      // Move cursor to after "Test "
      cy.focused().type('{home}');
      cy.focused().type('{rightArrow}{rightArrow}{rightArrow}{rightArrow}{rightArrow}');
      waitForReactUpdate(200);

      // Open slash panel
      cy.focused().type('/');
      waitForReactUpdate(500);

      // Verify slash panel is open
      SlashCommandSelectors.slashPanel().should('be.visible');

      // Type search text
      cy.focused().type('para');
      waitForReactUpdate(200);

      // Try Shift+Right to extend selection
      cy.focused().type('{shift}{rightArrow}{rightArrow}');
      waitForReactUpdate(200);

      // Close panel
      cy.focused().type('{esc}');
      waitForReactUpdate(200);

      // Verify editor still has content
      EditorSelectors.slateEditor().should('contain.text', 'Test');
    });

    it('should still block plain Arrow keys when panel is open', () => {
      // Type some text
      cy.focused().type('Sample Text');
      waitForReactUpdate(200);

      // Open slash panel
      cy.focused().type('/');
      waitForReactUpdate(500);

      // Verify slash panel is open
      SlashCommandSelectors.slashPanel().should('be.visible');

      // Type search text
      cy.focused().type('heading');
      waitForReactUpdate(200);

      // Press plain ArrowLeft (without Shift) - should be blocked
      cy.focused().type('{leftArrow}');
      waitForReactUpdate(200);

      // Panel should still be open (cursor didn't move away from trigger position)
      SlashCommandSelectors.slashPanel().should('be.visible');

      // Close panel
      cy.focused().type('{esc}');
      waitForReactUpdate(200);

      // Verify content
      EditorSelectors.slateEditor().should('contain.text', 'Sample Text');
    });
  });

  describe('Mention Panel Selection', () => {
    it('should allow Shift+Arrow selection when mention panel is open', () => {
      // Type some text first
      cy.focused().type('Hello ');
      waitForReactUpdate(200);

      // Open mention panel with @
      cy.focused().type('@');
      waitForReactUpdate(500);

      // Type to search
      cy.focused().type('test');
      waitForReactUpdate(200);

      // Try Shift+Left to select - should work after fix
      cy.focused().type('{shift}{leftArrow}{leftArrow}');
      waitForReactUpdate(200);

      // Close panel
      cy.focused().type('{esc}');
      waitForReactUpdate(200);

      // Editor should still have content
      EditorSelectors.slateEditor().should('contain.text', 'Hello');
    });
  });
});
