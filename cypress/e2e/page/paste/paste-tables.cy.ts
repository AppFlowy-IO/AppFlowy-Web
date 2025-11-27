import { createTestPage, pasteContent } from '../../../support/paste-utils';
import { EditorSelectors } from '../../../support/selectors';
import { testLog } from '../../../support/test-helpers';

describe('Paste Table Tests', () => {
  it('should paste all table formats correctly', () => {
    createTestPage();

    // HTML Table
    {
      const html = `
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>John</td>
              <td>30</td>
            </tr>
            <tr>
              <td>Jane</td>
              <td>25</td>
            </tr>
          </tbody>
        </table>
      `;
      const plainText = 'Name\tAge\nJohn\t30\nJane\t25';

      testLog.info('=== Pasting HTML Table ===');
      pasteContent(html, plainText);

      cy.wait(1500);

      // AppFlowy uses SimpleTable which renders as a table within a specific container
      EditorSelectors.slateEditor().find('.simple-table').find('table').should('exist');
      EditorSelectors.slateEditor().find('.simple-table').find('tr').should('have.length.at.least', 3);
      EditorSelectors.slateEditor().find('.simple-table').contains('Name');
      EditorSelectors.slateEditor().find('.simple-table').contains('John');
      testLog.info('✓ HTML table pasted successfully');
    }

    {
      const html = `
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Authentication</strong></td>
              <td><em>Complete</em></td>
            </tr>
            <tr>
              <td><strong>Authorization</strong></td>
              <td><em>In Progress</em></td>
            </tr>
          </tbody>
        </table>
      `;
      const plainText = 'Feature\tStatus\nAuthentication\tComplete\nAuthorization\tIn Progress';

      testLog.info('=== Pasting HTML Table with Formatting ===');
      pasteContent(html, plainText);

      cy.wait(1500);

      EditorSelectors.slateEditor().find('.simple-table').find('strong').should('contain', 'Authentication');
      EditorSelectors.slateEditor().find('.simple-table').find('em').should('contain', 'Complete');
      testLog.info('✓ HTML table with formatting pasted successfully');
    }

    // Markdown Tables
    {
      const markdownTable = `| Product | Price |
|---------|-------|
| Apple   | $1.50 |
| Banana  | $0.75 |
| Orange  | $2.00 |`;

      testLog.info('=== Pasting Markdown Table ===');
      pasteContent('', markdownTable);

      cy.wait(1500);

      EditorSelectors.slateEditor().find('.simple-table').should('contain', 'Product');
      EditorSelectors.slateEditor().find('.simple-table').should('contain', 'Apple');
      EditorSelectors.slateEditor().find('.simple-table').should('contain', 'Banana');
      testLog.info('✓ Markdown table pasted successfully');
    }

    {
      const markdownTable = `| Left Align | Center Align | Right Align |
|:-----------|:------------:|------------:|
| Left       | Center       | Right       |
| Data       | More         | Info        |`;

      testLog.info('=== Pasting Markdown Table with Alignment ===');
      pasteContent('', markdownTable);

      cy.wait(1500);

      EditorSelectors.slateEditor().find('.simple-table').should('contain', 'Left Align');
      EditorSelectors.slateEditor().find('.simple-table').should('contain', 'Center Align');
      testLog.info('✓ Markdown table with alignment pasted successfully');
    }

    {
      const markdownTable = `| Feature | Status |
|---------|--------|
| **Bold Feature** | *In Progress* |
| \`Code Feature\` | ~~Deprecated~~ |`;

      testLog.info('=== Pasting Markdown Table with Inline Formatting ===');
      pasteContent('', markdownTable);

      cy.wait(1500);

      EditorSelectors.slateEditor().find('.simple-table').find('strong').should('contain', 'Bold Feature');
      EditorSelectors.slateEditor().find('.simple-table').find('em').should('contain', 'In Progress');
      testLog.info('✓ Markdown table with inline formatting pasted successfully');
    }

    // TSV Data
    {
      const tsvData = `Name\tEmail\tPhone
Alice\talice@example.com\t555-1234
Bob\tbob@example.com\t555-5678`;

      testLog.info('=== Pasting TSV Data ===');
      pasteContent('', tsvData);

      cy.wait(1500);

      // TSV might be pasted as a table or plain text depending on implementation
      // Assuming table based on previous tests
      EditorSelectors.slateEditor().find('.simple-table').should('exist');
      EditorSelectors.slateEditor().find('.simple-table').should('contain', 'Alice');
      EditorSelectors.slateEditor().find('.simple-table').should('contain', 'alice@example.com');
      testLog.info('✓ TSV data pasted successfully');
    }
  });
});

