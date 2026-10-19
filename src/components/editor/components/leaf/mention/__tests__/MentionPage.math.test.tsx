import { render, screen } from '@testing-library/react';
import { createEditor } from 'slate';

import { insertBlock, withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { BlockType, MentionType } from '@/application/types';
import { MathEquationNode } from '@/components/editor/editor.type';

import MentionPage from '../MentionPage';

const mockEditor = createEditor();
const mockLoadView = jest.fn();
const mockLoadViewMeta = jest.fn();
const mockT = (key: string) => key;

jest.mock('slate-react', () => ({ useSlate: () => mockEditor }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ viewId: 'current-page', loadView: mockLoadView, loadViewMeta: mockLoadViewMeta }),
}));
jest.mock('@/components/_shared/view-icon/PageIcon', () => () => <span data-testid='page-icon' />);
jest.mock('../style.css', () => ({}));

const formula = String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`;
const props = { pageId: 'current-page', blockId: 'equation', text: { text: '@' }, type: MentionType.PageRef };
let node: MathEquationNode;

beforeEach(() => {
  jest.clearAllMocks();
  node = { type: BlockType.EquationBlock, blockId: 'equation', data: { formula }, children: [{ text: '' }] };
  mockEditor.children = [node];
  mockLoadViewMeta.mockImplementation(async (pageId) => ({ view_id: pageId, name: 'Math notes' }));
});

it('uses the equation content for a same-page mention and refreshes without a selection change', async () => {
  const { rerender } = render(<MentionPage {...props} />);

  expect(await screen.findByText(formula)).toBeTruthy();
  mockEditor.children = [{ ...node, data: { formula: 'x^2 + y^2' } }];
  rerender(<MentionPage {...props} />);
  expect(await screen.findByText('x^2 + y^2')).toBeTruthy();
  expect(mockLoadView).not.toHaveBeenCalled();
});

it('preserves the standard page-title prefix for an equation mention from another page', async () => {
  const doc = withTestingYDoc('other-page');

  insertBlock({
    doc,
    blockObject: {
      id: 'equation', ty: BlockType.EquationBlock, relation_id: 'equation-children', text_id: '',
      data: JSON.stringify({ formula }),
    },
  });
  mockLoadView.mockResolvedValue(doc);
  render(<MentionPage {...props} pageId='other-page' />);
  expect(await screen.findByText(`Math notes - ${formula}`)).toBeTruthy();
});

it.each(['', ' \n\t '])('falls back to the page title for an empty equation (%j)', async (empty) => {
  mockEditor.children = [{ ...node, data: { formula: empty } }];
  render(<MentionPage {...props} />);
  expect(await screen.findByText('Math notes')).toBeTruthy();
});
