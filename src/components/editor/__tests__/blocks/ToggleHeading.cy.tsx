import { BlockType } from '@/application/types';
import { initialEditorTest, moveCursor } from '@/components/editor/__tests__/mount';
import { FromBlockJSON } from 'cypress/support/document';

const initialData: FromBlockJSON[] = [{
  type: 'paragraph',
  data: {},
  text: [{ insert: '' }],
  children: [],
}];

const { assertJSON, initializeEditor } = initialEditorTest();

describe('ToggleListBlock', () => {
  beforeEach(() => {
    cy.viewport(1280, 720);
    Object.defineProperty(window.navigator, 'language', { value: 'en-US' });
    initializeEditor(initialData);
    const selector = '[role="textbox"]';

    cy.get(selector).as('editor');

    cy.wait(1000);

    cy.get(selector).focus();
  });

  it('should turn to toggle heading block when typing > + # ', () => {
    moveCursor(0, 0);

    cy.get('@editor').type('> ');
    cy.get('@editor').type('# ');

    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: false,
          level: 1,
        },
        text: [],
        children: [],
      },
    ]);
  });

  it('should move next lines to be children of the toggle heading block when turning to toggle heading block with `# ` + `> `', () => {
    moveCursor(0, 0);

    cy.get('@editor').type('Hello, Toggle Heading!');
    cy.get('@editor').realPress('Enter');
    cy.get('@editor').type('Hello, Paragraph!');
    cy.get('@editor').realPress('Enter');
    cy.get('@editor').type('## ');
    cy.get('@editor').type('Hello, Heading2!');
    cy.get('@editor').realPress('Enter');
    cy.get('@editor').type('# ');
    cy.get('@editor').type('Hello, Heading1!');

    moveCursor(0, 0);

    cy.get('@editor').type('# ');
    cy.get('@editor').type('> ');

    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: false,
          level: 1,
        },
        text: [{ insert: 'Hello, Toggle Heading!' }],
        children: [
          {
            type: BlockType.Paragraph,
            data: {},
            text: [{ insert: 'Hello, Paragraph!' }],
            children: [],
          },
          {
            type: BlockType.HeadingBlock,
            data: {
              level: 2,
            },
            text: [{ insert: 'Hello, Heading2!' }],
            children: [],
          },
        ],
      },
      {
        type: BlockType.HeadingBlock,
        data: {
          level: 1,
        },
        text: [{ insert: 'Hello, Heading1!' }],
        children: [],
      },
    ]);

  });

  it('should remove level when pressing Backspace at the beginning', () => {
    moveCursor(0, 0);

    cy.get('@editor').type('> ');
    cy.get('@editor').type('# ');

    moveCursor(0, 0);

    cy.get('@editor').realPress('Backspace');

    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: false,
          level: null,
        },
        text: [],
        children: [],
      },
    ]);
  });

  it('should remove the toggle list block when pressing Backspace twice at the beginning', () => {
    moveCursor(0, 0);

    cy.get('@editor').type('> ');
    cy.get('@editor').type('# ');

    moveCursor(0, 0);

    cy.get('@editor').realPress('Backspace');
    cy.get('@editor').realPress('Backspace');

    assertJSON([
      {
        type: BlockType.Paragraph,
        data: {},
        text: [],
        children: [],
      },
    ]);
  });
});