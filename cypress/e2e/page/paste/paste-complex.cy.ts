import { createTestPage, pasteContent, verifyEditorContent } from '../../../support/paste-utils';
import { BlockSelectors, EditorSelectors } from '../../../support/selectors';
import { testLog } from '../../../support/test-helpers';

describe('Paste Complex Content Tests', () => {
  it('should paste all complex document types correctly', () => {
    createTestPage();

    // Mixed Content Document
    {
      const html = `
        <h1>Project Documentation</h1>
        <p>This is an introduction with <strong>bold</strong> and <em>italic</em> text.</p>
        <h2>Features</h2>
        <ul>
          <li>Feature one</li>
          <li>Feature two</li>
          <li>Feature three</li>
        </ul>
        <h2>Code Example</h2>
        <pre><code class="language-javascript">console.log("Hello World");</code></pre>
        <blockquote>Remember to test your code!</blockquote>
        <p>For more information, visit <a href="https://example.com">our website</a>.</p>
      `;
      const plainText = 'Project Documentation\nThis is an introduction with bold and italic text.\nFeatures\nFeature one\nFeature two\nFeature three\nCode Example\nconsole.log("Hello World");\nRemember to test your code!\nFor more information, visit our website.';

      testLog.info('=== Pasting Complex Document ===');
      pasteContent(html, plainText);

      cy.wait(2000);

      // Verify structural elements
      EditorSelectors.slateEditor().contains('.heading.level-1', 'Project Documentation').scrollIntoView();
      EditorSelectors.slateEditor().find(BlockSelectors.blockSelector('bulleted_list')).should('have.length.at.least', 3);
      EditorSelectors.slateEditor().find('pre').find('code').should('contain', 'console.log');
      EditorSelectors.slateEditor().find(BlockSelectors.blockSelector('quote')).should('contain', 'Remember to test');
      EditorSelectors.slateEditor().find('span.cursor-pointer.underline').should('contain', 'our website');

      testLog.info('✓ Complex document pasted successfully');
    }

    // GitHub-style README
    {
      const html = `
        <h1>My Project</h1>
        <p>A description with <strong>important</strong> information.</p>
        <h2>Installation</h2>
        <pre><code class="language-bash">npm install my-package</code></pre>
        <h2>Usage</h2>
        <pre><code class="language-javascript">import { Something } from 'my-package';
  const result = Something.doThing();</code></pre>
        <h2>Features</h2>
        <ul>
          <li><input type="checkbox" checked> Feature 1</li>
          <li><input type="checkbox" checked> Feature 2</li>
          <li><input type="checkbox"> Planned feature</li>
        </ul>
        <p>Visit <a href="https://docs.example.com">documentation</a> for more info.</p>
      `;
      const plainText = 'My Project\nA description with important information.\nInstallation\nnpm install my-package\nUsage\nimport { Something } from \'my-package\';\nconst result = Something.doThing();\nFeatures\nFeature 1\nFeature 2\nPlanned feature\nVisit documentation for more info.';

      testLog.info('=== Pasting GitHub README ===');
      pasteContent(html, plainText);

      cy.wait(2000);

      EditorSelectors.slateEditor().contains('.heading.level-1', 'My Project').scrollIntoView();
      EditorSelectors.slateEditor().find('pre').find('code').should('contain', 'npm install');
      EditorSelectors.slateEditor().find(BlockSelectors.blockSelector('todo_list')).should('have.length.at.least', 3);
      EditorSelectors.slateEditor().find(BlockSelectors.blockSelector('todo_list')).filter(':has(.checked)').should('contain', 'Feature 1');

      testLog.info('✓ GitHub README pasted successfully');
    }

    // Markdown-like Plain Text
    {
      const plainText = `# Main Title

  This is a paragraph with **bold** and *italic* text.

  ## Section

  - List item 1
  - List item 2
  - List item 3

  \`\`\`javascript
  const x = 10;
  \`\`\`

  > A quote

  ---`;

      testLog.info('=== Pasting Markdown-like Text ===');
      pasteContent('', plainText);

      cy.wait(2000);

      // Verify content exists (markdown may or may not be parsed depending on implementation)
      EditorSelectors.slateEditor().contains('.heading.level-1', 'Main Title').scrollIntoView();
      EditorSelectors.slateEditor().find('strong').should('contain', 'bold');
      EditorSelectors.slateEditor().find(BlockSelectors.blockSelector('bulleted_list')).should('contain', 'List item 1');
      EditorSelectors.slateEditor().find('pre').find('code').should('contain', 'const x = 10');
      EditorSelectors.slateEditor().find(BlockSelectors.blockSelector('quote')).should('contain', 'A quote');

      testLog.info('✓ Markdown-like text pasted');
    }

    // DevTools Verification
    {
      const html = '<p>Test <strong>bold</strong> content</p>';
      const plainText = 'Test bold content';

      testLog.info('=== Pasting and Verifying with DevTools ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      // Use DevTools to verify content
      verifyEditorContent('bold');

      testLog.info('✓ DevTools verification passed');
    }

    // Complex Structure Verification
    {
      const html = `
        <h1>Title</h1>
        <p>Paragraph</p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      `;
      const plainText = 'Title\nParagraph\nItem 1\nItem 2';

      testLog.info('=== Verifying Complex Structure ===');
      pasteContent(html, plainText);

      cy.wait(1500);

      cy.get('body').then(() => {
        // Check that content is present
        EditorSelectors.slateEditor().contains('.heading.level-1', 'Title').scrollIntoView();
        EditorSelectors.slateEditor().find('div').contains('Paragraph').should('exist');
        EditorSelectors.slateEditor().find(BlockSelectors.blockSelector('bulleted_list')).should('contain', 'Item 1');

        testLog.info('✓ Complex structure verified');
      });
    }
  });
});
