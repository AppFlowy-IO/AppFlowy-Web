import EventEmitter from 'events';

import { act, render, screen } from '@testing-library/react';
import { createEditor } from 'slate';

import { getTestingDocData, insertBlock, withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { BlockType, MentionType, YjsEditorKey } from '@/application/types';
import { ImageBlockNode } from '@/components/editor/editor.type';

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
    viewId: 'current-page',
    loadView: mockLoadView,
    loadViewMeta: mockLoadViewMeta,
    eventEmitter: mockEvents,
  }),
}));
jest.mock('@/components/_shared/view-icon/PageIcon', () => () => <span data-testid='page-icon' />);
jest.mock('../style.css', () => ({}));

const props = { pageId: 'current-page', blockId: 'photo', text: { text: '@' }, type: MentionType.PageRef };
let node: ImageBlockNode;

beforeEach(() => {
  jest.clearAllMocks();
  node = {
    type: BlockType.ImageBlock,
    blockId: 'photo',
    data: { name: 'Mountain sunrise.jpg', url: 'https://example.com/file.jpg', source: 'upload' },
    children: [{ text: '' }],
  } as ImageBlockNode;
  mockEditor.children = [node];
  mockEditor.selection = null;
  mockLoadView.mockReset();
  mockEvents.removeAllListeners();
  mockLoadViewMeta.mockImplementation(async (pageId) => ({ view_id: pageId, name: 'Project' }));
});

it('uses the saved filename and updates a same-page mention when the image is replaced', async () => {
  const { rerender } = render(<MentionPage {...props} />);

  expect(await screen.findByText('Mountain sunrise.jpg')).toBeTruthy();
  mockEditor.children = [{ ...node, data: { ...node.data, name: 'Beach sunset.jpg' } }];
  rerender(<MentionPage {...props} />);
  expect(await screen.findByText('Beach sunset.jpg')).toBeTruthy();
  expect(mockLoadView).not.toHaveBeenCalled();
});

it('resolves a URL filename when an embedded image has no saved name', async () => {
  mockEditor.children = [{ ...node, data: { url: 'https://example.com/Mountain%20view.jpg?download=1' } }];
  render(<MentionPage {...props} />);
  expect(await screen.findByText('Mountain view.jpg')).toBeTruthy();
});

it('keeps a same-page image mention readable if optional page metadata is unavailable', async () => {
  mockLoadViewMeta.mockRejectedValue(new Error('Offline'));
  await act(async () => {
    render(<MentionPage {...props} />);
  });
  expect(screen.getByText('Mountain sunrise.jpg')).toBeTruthy();
  expect(screen.queryByText('document.mention.loadFailed')).toBeNull();
});

it('resolves and observes filenames across pages using the standard page-title prefix', async () => {
  const doc = withTestingYDoc('other-page');

  insertBlock({
    doc,
    blockObject: {
      id: 'photo',
      ty: BlockType.ImageBlock,
      relation_id: 'photo-children',
      text_id: '',
      data: JSON.stringify(node.data),
    },
  });
  const { sharedRoot, blocks } = getTestingDocData(doc);
  const unobserve = jest.spyOn(sharedRoot, 'unobserveDeep');

  mockLoadView.mockResolvedValue(doc);
  const { unmount } = render(<MentionPage {...props} pageId='other-page' />);

  expect(await screen.findByText('Project - Mountain sunrise.jpg')).toBeTruthy();
  act(() => {
    blocks.get('photo').set(YjsEditorKey.block_data, JSON.stringify({ ...node.data, name: 'Beach sunset.jpg' }));
  });
  expect(screen.getByText('Project - Beach sunset.jpg')).toBeTruthy();
  expect(mockLoadView).toHaveBeenCalledTimes(1);
  unmount();
  expect(unobserve).toHaveBeenCalledTimes(1);
});
