import { FromBlockJSON } from 'cypress/support/document';

import { BlockType } from '@/application/types';
import { initialEditorTest } from '@/components/editor/__tests__/mount';

const formula = 'E = mc^2';

const initialData: FromBlockJSON[] = [
  {
    type: BlockType.EquationBlock,
    data: { formula },
    text: [{ insert: formula }],
    children: [],
  },
];

const { initializeEditor } = initialEditorTest();

describe('MathEquation block', () => {
  beforeEach(() => {
    cy.viewport(1280, 720);
    Object.defineProperty(window.navigator, 'language', { value: 'en-US' });
    initializeEditor(initialData);
    cy.wait(500);
  });

  it('should render the KaTeX formula', () => {
    cy.get('[data-block-type="math_equation"]')
      .find('[data-testid="react-katex"]')
      .should('exist');
  });

  it('should not display the raw formula text visibly', () => {
    cy.get('[data-block-type="math_equation"]')
      .find('.absolute.caret-transparent')
      .should('have.class', 'text-transparent');
  });

  it('should not show duplicate content (raw text overlapping rendered formula)', () => {
    cy.get('[data-block-type="math_equation"]').within(() => {
      // The absolute div holding raw Slate text should be text-transparent
      cy.get('.absolute.caret-transparent').then(($el) => {
        const color = window.getComputedStyle($el[0]).color;

        // text-transparent sets color to rgba(0,0,0,0)
        expect(color).to.equal('rgba(0, 0, 0, 0)');
      });
    });
  });
});
