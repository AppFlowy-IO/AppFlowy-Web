import { createTestPage, pasteContent } from '../../../support/paste-utils';
import { EditorSelectors, waitForReactUpdate } from '../../../support/selectors';
import { testLog } from '../../../support/test-helpers';

describe('Paste Formatting Tests', { testIsolation: false }, () => {
  before(() => {
    createTestPage();
  });

  beforeEach(() => {
    // Clear editor content before each test to ensure a clean state
    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(500);
  });

  it('should paste HTML inline formatting (Bold, Italic, Underline, Strikethrough)', () => {
    testLog.info('=== Pasting HTML Bold Text ===');
    pasteContent('<p>This is <strong>bold</strong> text</p>', 'This is bold text');
    cy.wait(500);
    EditorSelectors.slateEditor().find('strong').should('contain', 'bold');
    testLog.info('✓ HTML bold text pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting HTML Italic Text ===');
    pasteContent('<p>This is <em>italic</em> text</p>', 'This is italic text');
    cy.wait(500);
    EditorSelectors.slateEditor().find('em').should('contain', 'italic');
    testLog.info('✓ HTML italic text pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting HTML Underlined Text ===');
    pasteContent('<p>This is <u>underlined</u> text</p>', 'This is underlined text');
    cy.wait(500);
    EditorSelectors.slateEditor().find('u').should('contain', 'underlined');
    testLog.info('✓ HTML underlined text pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting HTML Strikethrough Text ===');
    pasteContent('<p>This is <s>strikethrough</s> text</p>', 'This is strikethrough text');
    cy.wait(500);
    EditorSelectors.slateEditor().find('s').should('contain', 'strikethrough');
    testLog.info('✓ HTML strikethrough text pasted successfully');
  });

  it('should paste HTML special formatting (Code, Link, Mixed, Nested)', () => {
    testLog.info('=== Pasting HTML Inline Code ===');
    pasteContent('<p>Use the <code>console.log()</code> function</p>', 'Use the console.log() function');
    cy.wait(500);
    EditorSelectors.slateEditor().find('span.bg-border-primary').should('contain', 'console.log()');
    testLog.info('✓ HTML inline code pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting HTML Mixed Formatting ===');
    pasteContent('<p>Text with <strong>bold</strong>, <em>italic</em>, and <u>underline</u></p>', 'Text with bold, italic, and underline');
    cy.wait(500);
    EditorSelectors.slateEditor().find('strong').should('contain', 'bold');
    EditorSelectors.slateEditor().find('em').should('contain', 'italic');
    EditorSelectors.slateEditor().find('u').should('contain', 'underline');
    testLog.info('✓ HTML mixed formatting pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting HTML Link ===');
    pasteContent('<p>Visit <a href="https://appflowy.io">AppFlowy</a> website</p>', 'Visit AppFlowy website');
    cy.wait(500);
    EditorSelectors.slateEditor().find('span.cursor-pointer.underline').should('contain', 'AppFlowy');
    testLog.info('✓ HTML link pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting HTML Nested Formatting ===');
    pasteContent('<p>Text with <strong>bold and <em>italic</em> nested</strong></p>', 'Text with bold and italic nested');
    cy.wait(500);
    EditorSelectors.slateEditor().find('strong').should('contain', 'bold and');
    EditorSelectors.slateEditor().find('strong').find('em').should('contain', 'italic');
    testLog.info('✓ HTML nested formatting pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting HTML Complex Nested Formatting ===');
    pasteContent('<p><strong><em><u>Bold, italic, and underlined</u></em></strong> text</p>', 'Bold, italic, and underlined text');
    cy.wait(500);
    EditorSelectors.slateEditor()
      .find('strong')
      .find('em')
      .find('u')
      .should('contain', 'Bold, italic, and underlined');
    testLog.info('✓ HTML complex nested formatting pasted successfully');
  });

  it('should paste Markdown inline formatting (Bold, Italic, Strikethrough, Code)', () => {
    testLog.info('=== Pasting Markdown Bold Text (asterisk) ===');
    pasteContent('', 'This is **bold** text');
    cy.wait(500);
    EditorSelectors.slateEditor().find('strong').should('contain', 'bold');
    testLog.info('✓ Markdown bold text (asterisk) pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting Markdown Bold Text (underscore) ===');
    pasteContent('', 'This is __bold__ text');
    cy.wait(500);
    EditorSelectors.slateEditor().find('strong').should('contain', 'bold');
    testLog.info('✓ Markdown bold text (underscore) pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting Markdown Italic Text (asterisk) ===');
    pasteContent('', 'This is *italic* text');
    cy.wait(500);
    EditorSelectors.slateEditor().find('em').should('contain', 'italic');
    testLog.info('✓ Markdown italic text (asterisk) pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting Markdown Italic Text (underscore) ===');
    pasteContent('', 'This is _italic_ text');
    cy.wait(500);
    EditorSelectors.slateEditor().find('em').should('contain', 'italic');
    testLog.info('✓ Markdown italic text (underscore) pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting Markdown Strikethrough Text ===');
    pasteContent('', 'This is ~~strikethrough~~ text');
    cy.wait(500);
    EditorSelectors.slateEditor().find('s').should('contain', 'strikethrough');
    testLog.info('✓ Markdown strikethrough text pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting Markdown Inline Code ===');
    pasteContent('', 'Use the `console.log()` function');
    cy.wait(500);
    EditorSelectors.slateEditor().find('span.bg-border-primary').should('contain', 'console.log()');
    testLog.info('✓ Markdown inline code pasted successfully');
  });

  it('should paste Markdown complex/mixed formatting (Mixed, Link, Nested)', () => {
    testLog.info('=== Pasting Markdown Mixed Formatting ===');
    pasteContent('', 'Text with **bold**, *italic*, ~~strikethrough~~, and `code`');
    cy.wait(500);
    EditorSelectors.slateEditor().find('strong').should('contain', 'bold');
    EditorSelectors.slateEditor().find('em').should('contain', 'italic');
    EditorSelectors.slateEditor().find('s').should('contain', 'strikethrough');
    EditorSelectors.slateEditor().find('span.bg-border-primary').should('contain', 'code');
    testLog.info('✓ Markdown mixed formatting pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting Markdown Link ===');
    pasteContent('', 'Visit [AppFlowy](https://appflowy.io) website');
    cy.wait(500);
    EditorSelectors.slateEditor().find('span.cursor-pointer.underline').should('contain', 'AppFlowy');
    testLog.info('✓ Markdown link pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting Markdown Nested Formatting ===');
    pasteContent('', 'Text with **bold and *italic* nested**');
    cy.wait(500);
    EditorSelectors.slateEditor().find('strong').should('contain', 'bold and');
    EditorSelectors.slateEditor().find('strong').find('em').should('contain', 'italic');
    testLog.info('✓ Markdown nested formatting pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting Markdown Complex Nested Formatting ===');
    pasteContent('', '***Bold and italic*** text');
    cy.wait(500);
    // In Markdown, ***text*** is usually bold AND italic.
    EditorSelectors.slateEditor().find('strong').find('em').should('contain', 'Bold and italic');
    testLog.info('✓ Markdown complex nested formatting pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting Markdown Link with Formatting ===');
    pasteContent('', 'Visit [**AppFlowy** website](https://appflowy.io) for more');
    cy.wait(500);
    EditorSelectors.slateEditor().find('span.cursor-pointer.underline').find('strong').should('contain', 'AppFlowy');
    testLog.info('✓ Markdown link with formatting pasted successfully');

    EditorSelectors.slateEditor().click().type('{selectall}{backspace}');
    waitForReactUpdate(200);

    testLog.info('=== Pasting Markdown Multiple Inline Code ===');
    pasteContent('', 'Compare `const` vs `let` vs `var` in JavaScript');
    cy.wait(500);
    EditorSelectors.slateEditor().find('span.bg-border-primary').should('have.length.at.least', 3);
    EditorSelectors.slateEditor().find('span.bg-border-primary').should('contain', 'const');
    EditorSelectors.slateEditor().find('span.bg-border-primary').should('contain', 'let');
    EditorSelectors.slateEditor().find('span.bg-border-primary').should('contain', 'var');
    testLog.info('✓ Markdown multiple inline code pasted successfully');
  });
});