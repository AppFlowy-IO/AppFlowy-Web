import { createTestPage, pasteContent } from '../../../support/paste-utils';
import { testLog } from '../../../support/test-helpers';

describe('Paste Code Block Tests', () => {
  it('should paste all code block formats correctly', () => {
    createTestPage();

    // HTML Code Blocks
    {
      const html = '<pre><code>const x = 10;\nconsole.log(x);</code></pre>';
      const plainText = 'const x = 10;\nconsole.log(x);';

      testLog.info('=== Pasting HTML Code Block ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      // CodeBlock component structure: .relative.w-full > pre > code
      cy.get('[contenteditable="true"]').find('pre').find('code').should('contain', 'const x = 10');
      testLog.info('✓ HTML code block pasted successfully');
    }

    {
      const html = '<pre><code class="language-javascript">function hello() {\n  console.log("Hello");\n}</code></pre>';
      const plainText = 'function hello() {\n  console.log("Hello");\n}';

      testLog.info('=== Pasting HTML Code Block with Language ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      cy.get('[contenteditable="true"]').find('pre').find('code').should('contain', 'function hello');
      testLog.info('✓ HTML code block with language pasted successfully');
    }

    {
      const html = `
        <pre><code class="language-python">def greet():
    print("Hello")</code></pre>
        <pre><code class="language-typescript">const greeting: string = "Hello";</code></pre>
      `;
      const plainText = 'def greet():\n    print("Hello")\nconst greeting: string = "Hello";';

      testLog.info('=== Pasting HTML Multiple Language Code Blocks ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      cy.get('[contenteditable="true"]').find('pre').find('code').should('contain', 'def greet');
      cy.get('[contenteditable="true"]').find('pre').find('code').should('contain', 'const greeting');
      testLog.info('✓ HTML multiple language code blocks pasted successfully');
    }

    {
      const html = '<blockquote>This is a quoted text</blockquote>';
      const plainText = 'This is a quoted text';

      testLog.info('=== Pasting HTML Blockquote ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      // AppFlowy renders blockquote as div with data-block-type="quote"
      cy.get('[contenteditable="true"]').find('[data-block-type="quote"]').should('contain', 'This is a quoted text');
      testLog.info('✓ HTML blockquote pasted successfully');
    }

    {
      const html = `
        <blockquote>
          First level quote
          <blockquote>Second level quote</blockquote>
        </blockquote>
      `;
      const plainText = 'First level quote\nSecond level quote';

      testLog.info('=== Pasting HTML Nested Blockquotes ===');
      pasteContent(html, plainText);

      cy.wait(1000);

      cy.get('[contenteditable="true"]').find('[data-block-type="quote"]').should('contain', 'First level quote');
      cy.get('[contenteditable="true"]').find('[data-block-type="quote"]').should('contain', 'Second level quote');
      testLog.info('✓ HTML nested blockquotes pasted successfully');
    }

    // Markdown Code Blocks
    {
      const markdown = `\`\`\`javascript
const x = 10;
console.log(x);
\`\`\``;

      testLog.info('=== Pasting Markdown Code Block with Language ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[contenteditable="true"]').find('pre').find('code').should('contain', 'const x = 10');
      testLog.info('✓ Markdown code block with language pasted successfully');
    }

    {
      const markdown = `\`\`\`
function hello() {
  console.log("Hello");
}
\`\`\``;

      testLog.info('=== Pasting Markdown Code Block without Language ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[contenteditable="true"]').find('pre').find('code').should('contain', 'function hello');
      testLog.info('✓ Markdown code block without language pasted successfully');
    }

    {
      const markdown = 'Use the `console.log()` function to print output.';

      testLog.info('=== Pasting Markdown Inline Code ===');
      pasteContent('', markdown);

      cy.wait(1000);

      // Inline code is usually a span with specific style
      cy.get('[contenteditable="true"]').find('span.bg-border-primary').should('contain', 'console.log');
      testLog.info('✓ Markdown inline code pasted successfully');
    }

    {
      const markdown = `\`\`\`python
def greet():
    print("Hello")
\`\`\`

\`\`\`typescript
const greeting: string = "Hello";
\`\`\`

\`\`\`bash
echo "Hello World"
\`\`\``;

      testLog.info('=== Pasting Markdown Multiple Language Code Blocks ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[contenteditable="true"]').find('pre').find('code').should('contain', 'def greet');
      cy.get('[contenteditable="true"]').find('pre').find('code').should('contain', 'const greeting');
      cy.get('[contenteditable="true"]').find('pre').find('code').should('contain', 'echo');
      testLog.info('✓ Markdown multiple language code blocks pasted successfully');
    }

    {
      const markdown = '> This is a quoted text';

      testLog.info('=== Pasting Markdown Blockquote ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[contenteditable="true"]').find('[data-block-type="quote"]').should('contain', 'This is a quoted text');
      testLog.info('✓ Markdown blockquote pasted successfully');
    }

    {
      const markdown = `> First level quote
>> Second level quote
>>> Third level quote`;

      testLog.info('=== Pasting Markdown Nested Blockquotes ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[contenteditable="true"]').find('[data-block-type="quote"]').should('contain', 'First level quote');
      cy.get('[contenteditable="true"]').find('[data-block-type="quote"]').should('contain', 'Second level quote');
      cy.get('[contenteditable="true"]').find('[data-block-type="quote"]').should('contain', 'Third level quote');
      testLog.info('✓ Markdown nested blockquotes pasted successfully');
    }

    {
      const markdown = '> **Important:** This is a *quoted* text with `code`';

      testLog.info('=== Pasting Markdown Blockquote with Formatting ===');
      pasteContent('', markdown);

      cy.wait(1000);

      cy.get('[contenteditable="true"]').find('[data-block-type="quote"]').find('strong').should('contain', 'Important');
      cy.get('[contenteditable="true"]').find('[data-block-type="quote"]').find('em').should('contain', 'quoted');
      cy.get('[contenteditable="true"]').find('[data-block-type="quote"]').find('span.bg-border-primary').should('contain', 'code');
      testLog.info('✓ Markdown blockquote with formatting pasted successfully');
    }
  });
});

