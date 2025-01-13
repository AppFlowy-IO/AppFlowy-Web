import { BlockType } from '@/application/types';
import { initialEditorTest } from '@/components/editor/__tests__/mount';
import { FromBlockJSON } from 'cypress/support/document';

const initialData: FromBlockJSON[] = [{
  type: BlockType.CalloutBlock,
  data: {},
  text: [{ insert: 'Hello Callout' }],
  children: [],
}];

const { assertJSON, initializeEditor } = initialEditorTest();

describe('CalloutBlock', () => {
  beforeEach(() => {
    cy.viewport(1280, 720);
    Object.defineProperty(window.navigator, 'language', { value: 'en-US' });
    initializeEditor(initialData);
    const selector = '[role="textbox"]';

    cy.get(selector).as('editor');

    cy.wait(1000);

    cy.get(selector).focus();
  });

  it('should show callout icon popover when clicking icon button', () => {
    cy.get('@editor').get('[data-block-type="callout"]').as('callout');
    cy.get('@callout').find('[data-testid="callout-icon-button"]').click();
    cy.get('[data-testid="change-icon-popover"]').should('exist');
  });

  it('should display `📌` emoji as default icon', () => {
    cy.get('@editor').get('[data-block-type="callout"]').as('callout');
    cy.get('@callout').find('[data-testid="callout-icon-button"]').should('have.text', '📌');
  });

  it('should add child block when pressing enter', () => {
    cy.selectMultipleText(['Hello Callout']);
    cy.wait(100);

    cy.get('@editor').realPress('ArrowRight');
    cy.get('@editor').realPress('Enter');
    cy.get('@editor').type('Hello World');
    assertJSON([
      {
        type: BlockType.CalloutBlock,
        data: {},
        children: [{
          type: BlockType.Paragraph,
          data: {},
          children: [],
          text: [{ insert: 'Hello World' }],
        }],
        text: [{ insert: 'Hello Callout' }],
      },
    ]);
  });

  it('should turn to paragraph block when pressing backspace at the beginning of the block', () => {
    cy.selectMultipleText(['Hello Callout']);
    cy.wait(100);

    cy.get('@editor').realPress('ArrowLeft');

    cy.get('@editor').realPress('Backspace');
    assertJSON([
      {
        type: BlockType.Paragraph,
        data: {},
        children: [],
        text: [{ insert: 'Hello Callout' }],
      },
    ]);
  });
});