import { createTestPage, pasteContent } from '../../../support/paste-utils';
import { EditorSelectors } from '../../../support/selectors';
import { testLog } from '../../../support/test-helpers';

describe('Paste Heading Tests', () => {
  it('should paste all heading formats correctly', () => {
    createTestPage();

    // HTML Headings
    {
      const html = '<h1>Main Heading</h1>';
      const plainText = 'Main Heading';

      testLog.info('=== Pasting HTML H1 ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      // AppFlowy renders H1 as div.heading.level-1
      EditorSelectors.slateEditor().find('.heading.level-1').should('contain', 'Main Heading');
      testLog.info('✓ HTML H1 pasted successfully');

      // Add a new line to separate content, targeting the last editor or focused editor
      cy.focused().type('{enter}');
    }

    {
      const html = '<h2>Section Title</h2>';
      const plainText = 'Section Title';

      testLog.info('=== Pasting HTML H2 ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      EditorSelectors.slateEditor().find('.heading.level-2').should('contain', 'Section Title');
      testLog.info('✓ HTML H2 pasted successfully');

      // Add a new line to separate content
      cy.focused().type('{enter}');
    }

    {
      const html = `
        <h1>Main Title</h1>
        <h2>Subtitle</h2>
        <h3>Section</h3>
      `;
      const plainText = 'Main Title\nSubtitle\nSection';

      testLog.info('=== Pasting HTML Multiple Headings ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      EditorSelectors.slateEditor().find('.heading.level-1').should('contain', 'Main Title');
      EditorSelectors.slateEditor().find('.heading.level-2').should('contain', 'Subtitle');
      EditorSelectors.slateEditor().find('.heading.level-3').should('contain', 'Section');
      testLog.info('✓ HTML multiple headings pasted successfully');

      // Add a new line to separate content
      cy.focused().type('{enter}');
    }

    // Markdown Headings
    {
      const markdown = '# Main Heading';

      testLog.info('=== Pasting Markdown H1 ===');
      pasteContent('', markdown);

      cy.wait(1000);

      EditorSelectors.slateEditor().find('.heading.level-1').should('contain', 'Main Heading');
      testLog.info('✓ Markdown H1 pasted successfully');

      // Add a new line to separate content
      cy.focused().type('{enter}');
    }

    {
      const markdown = '## Section Title';

      testLog.info('=== Pasting Markdown H2 ===');
      pasteContent('', markdown);

      cy.wait(1000);

      EditorSelectors.slateEditor().find('.heading.level-2').should('contain', 'Section Title');
      testLog.info('✓ Markdown H2 pasted successfully');

      // Add a new line to separate content
      cy.focused().type('{enter}');
    }

    {
      const markdown = `### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6`;

      testLog.info('=== Pasting Markdown H3-H6 ===');
      pasteContent('', markdown);

      cy.wait(1000);

      EditorSelectors.slateEditor().find('.heading.level-3').should('contain', 'Heading 3');
      EditorSelectors.slateEditor().find('.heading.level-4').should('contain', 'Heading 4');
      EditorSelectors.slateEditor().find('.heading.level-5').should('contain', 'Heading 5');
      EditorSelectors.slateEditor().find('.heading.level-6').should('contain', 'Heading 6');
      testLog.info('✓ Markdown H3-H6 pasted successfully');

      // Add a new line to separate content
      cy.focused().type('{enter}');
    }

    {
      const markdown = `# Heading with **bold** text
## Heading with *italic* text
### Heading with \`code\``;

      testLog.info('=== Pasting Markdown Headings with Formatting ===');
      pasteContent('', markdown);

      cy.wait(1000);

      EditorSelectors.slateEditor().find('.heading.level-1').should('contain', 'Heading with').find('strong').should('contain', 'bold');
      EditorSelectors.slateEditor().find('.heading.level-2').should('contain', 'Heading with').find('em').should('contain', 'italic');
      EditorSelectors.slateEditor().find('.heading.level-3').should('contain', 'Heading with').find('span.bg-border-primary').should('contain', 'code');
      testLog.info('✓ Markdown headings with formatting pasted successfully');
    }
  });
});
