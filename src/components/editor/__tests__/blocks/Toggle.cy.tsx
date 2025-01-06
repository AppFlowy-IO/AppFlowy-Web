import { BlockType } from '@/application/types';
import { getModKey, initialEditorTest, moveCursor } from '@/components/editor/__tests__/mount';
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

  it('should turn to toggle list block when typing > ', () => {
    moveCursor(0, 0);

    cy.get('@editor').type('> ');

    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: false,
        },
        text: [],
        children: [],
      },
    ]);

    cy.get('@editor').get('[data-testid="toggle-list-empty"]').as('toggleListEmpty');

    cy.get('@toggleListEmpty').should('exist');

    cy.get('@toggleListEmpty').realClick();
    cy.wait(200);
    cy.get('@editor').type('Hello, World!');
    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: false,
        },
        text: [],
        children: [{
          type: BlockType.Paragraph,
          data: {},
          text: [{
            insert: 'Hello, World!',
          }],
          children: [],
        }],
      },
    ]);
  });

  it('should add a child paragraph when pressing Enter', () => {
    moveCursor(0, 0);

    cy.get('@editor').type('> ');

    cy.get('@editor').type('Hello, World!');

    cy.get('@editor').realPress('Enter');

    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: false,
        },
        text: [{
          insert: 'Hello, World!',
        }],
        children: [{
          type: BlockType.Paragraph,
          data: {},
          text: [],
          children: [],
        }],
      },
    ]);
  });

  it('should toggle collapse when pressing Mod + Enter', () => {
    moveCursor(0, 0);

    cy.get('@editor').type('> Hello, World!');

    const mod = getModKey();

    cy.get('@editor').realPress([mod, 'Enter']);

    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: true,
        },
        text: [{
          insert: 'Hello, World!',
        }],
        children: [],
      },
    ]);

    cy.get('@editor').get('[data-testid="toggle-list-empty"]').should('not.exist');

    cy.get('@editor').realPress([mod, 'Enter']);

    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: false,
        },
        text: [{
          insert: 'Hello, World!',
        }],
        children: [],
      },
    ]);
  });

  it('should toggle collapse when clicking the toggle button', () => {
    moveCursor(0, 0);

    cy.get('@editor').type('> Hello, World!');

    cy.get('@editor').get('[data-testid="toggle-icon"]').as('toggleIcon');

    cy.get('@toggleIcon').should('exist');

    cy.get('@toggleIcon').realClick();

    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: true,
        },
        text: [{
          insert: 'Hello, World!',
        }],
        children: [],
      },
    ]);

    cy.get('@toggleIcon').realClick();

    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: false,
        },
        text: [{
          insert: 'Hello, World!',
        }],
        children: [],
      },
    ]);
  });

  it('should remove the toggle list block when pressing Backspace at the beginning', () => {
    moveCursor(0, 0);

    cy.get('@editor').type('> Hello, World!');

    moveCursor(0, 0);

    cy.get('@editor').realPress('Backspace');

    assertJSON([
      {
        type: BlockType.Paragraph,
        data: {},
        text: [{
          insert: 'Hello, World!',
        }],
        children: [],
      },
    ]);
  });

  it('should lift the child paragraph when pressing Backspace at the beginning', () => {
    moveCursor(0, 0);

    cy.get('@editor').type('> Hello, World!');
    cy.get('@editor').realPress('Enter');
    cy.get('@editor').type('Hello, World!');

    moveCursor(1, 0);

    cy.get('@editor').realPress('Backspace');

    assertJSON([
      {
        type: BlockType.ToggleListBlock,
        data: {
          collapsed: false,
        },
        text: [{
          insert: 'Hello, World!',
        }],
        children: [],
      },
      {
        type: BlockType.Paragraph,
        data: {},
        text: [{
          insert: 'Hello, World!',
        }],
        children: [],
      },
    ]);
    cy.get('@editor').get('[data-testid="toggle-list-empty"]').as('toggleListEmpty');

    cy.get('@toggleListEmpty').should('exist');
  });

});