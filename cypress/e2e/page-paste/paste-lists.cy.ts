import { createTestPage, pasteContent } from '../../../support/paste-utils';
import { testLog } from '../../../support/test-helpers';

describe('Paste List Tests', () => {
  it('should paste all list formats correctly', () => {
    createTestPage();

    // HTML Lists
    {
      const html = `
        <ul>
          <li>First item</li>
          <li>Second item</li>
          <li>Third item</li>
        </ul>
      `;
      const plainText = 'First item\nSecond item\nThird item';

      testLog.info('=== Pasting HTML Unordered List ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      // AppFlowy renders bulleted lists as div elements with data-block-type="bulleted_list"
      cy.get('[data-block-type="bulleted_list"]').should('have.length.at.least', 3);
      cy.contains('First item').should('exist');
      cy.contains('Second item').should('exist');
      cy.contains('Third item').should('exist');
      testLog.info('✓ HTML unordered list pasted successfully');

      // Exit list mode
      cy.get('[contenteditable="true"]').last().type('{enter}{enter}');
    }

    {
      const html = `
        <ol>
          <li>Step one</li>
          <li>Step two</li>
          <li>Step three</li>
        </ol>
      `;
      const plainText = 'Step one\nStep two\nStep three';

      testLog.info('=== Pasting HTML Ordered List ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      // AppFlowy renders numbered lists as div elements with data-block-type="numbered_list"
      cy.get('[data-block-type="numbered_list"]').should('have.length.at.least', 3);
      cy.contains('Step one').should('exist');
      cy.contains('Step two').should('exist');
      cy.contains('Step three').should('exist');
      testLog.info('✓ HTML ordered list pasted successfully');

      // Exit list mode
      cy.get('[contenteditable="true"]').last().type('{enter}{enter}');
    }

    {
      const html = `
        <ul>
          <li><input type="checkbox" checked> Completed task</li>
          <li><input type="checkbox"> Incomplete task</li>
        </ul>
      `;
      const plainText = 'Completed task\nIncomplete task';

      testLog.info('=== Pasting HTML Todo List ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      // AppFlowy renders todo lists as div elements with data-block-type="todo_list"
      // The checked state is rendered as a class on the inner div
      cy.get('[data-block-type="todo_list"]').should('have.length.at.least', 2);
      cy.contains('Completed task').should('exist');
      cy.contains('Incomplete task').should('exist');
      testLog.info('✓ HTML todo list pasted successfully');

      // Exit list mode
      cy.get('[contenteditable="true"]').last().type('{enter}{enter}');
    }

    // Markdown Lists
    {
      const markdown = `- First item
- Second item
- Third item`;

      testLog.info('=== Pasting Markdown Unordered List (dash) ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[data-block-type="bulleted_list"]').should('have.length.at.least', 3);
      cy.contains('First item').should('exist');
      testLog.info('✓ Markdown unordered list (dash) pasted successfully');

      // Exit list mode
      cy.get('[contenteditable="true"]').last().type('{enter}{enter}');
    }

    {
      const markdown = `* Apple
* Banana
* Orange`;

      testLog.info('=== Pasting Markdown Unordered List (asterisk) ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[data-block-type="bulleted_list"]').should('have.length.at.least', 3);
      cy.contains('Apple').should('exist');
      testLog.info('✓ Markdown unordered list (asterisk) pasted successfully');

      // Exit list mode
      cy.get('[contenteditable="true"]').last().type('{enter}{enter}');
    }

    {
      const markdown = `1. First step
2. Second step
3. Third step`;

      testLog.info('=== Pasting Markdown Ordered List ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[data-block-type="numbered_list"]').should('have.length.at.least', 3);
      cy.contains('First step').should('exist');
      testLog.info('✓ Markdown ordered list pasted successfully');

      // Exit list mode
      cy.get('[contenteditable="true"]').last().type('{enter}{enter}');
    }

    {
      const markdown = `- [x] Completed task
- [ ] Incomplete task
- [x] Another completed task`;

      testLog.info('=== Pasting Markdown Task List ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[data-block-type="todo_list"]').should('have.length.at.least', 3);
      cy.contains('Completed task').should('exist');
      cy.contains('Incomplete task').should('exist');
      testLog.info('✓ Markdown task list pasted successfully');

      // Exit list mode
      cy.get('[contenteditable="true"]').last().type('{enter}{enter}');
    }

    {
      const markdown = `- Parent item 1
  - Child item 1.1
  - Child item 1.2
- Parent item 2
  - Child item 2.1`;

      testLog.info('=== Pasting Markdown Nested Lists ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[data-block-type="bulleted_list"]').should('contain', 'Parent item 1');
      cy.get('[data-block-type="bulleted_list"]').should('contain', 'Child item 1.1');
      testLog.info('✓ Markdown nested lists pasted successfully');

      // Exit list mode
      cy.get('[contenteditable="true"]').last().type('{enter}{enter}');
    }

    {
      const markdown = `- **Bold item**
- *Italic item*
- \`Code item\`
- [Link item](https://example.com)`;

      testLog.info('=== Pasting Markdown List with Formatting ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.contains('Bold item').should('exist');
      cy.contains('Italic item').should('exist');
      cy.contains('Code item').should('exist');
      testLog.info('✓ Markdown list with formatting pasted successfully');

      // Exit list mode
      cy.get('[contenteditable="true"]').last().type('{enter}{enter}');
    }

    {
      const text = `🚀 Project Launch

We are excited to announce the new features. This update includes:
\t•\tFast performance
\t•\tSecure encryption
\t•\tOffline mode

Please let us know your feedback.`;

      testLog.info('=== Pasting Generic Text with Special Bullets ===');
      pasteContent('', text);

      cy.wait(1000);

      cy.contains('Project Launch').should('exist');
      cy.contains('We are excited to announce').should('exist');

      // Verify special bullets are converted to BulletedListBlock
      cy.get('[data-block-type="bulleted_list"]').should('contain', 'Fast performance');
      cy.get('[data-block-type="bulleted_list"]').should('contain', 'Secure encryption');
      cy.get('[data-block-type="bulleted_list"]').should('contain', 'Offline mode');

      testLog.info('✓ Generic text with special bullets pasted successfully');

      // Exit list mode
      cy.get('[contenteditable="true"]').last().type('{enter}{enter}');
    }

    {
      const html = `
        <ul><li>
        <p class="p1">Private</p>
        </li><li>
        <p class="p1">Customizable</p>
        </li><li>
        <p class="p1">Self-hostable</p>
        </li></ul>
      `;
      // The plain text fallback might be clean, but we want to test the HTML parsing path
      const plainText = 'Private\nCustomizable\nSelf-hostable';

      testLog.info('=== Pasting HTML List with Inner Newlines ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      // Check that "Private" does not have leading/trailing newlines in the text content
      // We can check this by ensuring it doesn't create extra blocks or lines
      cy.get('[data-block-type="bulleted_list"]').contains('Private').should('exist');
      cy.get('[data-block-type="bulleted_list"]').contains('Customizable').should('exist');
      cy.get('[data-block-type="bulleted_list"]').contains('Self-hostable').should('exist');

      testLog.info('✓ HTML list with inner newlines pasted successfully');
    }
  });
});

