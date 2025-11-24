import { AuthTestUtils } from '../../../support/auth-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { generateRandomEmail, getCmdKey, getWordJumpKey } from '../../../support/test-config';

describe('Basic Text Editing', () => {
  const authUtils = new AuthTestUtils();
  const testEmail = generateRandomEmail();
  const cmdKey = getCmdKey();
  const wordJumpKey = getWordJumpKey();

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

  describe('Deletion', () => {
    it('should delete character forward using Delete key', () => {
      cy.focused().type('Test Text');
      waitForReactUpdate(200);
      // "Test Text" -> index 9
      // Left 4 -> index 5: "Test |Text"
      cy.focused().type('{leftArrow}{leftArrow}{leftArrow}{leftArrow}');
      waitForReactUpdate(200);
      cy.focused().type('{del}');
      waitForReactUpdate(200);
      // "Test |ext"
      cy.contains('Test ext').should('be.visible');
    });

    it('should delete word backward', () => {
      cy.focused().type('Hello World Test');
      waitForReactUpdate(200);
      // Use platform specific key for word deletion
      // Mac: Option+Backspace, Win: Ctrl+Backspace
      cy.focused().type(`${wordJumpKey}{backspace}`);
      waitForReactUpdate(200);
      cy.contains('Hello World').should('be.visible');
      cy.contains('Test').should('not.exist');
    });

    it('should delete word forward', () => {
      cy.focused().type('Hello World Test');
      waitForReactUpdate(200);
      
      // Move to start of "World"
      // "Hello |World Test"
      // Navigate to start then move right
      cy.focused().type('{home}'); 
      // "Hello " is 6 chars.
      cy.focused().type('{rightArrow}{rightArrow}{rightArrow}{rightArrow}{rightArrow}{rightArrow}'); 
      waitForReactUpdate(200);
      
      // Delete "World" forward
      // Mac: Option+Delete (Fn+Option+Backspace), Win: Ctrl+Delete
      cy.focused().type(`${wordJumpKey}{del}`);
      waitForReactUpdate(200);
      
      cy.contains('Hello').should('be.visible');
      cy.contains('Test').should('be.visible');
      cy.contains('World').should('not.exist');
    });
  });

  describe('Selection and Deletion', () => {
    it('should select all and delete multiple blocks', () => {
      cy.focused().type('Block 1{enter}Block 2{enter}Block 3');
      waitForReactUpdate(500);
      cy.focused().type('{selectall}');
      waitForReactUpdate(200);
      cy.focused().type('{backspace}');
      waitForReactUpdate(200);
      cy.contains('Block 1').should('not.exist');
      cy.contains('Block 2').should('not.exist');
      cy.contains('Block 3').should('not.exist');
    });

    it('should replace selection with typed text', () => {
      cy.focused().type('Hello World');
      cy.focused().type('{shift}{leftArrow}{leftArrow}{leftArrow}{leftArrow}{leftArrow}');
      cy.focused().type('AppFlowy');
      cy.contains('Hello AppFlowy').should('be.visible');
      cy.contains('Hello World').should('not.exist');
    });

    it('should delete selected text within a block', () => {
      cy.focused().type('Hello World');
      waitForReactUpdate(500);
      cy.focused().type('{shift}{leftArrow}{leftArrow}{leftArrow}{leftArrow}{leftArrow}');
      waitForReactUpdate(200);
      cy.focused().type('{backspace}');
      waitForReactUpdate(500);
      cy.contains('Hello').should('be.visible');
      cy.contains('World').should('not.exist');
    });
  });

  describe('Document Structure', () => {
    it('should handle text with headings', () => {
      cy.focused().type('Document Title');
      cy.wait(500);
      cy.focused().type('{enter}');
      cy.wait(500);
      cy.focused().type('/heading', { delay: 100 });
      cy.wait(1000);

      cy.get('body').then($body => {
        if ($body.text().includes('Heading 1')) {
          cy.contains('Heading 1').first().click();
          cy.wait(500);
          cy.focused().type('Main Heading', { delay: 50 });
        } else {
          cy.focused().type('{esc}');
          cy.wait(500);
          cy.focused().type('Main Heading', { delay: 50 });
        }
      });

      cy.wait(500);
      cy.focused().type('{enter}');
      cy.wait(500);
      cy.focused().type('Some content text', { delay: 50 });
      cy.wait(1000);

      EditorSelectors.slateEditor().should('contain.text', 'Document Title');
      EditorSelectors.slateEditor().should('contain.text', 'Main Heading');
      EditorSelectors.slateEditor().should('contain.text', 'Some content text');
    });

    it('should handle lists', () => {
      cy.focused().type('Shopping List');
      cy.wait(500);
      cy.focused().type('{enter}');
      cy.wait(500);
      cy.focused().type('/bullet', { delay: 100 });
      cy.wait(1000);

      cy.get('body').then($body => {
        if ($body.text().includes('Bulleted list')) {
          cy.contains('Bulleted list').first().click();
          cy.wait(500);
          cy.focused().type('Apples');
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('Bananas');
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('Oranges');
        } else {
          cy.focused().type('{esc}');
          cy.wait(500);
          cy.focused().type('- Apples');
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('- Bananas');
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('- Oranges');
        }
      });

      cy.wait(1000);
      EditorSelectors.slateEditor().should('contain.text', 'Shopping List');
      EditorSelectors.slateEditor().should('contain.text', 'Apples');
      EditorSelectors.slateEditor().should('contain.text', 'Bananas');
      EditorSelectors.slateEditor().should('contain.text', 'Oranges');
    });
  });
});
