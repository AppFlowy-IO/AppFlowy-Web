import EventEmitter from 'events';

import { act, render, screen } from '@testing-library/react';
import { createEditor } from 'slate';

import { getTestingDocData, insertBlock, withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { BlockType, MentionType, YjsEditorKey } from '@/application/types';
import { PDFNode } from '@/components/editor/editor.type';

import MentionPage from '../MentionPage';

const mockEditor = createEditor();
const mockLoadView = jest.fn();
const mockLoadViewMeta = jest.fn();
const mockEvents = new EventEmitter();
const mockT = (key: string) => key;

jest.mock('slate-react', () => ({ useSlate: () => mockEditor }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({
    viewId: 'current-page', loadView: mockLoadView, loadViewMeta: mockLoadViewMeta, eventEmitter: mockEvents,
  }),
}));
jest.mock('@/components/_shared/view-icon/PageIcon', () => () => <span data-testid='page-icon' />);
jest.mock('../style.css', () => ({}));

const props = { pageId: 'current-page', blockId: 'pdf', text: { text: '@' }, type: MentionType.PageRef };
let node: PDFNode;

beforeEach(() => {
  jest.clearAllMocks();
  node = {
    type: BlockType.PDFBlock,
    blockId: 'pdf',
    data: { name: 'Research notes.pdf', url: 'https://example.com/file.pdf', url_type: 'cloud' },
    children: [{ text: '' }],
  } as PDFNode;
  mockEditor.children = [node];
  mockEditor.selection = null;
  mockLoadView.mockReset();
  mockEvents.removeAllListeners();
  mockLoadViewMeta.mockImplementation(async (pageId) => ({ view_id: pageId, name: 'Project' }));
});

it('uses the saved filename and updates a same-page mention when the PDF is replaced', async () => {
  const { rerender } = render(<MentionPage {...props} />);

  expect(await screen.findByText('Research notes.pdf')).toBeTruthy();
  mockEditor.children = [{ ...node, data: { ...node.data, name: 'Updated notes.pdf' } }];
  rerender(<MentionPage {...props} />);
  expect(await screen.findByText('Updated notes.pdf')).toBeTruthy();
  expect(mockLoadView).not.toHaveBeenCalled();
});

it('resolves a URL filename when an embedded PDF has no saved name', async () => {
  mockEditor.children = [{ ...node, data: { url: 'https://example.com/Annual%20report.pdf?download=1' } }];
  render(<MentionPage {...props} />);
  expect(await screen.findByText('Annual report.pdf')).toBeTruthy();
});

it('keeps a same-page PDF mention readable if optional page metadata is unavailable', async () => {
  mockLoadViewMeta.mockRejectedValue(new Error('Offline'));
  await act(async () => { render(<MentionPage {...props} />); });
  expect(screen.getByText('Research notes.pdf')).toBeTruthy();
  expect(screen.queryByText('document.mention.loadFailed')).toBeNull();
});

it('resolves and observes filenames across pages using the standard page-title prefix', async () => {
  const doc = withTestingYDoc('other-page');

  insertBlock({
    doc,
    blockObject: {
      id: 'pdf', ty: BlockType.PDFBlock, relation_id: 'pdf-children', text_id: '',
      data: JSON.stringify(node.data),
    },
  });
  const { sharedRoot, blocks } = getTestingDocData(doc);
  const unobserve = jest.spyOn(sharedRoot, 'unobserveDeep');

  mockLoadView.mockResolvedValue(doc);
  const { unmount } = render(<MentionPage {...props} pageId='other-page' />);

  expect(await screen.findByText('Project - Research notes.pdf')).toBeTruthy();
  act(() => {
    blocks.get('pdf').set(YjsEditorKey.block_data, JSON.stringify({ ...node.data, name: 'Updated notes.pdf' }));
  });
  expect(screen.getByText('Project - Updated notes.pdf')).toBeTruthy();
  expect(mockLoadView).toHaveBeenCalledTimes(1);
  unmount();
  expect(unobserve).toHaveBeenCalledTimes(1);
});
