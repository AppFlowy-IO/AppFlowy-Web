import { act, render, screen, waitFor } from '@testing-library/react';
import { createEditor } from 'slate';

import { getTestingDocData, insertBlock, withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { BlockType, MentionType, YjsEditorKey } from '@/application/types';
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
  mockEditor.selection = null;
  mockLoadView.mockReset();
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

function equationDoc(pageId: string, equation = formula) {
  const doc = withTestingYDoc(pageId);

  insertBlock({
    doc,
    blockObject: {
      id: 'equation', ty: BlockType.EquationBlock, relation_id: 'equation-children', text_id: '',
      data: JSON.stringify({ formula: equation }),
    },
  });

  return doc;
}

it('preserves the standard page-title prefix for an equation mention from another page', async () => {
  const doc = equationDoc('other-page');

  mockLoadView.mockResolvedValue(doc);
  render(<MentionPage {...props} pageId='other-page' />);
  expect(await screen.findByText(`Math notes - ${formula}`)).toBeTruthy();
});

it('loads a cross-page equation once, without reloading on cursor movement', async () => {
  mockLoadView.mockResolvedValue(equationDoc('other-page'));
  const { rerender } = render(<MentionPage {...props} pageId='other-page' />);

  await screen.findByText(`Math notes - ${formula}`);
  for (let offset = 0; offset < 3; offset++) {
    mockEditor.selection = { anchor: { path: [0, 0], offset }, focus: { path: [0, 0], offset } };
    rerender(<MentionPage {...props} pageId='other-page' />);
  }

  expect(mockLoadView).toHaveBeenCalledTimes(1);
});

it('ignores a late load from a previous reference', async () => {
  let resolveOld!: (doc: ReturnType<typeof equationDoc>) => void;

  mockLoadView.mockImplementation((pageId) => pageId === 'old-page'
    ? new Promise((resolve) => { resolveOld = resolve; })
    : Promise.resolve(equationDoc(pageId, 'new equation')));
  const { rerender } = render(<MentionPage {...props} pageId='old-page' />);

  await waitFor(() => expect(mockLoadView).toHaveBeenCalledWith('old-page'));
  rerender(<MentionPage {...props} pageId='new-page' />);
  await screen.findByText('Math notes - new equation');
  await act(async () => { resolveOld(equationDoc('old-page', 'stale equation')); });
  expect(screen.queryByText('Math notes - stale equation')).toBeNull();
  expect(screen.getByText('Math notes - new equation')).toBeTruthy();
});

it('observes cross-page formula changes and releases the subscription on unmount', async () => {
  const doc = equationDoc('other-page');
  const { sharedRoot, blocks } = getTestingDocData(doc);
  const unobserve = jest.spyOn(sharedRoot, 'unobserveDeep');

  mockLoadView.mockResolvedValue(doc);
  const { unmount } = render(<MentionPage {...props} pageId='other-page' />);

  await screen.findByText(`Math notes - ${formula}`);
  act(() => { blocks.get('equation').set(YjsEditorKey.block_data, JSON.stringify({ formula: 'x=2' })); });
  expect(screen.getByText('Math notes - x=2')).toBeTruthy();
  act(() => { blocks.delete('equation'); });
  expect(screen.getByText('Math notes')).toBeTruthy();
  expect(mockLoadView).toHaveBeenCalledTimes(1);
  unmount();
  expect(unobserve).toHaveBeenCalledTimes(1);
});

it.each(['', ' \n\t '])('falls back to the page title for an empty equation (%j)', async (empty) => {
  mockEditor.children = [{ ...node, data: { formula: empty } }];
  render(<MentionPage {...props} />);
  expect(await screen.findByText('Math notes')).toBeTruthy();
});
