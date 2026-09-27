import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { BlockType, View, ViewLayout } from '@/application/types';
import { BlockNode } from '@/components/editor/editor.type';

import { Element } from '../Element';

const mockLoadViewMeta = jest.fn();
let mockCurrentLoadViewMeta = mockLoadViewMeta;
const mockNavigateToView = jest.fn();
const mockEditor = { selection: null };
const mockEvents = new EventEmitter();
let mockReadOnly = false;

jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({}));
jest.mock('slate-react', () => ({
  useReadOnly: () => mockReadOnly,
  useSelected: () => false,
  useSlate: () => mockEditor,
  useSlateStatic: () => mockEditor,
  ReactEditor: { toDOMNode: () => null },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({
    viewId: 'current-page',
    readOnly: mockReadOnly,
    loadViewMeta: mockCurrentLoadViewMeta,
    navigateToView: mockNavigateToView,
    eventEmitter: mockEvents,
  }),
  useEditorLocalState: () => ({ selectedBlockIds: [] }),
}));
jest.mock('@/components/editor/components/block-popover/BlockPopoverContext', () => ({
  usePopoverMountSignal: jest.fn(),
}));
jest.mock('@/components/editor/components/drag-drop/useBlockDrop', () => ({
  useBlockDrop: () => ({ isDraggingOver: false, dropEdge: null }),
}));
jest.mock('@/components/editor/components/drag-drop/handleBlockDrop', () => ({}));
jest.mock('@/application/slate-yjs/command', () => ({}));
jest.mock('@/application/slate-yjs/utils/convert', () => ({}));
jest.mock('@/application/slate-yjs/utils/editor', () => ({}));
jest.mock('@/components/_shared/view-icon/PageIcon', () => ({ view }: { view: View }) => (
  <span data-testid='page-icon' data-icon={view.icon?.value} />
));
jest.mock('@/components/editor/components/leaf/mention/style.css', () => ({}));
jest.mock('@/components/editor/components/element/BlockNotFound', () => ({
  BlockNotFound: () => <div data-testid='unsupported-block' />,
}));

// Keep the page-link renderer real; the other block renderers are unrelated to
// loading a desktop-authored linked_page through the editor's dispatch path.
jest.mock('@/components/editor/components/blocks/ai-meeting', () => ({}));
jest.mock('@/components/editor/components/blocks/audio', () => ({}));
jest.mock('@/components/editor/components/blocks/bulleted-list', () => ({}));
jest.mock('@/components/editor/components/blocks/callout', () => ({}));
jest.mock('@/components/editor/components/blocks/code', () => ({}));
jest.mock('@/components/editor/components/blocks/columns', () => ({}));
jest.mock('@/components/editor/components/blocks/database', () => ({}));
jest.mock('@/components/editor/components/blocks/divider', () => ({}));
jest.mock('@/components/editor/components/blocks/file', () => ({}));
jest.mock('@/components/editor/components/blocks/gallery', () => ({}));
jest.mock('@/components/editor/components/blocks/google-drive', () => ({}));
jest.mock('@/components/editor/components/blocks/heading', () => ({}));
jest.mock('@/components/editor/components/blocks/image', () => ({}));
jest.mock('@/components/editor/components/blocks/link-preview', () => ({}));
jest.mock('@/components/editor/components/blocks/math-equation', () => ({}));
jest.mock('@/components/editor/components/blocks/numbered-list', () => ({}));
jest.mock('@/components/editor/components/blocks/outline', () => ({}));
jest.mock('@/components/editor/components/blocks/page', () => ({}));
jest.mock('@/components/editor/components/blocks/paragraph', () => ({}));
jest.mock('@/components/editor/components/blocks/pdf', () => ({}));
jest.mock('@/components/editor/components/blocks/quote', () => ({}));
jest.mock('@/components/editor/components/blocks/simple-table/SimpleTable', () => ({}));
jest.mock('@/components/editor/components/blocks/simple-table/SimpleTableCell', () => ({}));
jest.mock('@/components/editor/components/blocks/simple-table/SimpleTableRow', () => ({}));
jest.mock('@/components/editor/components/blocks/table', () => ({}));
jest.mock('@/components/editor/components/blocks/text', () => ({}));
jest.mock('@/components/editor/components/blocks/video', () => ({}));
jest.mock('@/components/editor/components/blocks/todo-list', () => ({}));
jest.mock('@/components/editor/components/blocks/toggle-list', () => ({}));

function pageLink(type = 'linked_page', data: Record<string, unknown> = { view_id: 'linked-view' }) {
  const node: BlockNode = {
    blockId: 'page-link-block',
    type: type as BlockType,
    data,
    children: [{ text: '' }],
  };

  return (
    <Element element={node} attributes={{ 'data-slate-node': 'element', ref: jest.fn() }}>
      <span data-testid='slate-children' />
    </Element>
  );
}

function renderPageLink(type = 'linked_page', data: Record<string, unknown> = { view_id: 'linked-view' }) {
  return render(pageLink(type, data));
}

describe('desktop page-link blocks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentLoadViewMeta = mockLoadViewMeta;
    mockReadOnly = false;
    mockLoadViewMeta.mockResolvedValue({
      view_id: 'linked-view',
      name: 'Linked page title',
      layout: ViewLayout.Document,
      icon: null,
    });
  });

  it.each(['linked_page', 'sub_page'])('renders and opens a %s block without rewriting its type', async (type) => {
    const { container } = renderPageLink(type);
    const title = await screen.findByText('Linked page title');

    expect(screen.queryByTestId('unsupported-block')).toBeNull();
    expect(screen.getByTestId('page-icon')).toBeTruthy();
    expect(screen.getByTestId('slate-children')).toBeTruthy();
    expect(container.querySelector(`[data-block-type="${type}"]`)).toBeTruthy();
    expect(mockLoadViewMeta).toHaveBeenCalledWith('linked-view');

    fireEvent.click(title);

    await waitFor(() => expect(mockNavigateToView).toHaveBeenCalledWith('linked-view', undefined));
  });

  it('keeps linked pages navigable in a read-only document', async () => {
    mockReadOnly = true;
    renderPageLink();

    fireEvent.click(await screen.findByText('Linked page title'));

    await waitFor(() => expect(mockNavigateToView).toHaveBeenCalledWith('linked-view', undefined));
  });

  it('uses the existing no-access fallback when the linked page cannot be resolved', async () => {
    mockLoadViewMeta.mockRejectedValue(new Error('View not found'));
    renderPageLink();

    fireEvent.click(await screen.findByText('document.mention.noAccess'));

    expect(screen.queryByTestId('unsupported-block')).toBeNull();
    expect(mockNavigateToView).not.toHaveBeenCalled();
  });

  it('recovers after missing metadata and keeps following rename notifications', async () => {
    mockLoadViewMeta.mockRejectedValue(new Error('View not found'));
    renderPageLink('sub_page');
    await screen.findByText('document.mention.noAccess');

    act(() => {
      mockEvents.emit(APP_EVENTS.VIEW_META_CHANGED, { view_id: 'linked-view', name: 'Recovered child' });
    });
    fireEvent.click(await screen.findByText('Recovered child'));
    await waitFor(() => expect(mockNavigateToView).toHaveBeenCalledWith('linked-view', undefined));
    act(() => {
      mockEvents.emit(APP_EVENTS.VIEW_META_CHANGED, { view_id: 'linked-view', name: 'Renamed child' });
    });
    await screen.findByText('Renamed child');
  });

  it('does not let a delayed lookup overwrite newer metadata', async () => {
    let rejectLookup!: (error: Error) => void;

    mockLoadViewMeta.mockReturnValue(
      new Promise((_, reject) => {
        rejectLookup = reject;
      })
    );
    renderPageLink('sub_page');
    act(() => {
      mockEvents.emit(APP_EVENTS.OUTLINE_LOADED, [{ view_id: 'linked-view', name: 'Recovered child' }]);
    });
    await screen.findByText('Recovered child');
    await act(async () => {
      rejectLookup(new Error('Old cache miss'));
    });
    expect(screen.queryByText('document.mention.noAccess')).toBeNull();
    expect(screen.getByText('Recovered child')).toBeTruthy();
  });

  it('keeps the current title and icon visible when the metadata loader changes', async () => {
    mockLoadViewMeta.mockResolvedValue({ view_id: 'linked-view', name: 'Loaded title', icon: { ty: 0, value: '📄' } });
    const { rerender } = renderPageLink();

    await screen.findByText('Loaded title');
    let resolveLookup!: (view: Partial<View>) => void;

    mockCurrentLoadViewMeta = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve;
        })
    );

    rerender(pageLink());

    expect(mockCurrentLoadViewMeta).toHaveBeenCalledWith('linked-view');
    expect(screen.getByText('Loaded title')).toBeTruthy();
    expect(screen.getByTestId('page-icon').getAttribute('data-icon')).toBe('📄');
    await act(async () => {
      resolveLookup({ view_id: 'linked-view', name: 'Refreshed title', icon: { ty: 0, value: '🌱' } });
    });
    expect(screen.getByText('Refreshed title')).toBeTruthy();
    expect(screen.getByTestId('page-icon').getAttribute('data-icon')).toBe('🌱');
  });

  it('does not show cached metadata for a different page while loading', async () => {
    const { rerender } = renderPageLink();

    await screen.findByText('Linked page title');
    let resolveLookup!: (view: Partial<View>) => void;

    mockLoadViewMeta.mockReturnValue(
      new Promise((resolve) => {
        resolveLookup = resolve;
      })
    );

    rerender(pageLink('linked_page', { view_id: 'other-view' }));

    expect(mockLoadViewMeta).toHaveBeenLastCalledWith('other-view');
    expect(screen.queryByText('Linked page title')).toBeNull();
    await act(async () => {
      resolveLookup({ view_id: 'other-view', name: 'Other page' });
    });
    expect(screen.getByText('Other page')).toBeTruthy();
  });

  it.each([{}, { view_id: '' }, { view_id: 123 }])('does not load a malformed page reference: %j', (data) => {
    renderPageLink('linked_page', data);

    expect(screen.queryByTestId('unsupported-block')).toBeNull();
    expect(screen.queryByTestId('page-icon')).toBeNull();
    expect(screen.getByTestId('slate-children')).toBeTruthy();
    expect(mockLoadViewMeta).not.toHaveBeenCalled();
  });

  it('keeps the unsupported-block fallback for unknown block types', () => {
    renderPageLink('unknown-block');

    expect(screen.getByTestId('unsupported-block')).toBeTruthy();
    expect(mockLoadViewMeta).not.toHaveBeenCalled();
  });
});
