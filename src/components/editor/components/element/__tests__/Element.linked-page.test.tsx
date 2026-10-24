import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { ViewMetadataError } from '@/application/errors/view-metadata-error';
import { BlockType, View, ViewLayout } from '@/application/types';
import { BlockNode } from '@/components/editor/editor.type';

import { Element } from '../Element';

const mockLoadViewMeta = jest.fn();
let mockCurrentLoadViewMeta = mockLoadViewMeta;
const mockNavigateToView = jest.fn();
const mockNameResolved = jest.fn();
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
    onPageMentionNameResolved: mockNameResolved,
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
    mockLoadViewMeta.mockReset();
    mockCurrentLoadViewMeta = mockLoadViewMeta;
    mockReadOnly = false;
    mockEvents.removeAllListeners();
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

  it.each([
    [{ code: ERROR_CODE.RECORD_NOT_FOUND, httpStatus: 200, sourceDomain: 'appflowy.server' }, 'document.mention.pageNotFound'],
    [{ code: 404 }, 'document.mention.pageNotFound'],
    [{ code: ERROR_CODE.RECORD_DELETED }, 'document.mention.pageNotFound'],
    [new ViewMetadataError('in_trash'), 'document.mention.pageInTrash'],
    [new ViewMetadataError('not_found'), 'document.mention.pageNotFound'],
    [{ code: ERROR_CODE.NOT_HAS_PERMISSION }, 'document.mention.noAccess'],
    [{ code: 403 }, 'document.mention.noAccess'],
    [{ code: ERROR_CODE.USER_UNAUTHORIZED }, 'landingPage.unauthorized.title'],
    [{ code: ERROR_CODE.SERVICE_TEMPORARY_UNAVAILABLE }, 'document.mention.loadFailed'],
    [{ code: -1, sourceDomain: 'transport', transportFailure: 'network' }, 'document.mention.loadFailed'],
    [{ code: ERROR_CODE.FEATURE_NOT_AVAILABLE, httpStatus: 403, sourceDomain: 'appflowy.server' }, 'document.mention.loadFailed'],
    [new Error('Lookup failed'), 'document.mention.loadFailed'],
  ])('keeps the error identity when a page reference fails: %j', async (error, label) => {
    mockLoadViewMeta.mockRejectedValue(error);
    renderPageLink();

    fireEvent.click(await screen.findByText(label));

    expect(screen.queryByTestId('unsupported-block')).toBeNull();
    expect(mockNavigateToView).not.toHaveBeenCalled();
    expect(mockLoadViewMeta).toHaveBeenCalledTimes(1);
    if (label !== 'document.mention.noAccess') expect(screen.queryByText('document.mention.noAccess')).toBeNull();
  });

  it('shows a missing page when the loader resolves without metadata', async () => {
    mockLoadViewMeta.mockResolvedValue(null);
    renderPageLink();

    await screen.findByText('document.mention.pageNotFound');
    expect(screen.queryByText('menuAppHeader.defaultNewPageName')).toBeNull();
  });

  it('retries a temporary failure through an authoritative lookup and restores navigation', async () => {
    let resolveRetry!: (view: Partial<View>) => void;

    mockLoadViewMeta.mockRejectedValueOnce({ code: ERROR_CODE.SERVICE_TEMPORARY_UNAVAILABLE });
    mockLoadViewMeta.mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    renderPageLink();

    const retry = await screen.findByRole('button', { name: 'button.retry' });

    fireEvent.mouseDown(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(mockLoadViewMeta).toHaveBeenCalledTimes(2));
    expect(mockLoadViewMeta).toHaveBeenLastCalledWith('linked-view', undefined, { authoritative: true });
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(retry);
    expect(mockLoadViewMeta).toHaveBeenCalledTimes(2);
    expect(mockNavigateToView).not.toHaveBeenCalled();

    await act(async () => { resolveRetry({ view_id: 'linked-view', name: 'Recovered page' }); });
    fireEvent.click(await screen.findByText('Recovered page'));
    await waitFor(() => expect(mockNavigateToView).toHaveBeenCalledWith('linked-view', undefined));
    expect(screen.queryByRole('button', { name: 'button.retry' })).toBeNull();
  });

  it('recovers after missing metadata and keeps following rename notifications', async () => {
    mockLoadViewMeta.mockRejectedValue({ code: ERROR_CODE.RECORD_NOT_FOUND });
    renderPageLink('sub_page');
    await screen.findByText('document.mention.pageNotFound');

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

  it('keeps a live recovery when an older retry subsequently fails', async () => {
    let rejectRetry!: (error: unknown) => void;

    mockLoadViewMeta.mockRejectedValueOnce(new Error('Offline'));
    mockLoadViewMeta.mockImplementationOnce(() => new Promise((_, reject) => { rejectRetry = reject; }));
    renderPageLink();
    fireEvent.click(await screen.findByRole('button', { name: 'button.retry' }));
    await waitFor(() => expect(mockLoadViewMeta).toHaveBeenCalledTimes(2));
    act(() => {
      mockEvents.emit(APP_EVENTS.OUTLINE_LOADED, [{ view_id: 'linked-view', name: 'Restored by sync' }]);
    });
    await screen.findByText('Restored by sync');
    await act(async () => { rejectRetry({ code: ERROR_CODE.RECORD_NOT_FOUND }); });
    expect(screen.getByText('Restored by sync')).toBeTruthy();
    expect(screen.queryByText('document.mention.pageNotFound')).toBeNull();
  });

  it('releases reference listeners while an unresolved lookup is still pending', () => {
    mockLoadViewMeta.mockReturnValue(new Promise(() => undefined));
    const { unmount } = renderPageLink();

    expect(mockEvents.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(1);
    expect(mockEvents.listenerCount(APP_EVENTS.VIEW_META_CHANGED)).toBe(1);
    expect(mockEvents.listenerCount(APP_EVENTS.VIEW_ACCESS_REVOKED)).toBe(1);
    expect(mockEvents.listenerCount(APP_EVENTS.VIEW_ACCESS_RESTORED)).toBe(1);
    unmount();
    expect(mockEvents.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(0);
    expect(mockEvents.listenerCount(APP_EVENTS.VIEW_META_CHANGED)).toBe(0);
    expect(mockEvents.listenerCount(APP_EVENTS.VIEW_ACCESS_REVOKED)).toBe(0);
    expect(mockEvents.listenerCount(APP_EVENTS.VIEW_ACCESS_RESTORED)).toBe(0);
  });

  it('clears revoked reference metadata and ignores stale snapshots and unrelated access events', async () => {
    renderPageLink();
    await screen.findByText('Linked page title');
    act(() => {
      mockEvents.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'other-view' });
      mockEvents.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: 'other-view' });
    });
    expect(screen.getByText('Linked page title')).toBeTruthy();
    expect(mockLoadViewMeta).toHaveBeenCalledTimes(1);

    act(() => {
      mockEvents.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'linked-view' });
      mockEvents.emit(APP_EVENTS.OUTLINE_LOADED, [{ view_id: 'linked-view', name: 'Stale outline title' }]);
      mockEvents.emit(APP_EVENTS.VIEW_META_CHANGED, { view_id: 'linked-view', name: 'Stale metadata title' });
    });
    fireEvent.click(await screen.findByText('document.mention.noAccess'));
    expect(screen.queryByText('Linked page title')).toBeNull();
    expect(screen.queryByTestId('page-icon')).toBeNull();
    expect(mockNameResolved).toHaveBeenLastCalledWith('linked-view', undefined);
    expect(mockLoadViewMeta).toHaveBeenCalledTimes(1);
    expect(mockNavigateToView).not.toHaveBeenCalled();
  });

  it.each(['resolves', 'rejects'])('ignores an old metadata lookup that %s after access is revoked', async (outcome) => {
    let resolveLookup!: (view: Partial<View>) => void;
    let rejectLookup!: (error: Error) => void;

    mockLoadViewMeta.mockImplementationOnce(() => new Promise((resolve, reject) => {
      resolveLookup = resolve;
      rejectLookup = reject;
    }));
    renderPageLink();
    act(() => { mockEvents.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'linked-view' }); });
    await screen.findByText('document.mention.noAccess');
    await act(async () => {
      if (outcome === 'resolves') resolveLookup({ view_id: 'linked-view', name: 'Stale title' });
      else rejectLookup(new Error('Old request failed'));
    });
    expect(screen.getByText('document.mention.noAccess')).toBeTruthy();
    expect(mockNameResolved).toHaveBeenLastCalledWith('linked-view', undefined);
  });

  it('authoritatively restores an off-outline reference before accepting live metadata again', async () => {
    let resolveRestoration!: (view: Partial<View>) => void;

    mockLoadViewMeta.mockRejectedValueOnce({ code: 403 });
    mockLoadViewMeta.mockImplementationOnce(() => new Promise((resolve) => { resolveRestoration = resolve; }));
    renderPageLink();
    await screen.findByText('document.mention.noAccess');
    act(() => {
      mockEvents.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: 'linked-view' });
      mockEvents.emit(APP_EVENTS.OUTLINE_LOADED, [{ view_id: 'linked-view', name: 'Stale outline title' }]);
      mockEvents.emit(APP_EVENTS.VIEW_META_CHANGED, { view_id: 'linked-view', name: 'Stale metadata title' });
    });
    expect(screen.getByText('document.mention.noAccess')).toBeTruthy();
    expect(mockLoadViewMeta).toHaveBeenCalledTimes(2);
    expect(mockLoadViewMeta).toHaveBeenLastCalledWith('linked-view', undefined, { authoritative: true });
    await act(async () => { resolveRestoration({ view_id: 'linked-view', name: 'Restored title' }); });
    fireEvent.click(await screen.findByText('Restored title'));
    await waitFor(() => expect(mockNavigateToView).toHaveBeenCalledWith('linked-view', undefined));
    act(() => {
      mockEvents.emit(APP_EVENTS.VIEW_META_CHANGED, { view_id: 'linked-view', name: 'Renamed restored page' });
    });
    expect(screen.getByText('Renamed restored page')).toBeTruthy();
    expect(mockLoadViewMeta).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ code: 403 }, 'document.mention.noAccess'],
    [new Error('Offline'), 'document.mention.loadFailed'],
  ])('keeps stale metadata fenced when the restoration lookup fails: %j', async (error, label) => {
    mockLoadViewMeta.mockRejectedValueOnce({ code: 403 });
    mockLoadViewMeta.mockRejectedValueOnce(error);
    renderPageLink();
    await screen.findByText('document.mention.noAccess');
    await act(async () => { mockEvents.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: 'linked-view' }); });
    await screen.findByText(label);
    act(() => {
      mockEvents.emit(APP_EVENTS.OUTLINE_LOADED, [{ view_id: 'linked-view', name: 'Stale outline title' }]);
      mockEvents.emit(APP_EVENTS.VIEW_META_CHANGED, { view_id: 'linked-view', name: 'Stale metadata title' });
    });
    expect(screen.getByText(label)).toBeTruthy();
    expect(mockLoadViewMeta).toHaveBeenCalledTimes(2);
    expect(mockNameResolved).toHaveBeenLastCalledWith('linked-view', undefined);

    if (label === 'document.mention.loadFailed') {
      fireEvent.click(screen.getByRole('button', { name: 'button.retry' }));
    } else {
      act(() => { mockEvents.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: 'linked-view' }); });
    }

    await screen.findByText('Linked page title');
    expect(mockLoadViewMeta).toHaveBeenCalledTimes(3);
    expect(mockLoadViewMeta).toHaveBeenLastCalledWith('linked-view', undefined, { authoritative: true });
  });

  it.each(['resolves', 'rejects'])('ignores a restoration lookup that %s after another revocation', async (outcome) => {
    let resolveRestoration!: (view: Partial<View>) => void;
    let rejectRestoration!: (error: Error) => void;

    mockLoadViewMeta.mockRejectedValueOnce({ code: 403 });
    mockLoadViewMeta.mockImplementationOnce(() => new Promise((resolve, reject) => {
      resolveRestoration = resolve;
      rejectRestoration = reject;
    }));
    renderPageLink();
    await screen.findByText('document.mention.noAccess');
    act(() => {
      mockEvents.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: 'linked-view' });
      mockEvents.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'linked-view' });
    });
    await act(async () => {
      if (outcome === 'resolves') resolveRestoration({ view_id: 'linked-view', name: 'Stale restored title' });
      else rejectRestoration(new Error('Old request failed'));
    });
    expect(screen.getByText('document.mention.noAccess')).toBeTruthy();
    expect(mockNameResolved).toHaveBeenLastCalledWith('linked-view', undefined);
  });

  it('keeps the access fence when the metadata loader changes', async () => {
    const { rerender } = renderPageLink();

    await screen.findByText('Linked page title');
    act(() => { mockEvents.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'linked-view' }); });
    mockCurrentLoadViewMeta = jest.fn().mockRejectedValue({ code: 403 });
    rerender(pageLink());
    await waitFor(() => expect(mockCurrentLoadViewMeta).toHaveBeenCalledTimes(1));
    expect(mockCurrentLoadViewMeta).toHaveBeenCalledWith('linked-view', undefined, { authoritative: true });
    expect(screen.getByText('document.mention.noAccess')).toBeTruthy();
    act(() => {
      mockEvents.emit(APP_EVENTS.OUTLINE_LOADED, [{ view_id: 'linked-view', name: 'Stale outline title' }]);
    });
    expect(screen.getByText('document.mention.noAccess')).toBeTruthy();
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
