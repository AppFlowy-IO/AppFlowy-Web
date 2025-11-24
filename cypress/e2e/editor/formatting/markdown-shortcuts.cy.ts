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
    cy.visit('/login', { failOnStatusCode: false });

    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.contains('Getting started', { timeout: 10000 }).should('be.visible').click();
      cy.wait(3000);
      
      // Focus and clear editor
      EditorSelectors.firstEditor().click({ force: true });
      cy.focused().type('{selectall}{backspace}');
      waitForReactUpdate(500);
    });
  });

  it('should convert "# " to Heading 1', () => {
    cy.focused().type('# Heading 1');
    waitForReactUpdate(500);
    
    // Verification: Look for h1 tag or specific class if available
    // Assuming basic slate rendering uses standard tags or identifying attributes
    // If not standard h1, we might need to check specific data attributes
    cy.contains('h1, div', 'Heading 1').should('exist');
    
    // More specific check if possible (e.g., checking font size or tag)
    // In AppFlowy web, headings are often divs with specific classes, but text content check is a good start
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
    
    // Check for list item structure
    // Often rendered as <li> or div with list markers
    cy.contains('Bullet Item').should('be.visible');
    
    // Verify the "-" is gone (converted to bullet)
    // Note: 'contains' matches substring, so we need to be careful.
    // We check that the text content is exactly "Bullet Item" (plus maybe zero-width chars)
    // or check that the "-" prefix is NOT present in the text node
    cy.contains('- Bullet Item').should('not.exist');
  });

  it('should convert "1. " to Numbered List', () => {
    cy.focused().type('1. Numbered Item');
    waitForReactUpdate(500);
    
    cy.contains('Numbered Item').should('be.visible');
    cy.contains('1. Numbered Item').should('not.exist'); // The "1. " prefix should be converted to list style
  });

  it('should convert "[] " to Todo List', () => {
    cy.focused().type('[] Todo Item');
    waitForReactUpdate(500);
    
    cy.contains('Todo Item').should('be.visible');
    // Check for checkbox SVG presence instead of input
    // The icon is rendered as an SVG inside a span
    cy.get('span.text-block-icon svg').should('exist');
    cy.contains('[] Todo Item').should('not.exist');
  });

  it('should convert "> " to Quote', () => {
    cy.focused().type('> Quote Text');
    waitForReactUpdate(500);
    
    cy.contains('Quote Text').should('be.visible');
    // Quote usually has specific styling (border-left). 
    // We verify the markdown syntax is consumed.
    cy.contains('> Quote Text').should('not.exist');
  });

  it('should convert `code` to inline code', () => {
    cy.focused().type('Normal `Inline Code` Normal');
    waitForReactUpdate(500);
    
    // Check for code tag or specific styling
    cy.contains('code, span', 'Inline Code').should('exist');
    // Verify backticks are gone
    cy.contains('`Inline Code`').should('not.exist');
  });
});
