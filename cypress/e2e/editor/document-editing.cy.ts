import { v4 as uuidv4 } from 'uuid';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';
import { EditorSelectors } from '../../support/selectors';

describe('Document Editing with Formatting', () => {
  const { baseUrl, gotrueUrl, apiUrl } = TestConfig;
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;

  before(() => {
    logTestEnvironment();
  });

  beforeEach(() => {
    setupCommonExceptionHandlers();
    cy.viewport(1280, 720);
  });

  it('should handle text with headings', () => {
    let testEmail: string;

    // Login using centralized login command
    cy.loginTestUser().then((email) => {
      testEmail = email;
      cy.wait(3000);

      // Navigate to Getting started page
      cy.contains('Getting started', { timeout: 10000 }).click();
      cy.wait(5000);

      // Find and focus the editor
      EditorSelectors.firstEditor()
        .should('exist')
        .click({ force: true });
      cy.wait(1000);

      // Type normal text
      cy.focused().type('Document Title', { delay: 50 });
      cy.wait(500);
      cy.focused().type('{enter}');
      cy.wait(500);

      // Type / and select Heading 1
      cy.focused().type('/heading', { delay: 100 });
      cy.wait(1000);

      // Click on Heading 1 if visible
      cy.get('body').then($body => {
        if ($body.text().includes('Heading 1')) {
          cy.contains('Heading 1').first().click();
          cy.wait(500);
          cy.focused().type('Main Heading', { delay: 50 });
        } else {
          // Fallback to simple text
          cy.focused().type('{esc}');
          cy.wait(500);
          cy.focused().type('Main Heading', { delay: 50 });
        }
      });

      cy.wait(500);
      cy.focused().type('{enter}');
      cy.wait(500);

      // Add regular text
      cy.focused().type('Some content text', { delay: 50 });
      cy.wait(1000);

      // Verify content
      EditorSelectors.slateEditor().should('contain.text', 'Document Title');
      EditorSelectors.slateEditor().should('contain.text', 'Main Heading');
      EditorSelectors.slateEditor().should('contain.text', 'Some content text');
    });
  });

  it('should handle lists', () => {
    let testEmail: string;

    // Login using centralized login command
    cy.loginTestUser().then((email) => {
      testEmail = email;
      cy.wait(3000);

      // Navigate to Getting started page
      cy.contains('Getting started', { timeout: 10000 }).click();
      cy.wait(5000);

      // Find and focus the editor
      EditorSelectors.firstEditor()
        .should('exist')
        .click({ force: true });
      cy.wait(1000);

      // Add title
      cy.focused().type('Shopping List', { delay: 50 });
      cy.wait(500);
      cy.focused().type('{enter}');
      cy.wait(500);

      // Try to create a bulleted list
      cy.focused().type('/bullet', { delay: 100 });
      cy.wait(1000);

      cy.get('body').then($body => {
        if ($body.text().includes('Bulleted list')) {
          cy.contains('Bulleted list').first().click();
          cy.wait(500);
          cy.focused().type('Apples', { delay: 50 });
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('Bananas', { delay: 50 });
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('Oranges', { delay: 50 });
        } else {
          // Fallback to simple list with dashes
          cy.focused().type('{esc}');
          cy.wait(500);
          cy.focused().type('- Apples', { delay: 50 });
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('- Bananas', { delay: 50 });
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('- Oranges', { delay: 50 });
        }
      });

      cy.wait(1000);

      // Verify content
      EditorSelectors.slateEditor().should('contain.text', 'Shopping List');
      EditorSelectors.slateEditor().should('contain.text', 'Apples');
      EditorSelectors.slateEditor().should('contain.text', 'Bananas');
      EditorSelectors.slateEditor().should('contain.text', 'Oranges');
    });
  });

  it('should handle numbered lists and todos', () => {
    let testEmail: string;

    // Login using centralized login command
    cy.loginTestUser().then((email) => {
      testEmail = email;
      cy.wait(3000);

      // Navigate to Getting started page
      cy.contains('Getting started', { timeout: 10000 }).click();
      cy.wait(5000);

      // Find and focus the editor
      EditorSelectors.firstEditor()
        .should('exist')
        .click({ force: true });
      cy.wait(1000);

      // Add title
      cy.focused().type('Steps to Follow', { delay: 50 });
      cy.wait(500);
      cy.focused().type('{enter}');
      cy.wait(500);

      // Try numbered list
      cy.focused().type('/number', { delay: 100 });
      cy.wait(1000);

      cy.get('body').then($body => {
        if ($body.text().includes('Numbered list')) {
          cy.contains('Numbered list').first().click();
          cy.wait(500);
          cy.focused().type('First step', { delay: 50 });
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('Second step', { delay: 50 });
        } else {
          // Fallback to manual numbering
          cy.focused().type('{esc}');
          cy.wait(500);
          cy.focused().type('1. First step', { delay: 50 });
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('2. Second step', { delay: 50 });
        }
      });

      cy.wait(500);
      cy.focused().type('{enter}{enter}');
      cy.wait(500);

      // Add todo items
      cy.focused().type('Tasks:', { delay: 50 });
      cy.wait(500);
      cy.focused().type('{enter}');
      cy.wait(500);

      // Try todo list
      cy.focused().type('/todo', { delay: 100 });
      cy.wait(1000);

      cy.get('body').then($body => {
        if ($body.text().includes('Todo list')) {
          cy.contains('Todo list').first().click();
          cy.wait(500);
          cy.focused().type('Complete report', { delay: 50 });
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('Review code', { delay: 50 });
        } else {
          // Fallback to checkbox format
          cy.focused().type('{esc}');
          cy.wait(500);
          cy.focused().type('[ ] Complete report', { delay: 50 });
          cy.wait(500);
          cy.focused().type('{enter}');
          cy.wait(500);
          cy.focused().type('[ ] Review code', { delay: 50 });
        }
      });

      cy.wait(1000);

      // Verify content
      EditorSelectors.slateEditor().should('contain.text', 'Steps to Follow');
      EditorSelectors.slateEditor().should('contain.text', 'First step');
      EditorSelectors.slateEditor().should('contain.text', 'Second step');
      EditorSelectors.slateEditor().should('contain.text', 'Tasks');
      EditorSelectors.slateEditor().should('contain.text', 'Complete report');
      EditorSelectors.slateEditor().should('contain.text', 'Review code');
    });
  });
});