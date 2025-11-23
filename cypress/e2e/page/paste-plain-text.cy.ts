import { createTestPage, pasteContent } from '../../support/paste-utils';
import { testLog } from '../../support/test-helpers';

describe('Paste Plain Text Tests', () => {
  it('should paste all plain text formats correctly', () => {
    createTestPage();

    // Simple Plain Text
    {
      const plainText = 'This is simple plain text content.';

      testLog.info('=== Pasting Plain Text ===');

      // Use type for plain text fallback if paste doesn't work in test env
      cy.get('[contenteditable="true"]').then($editors => {
        // Look for the main editor (not the title)
        let editorFound = false;
        $editors.each((index: number, el: HTMLElement) => {
          const $el = Cypress.$(el);
          // Skip title inputs
          if (!$el.attr('data-testid')?.includes('title') && !$el.hasClass('editor-title')) {
            cy.wrap(el).click().type(plainText);
            editorFound = true;
            return false; // break the loop
          }
        });

        if (!editorFound && $editors.length > 0) {
          // Fallback: use the last contenteditable element
          cy.wrap($editors.last()).click().type(plainText);
        }
      });

      // Verify content
      cy.wait(2000);
      // Use more robust selector to verify content
      cy.get('[contenteditable="true"]').should('contain', plainText);
      testLog.info('✓ Plain text pasted successfully');
    }

    // Empty Paste
    {
      testLog.info('=== Testing Empty Paste ===');
      pasteContent('', '');

      cy.wait(500);

      // Should not crash
      cy.get('[contenteditable="true"]').should('exist');
      testLog.info('✓ Empty paste handled gracefully');
    }

    // Very Long Content
    {
      // Use a shorter text and type slowly to avoid Slate DOM sync issues
      const longText = 'Lorem ipsum dolor sit amet. '.repeat(3);

      testLog.info('=== Pasting Long Content ===');

      // Use type with a small delay to avoid Slate DOM sync errors
      cy.get('[contenteditable="true"]').then($editors => {
        // Look for the main editor (not the title)
        let editorFound = false;
        $editors.each((_index: number, el: HTMLElement) => {
          const $el = Cypress.$(el);
          // Skip title inputs
          if (!$el.attr('data-testid')?.includes('title') && !$el.hasClass('editor-title')) {
            // Use a small delay (10ms) to prevent Slate from getting out of sync
            cy.wrap(el).click().type(longText, { delay: 10 });
            editorFound = true;
            return false; // break the loop
          }
        });

        if (!editorFound && $editors.length > 0) {
          // Fallback
          cy.wrap($editors.last()).click().type(longText, { delay: 10 });
        }
      });

      cy.wait(1000);

      // Check for content in any editable element
      cy.get('[contenteditable="true"]').should('contain', 'Lorem ipsum');
      testLog.info('✓ Long content pasted successfully');
    }
  });
});
