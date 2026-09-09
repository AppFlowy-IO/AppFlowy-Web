import EventEmitter from 'events';

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { useDatabaseContextOptional } from '@/application/database-yjs';
import { enqueueOutboxUpdate } from '@/application/sync-outbox';
import { CollabOrigin, Types, YDoc, YDocWithMeta, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useSyncInternalOptional } from '@/components/app/contexts/SyncInternalContext';
import { useBindViewSync } from '@/components/database/hooks/useBindViewSync';
import { rebuildCollabDoc } from '@/components/ws/sync/rebuildCollabDoc';
import { useSyncRefs } from '@/components/ws/sync/syncRefs';
import { useSyncContextLifecycle } from '@/components/ws/sync/useSyncContextLifecycle';

import { createMirroredPreviewDoc, FEED_PREVIEW_MIRROR_ORIGIN, FeedDocumentPreview } from '../FeedDocumentPreview';

jest.mock('@/application/database-yjs', () => ({ useDatabaseContextOptional: jest.fn() }));
jest.mock('@/components/app/contexts/SyncInternalContext', () => ({ useSyncInternalOptional: jest.fn() }));
jest.mock('@/application/sync-outbox', () => ({
  deleteOutboxByObjectId: jest.fn().mockResolvedValue(undefined),
  enqueueOutboxUpdate: jest.fn().mockResolvedValue(true),
  shouldRouteUpdateThroughOutbox: jest.fn(() => false),
  waitForDrain: jest.fn().mockResolvedValue(true),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const renderedDocs: YDoc[] = [];

jest.mock('@/components/editor', () => ({
  Editor: ({ doc, preview, readOnly, viewId }: { doc: YDoc; preview: boolean; readOnly: boolean; viewId: string }) => {
    renderedDocs.push(doc);

    return (
      <div
        data-preview={String(preview)}
        data-read-only={String(readOnly)}
        data-testid='mock-editor'
        data-view-id={viewId}
      />
    );
  },
}));

const mockUseDatabaseContextOptional = useDatabaseContextOptional as jest.MockedFunction<
  typeof useDatabaseContextOptional
>;
const mockUseSyncInternalOptional = useSyncInternalOptional as jest.MockedFunction<typeof useSyncInternalOptional>;

function createDocumentDoc(guid?: string): YDoc {
  const doc = new Y.Doc({ guid }) as unknown as YDoc;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
  return doc;
}

describe('FeedDocumentPreview', () => {
  let scrollHeight = 80;
  let scrollHeightDescriptor: PropertyDescriptor | undefined;
  const loadRowDocument = jest.fn();
  const registerSyncContext = jest.fn();
  const scheduleDeferredCleanup = jest.fn();
  let eventEmitter: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    eventEmitter = new EventEmitter();
    renderedDocs.length = 0;
    scrollHeight = 80;
    scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    loadRowDocument.mockResolvedValue(createDocumentDoc());
    const databaseDoc = new Y.Doc({ guid: 'database-guid' }) as YDoc;

    databaseDoc
      .getMap(YjsEditorKey.data_section)
      .set(YjsEditorKey.database, new Y.Map([[YjsDatabaseKey.id, 'database-id']]));
    mockUseDatabaseContextOptional.mockReturnValue({
      databaseDoc,
      activeViewId: 'database-view-id',
      databasePageId: 'database-page-id',
      loadRowDocument,
      workspaceId: 'workspace',
      readOnly: false,
      openPageModal: jest.fn(),
    } as unknown as ReturnType<typeof useDatabaseContextOptional>);
    mockUseSyncInternalOptional.mockReturnValue({
      eventEmitter,
      registerSyncContext,
      scheduleDeferredCleanup,
    } as unknown as ReturnType<typeof useSyncInternalOptional>);
  });

  afterEach(() => {
    if (scrollHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    }
  });

  it('loads the row document and renders a read-only editor capped at 120px', async () => {
    render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);

    const editor = await screen.findByTestId('mock-editor');

    expect(loadRowDocument).toHaveBeenCalledWith('doc-1', {
      rowDocumentSource: { database_id: 'database-id', database_view_id: 'database-view-id', row_id: 'row-1' },
    });
    expect(editor.getAttribute('data-preview')).toBe('true');
    expect(editor.getAttribute('data-read-only')).toBe('true');
    expect(editor.getAttribute('data-view-id')).toBe('doc-1');
    expect(screen.getByTestId('feed-document-preview-content-row-1').style.maxHeight).toBe('120px');
    expect(screen.queryByTestId('feed-document-preview-toggle-row-1')).toBeNull();
  });

  it('offers See more when the content overflows and See less once expanded', async () => {
    scrollHeight = 400;
    render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);

    const toggle = await screen.findByTestId('feed-document-preview-toggle-row-1');

    expect(toggle.textContent).toContain('button.seeMore');
    expect(screen.getByTestId('feed-document-preview-row-1').getAttribute('data-overflows')).toBe('true');

    act(() => {
      fireEvent.click(toggle);
    });

    await waitFor(() =>
      expect(screen.getByTestId('feed-document-preview-toggle-row-1').textContent).toContain('button.seeLess')
    );
    expect(screen.getByTestId('feed-document-preview-content-row-1').style.maxHeight).toBe('');
    expect(screen.getByTestId('feed-document-preview-row-1').getAttribute('data-expanded')).toBe('true');
  });

  it('renders a detached mirror of the row document rather than the shared live doc', async () => {
    const source = createDocumentDoc();

    loadRowDocument.mockResolvedValue(source);
    render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);
    await screen.findByTestId('mock-editor');

    expect(renderedDocs[0]).not.toBe(source);
    expect(renderedDocs[0].guid).toBe(`${source.guid}:feed-preview`);
  });

  it('replaces the preview after a matching reset and continues mirroring edits without adding a sync owner', async () => {
    const source = createDocumentDoc('doc-1');

    source.getMap(YjsEditorKey.data_section).set('text', 'Before reset');
    loadRowDocument.mockResolvedValue(source);
    const { unmount } = render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);

    const firstEditor = await screen.findByTestId('mock-editor');
    const firstMirror = renderedDocs[renderedDocs.length - 1];
    const destroyFirstMirror = jest.spyOn(firstMirror, 'destroy');
    const replacement = createDocumentDoc('doc-1');

    replacement.getMap(YjsEditorKey.data_section).set('text', 'Restored content');
    act(() => {
      eventEmitter.emit(APP_EVENTS.COLLAB_DOC_RESET, { objectId: 'other-doc', doc: createDocumentDoc('other-doc') });
    });
    expect(renderedDocs[renderedDocs.length - 1]).toBe(firstMirror);
    act(() => {
      source.destroy();
      eventEmitter.emit(APP_EVENTS.COLLAB_DOC_RESET, { objectId: 'doc-1', doc: replacement });
    });

    const replacementMirror = renderedDocs[renderedDocs.length - 1];

    expect(screen.getByTestId('mock-editor')).not.toBe(firstEditor);
    expect(replacementMirror).not.toBe(firstMirror);
    expect(replacementMirror).not.toBe(replacement);
    expect(replacementMirror.getMap(YjsEditorKey.data_section).get('text')).toBe('Restored content');
    expect(destroyFirstMirror).toHaveBeenCalledTimes(1);
    expect(registerSyncContext).toHaveBeenCalledTimes(1);
    expect(scheduleDeferredCleanup).not.toHaveBeenCalled();
    act(() => {
      replacement.transact(
        () => replacement.getMap(YjsEditorKey.data_section).set('text', 'Edited after reset'),
        CollabOrigin.Local
      );
    });
    expect(replacementMirror.getMap(YjsEditorKey.data_section).get('text')).toBe('Edited after reset');

    const destroyReplacementMirror = jest.spyOn(replacementMirror, 'destroy');
    const destroyReplacement = jest.spyOn(replacement, 'destroy');

    unmount();
    expect(destroyReplacementMirror).toHaveBeenCalledTimes(1);
    expect(destroyReplacement).not.toHaveBeenCalled();
    expect(eventEmitter.listenerCount(APP_EVENTS.COLLAB_DOC_RESET)).toBe(0);
    expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith('doc-1');
  });

  it.each(['initial load', 'reset'])(
    'renders and measures an empty document after %s when it hydrates later',
    async (stage) => {
      const source = new Y.Doc({ guid: 'doc-1' }) as YDoc;

      loadRowDocument.mockResolvedValue(stage === 'reset' ? createDocumentDoc('doc-1') : source);
      const { container, unmount } = render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);

      await waitFor(() => expect(registerSyncContext).toHaveBeenCalledTimes(1));
      if (stage === 'reset') {
        act(() => {
          eventEmitter.emit(APP_EVENTS.COLLAB_DOC_RESET, { objectId: 'doc-1', doc: source });
        });
      }

      expect(container.firstChild).toBeNull();
      scrollHeight = 400;
      act(() => {
        source.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
      });

      await screen.findByTestId('mock-editor');
      expect(screen.getByTestId('feed-document-preview-toggle-row-1').textContent).toContain('button.seeMore');
      expect(loadRowDocument).toHaveBeenCalledTimes(1);
      unmount();
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
    }
  );

  it('uses a reset received during loading instead of the stale load result', async () => {
    const stale = createDocumentDoc('doc-1');
    const replacement = createDocumentDoc('doc-1');
    let finishLoad!: (doc: YDoc) => void;

    replacement.getMap(YjsEditorKey.data_section).set('text', 'Restored while loading');
    loadRowDocument.mockReturnValue(
      new Promise<YDoc>((resolve) => {
        finishLoad = resolve;
      })
    );
    const { unmount } = render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);

    act(() => {
      stale.destroy();
      eventEmitter.emit(APP_EVENTS.COLLAB_DOC_RESET, { objectId: 'doc-1', doc: replacement });
    });
    await act(async () => finishLoad(stale));
    await screen.findByTestId('mock-editor');
    expect(renderedDocs[0].getMap(YjsEditorKey.data_section).get('text')).toBe('Restored while loading');
    expect(registerSyncContext).toHaveBeenCalledTimes(1);
    expect(registerSyncContext).toHaveBeenCalledWith({ doc: replacement, collabType: Types.Document });
    unmount();
    expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
  });

  it('shares the reset listener across previews and removes it after the last preview unmounts', async () => {
    const first = render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);
    const second = render(<FeedDocumentPreview documentId='doc-2' rowId='row-2' />);

    await screen.findAllByTestId('mock-editor');
    expect(eventEmitter.listenerCount(APP_EVENTS.COLLAB_DOC_RESET)).toBe(1);
    first.unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.COLLAB_DOC_RESET)).toBe(1);
    second.unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.COLLAB_DOC_RESET)).toBe(0);
  });

  it('renders nothing when the row document cannot be loaded', async () => {
    loadRowDocument.mockRejectedValue(new Error('forbidden'));
    const { container } = render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);

    await waitFor(() => expect(loadRowDocument).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    expect(registerSyncContext).not.toHaveBeenCalled();
    expect(scheduleDeferredCleanup).not.toHaveBeenCalled();
  });

  it('falls back to the database guid and page ID for row authorization', async () => {
    mockUseDatabaseContextOptional.mockReturnValue({
      ...mockUseDatabaseContextOptional(),
      databaseDoc: new Y.Doc({ guid: 'database-guid' }) as YDoc,
      activeViewId: '',
    } as ReturnType<typeof useDatabaseContextOptional>);
    render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);

    await screen.findByTestId('mock-editor');
    expect(loadRowDocument).toHaveBeenCalledWith('doc-1', {
      rowDocumentSource: { database_id: 'database-guid', database_view_id: 'database-page-id', row_id: 'row-1' },
    });
  });

  it.each([false, true])(
    'owns source sync independently of row-detail binding (_syncBound=%s)',
    async (alreadyBound) => {
      const source = createDocumentDoc() as YDocWithMeta;

      source._syncBound = alreadyBound;
      loadRowDocument.mockResolvedValue(source);
      const { unmount } = render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);

      await screen.findByTestId('mock-editor');
      expect(registerSyncContext).toHaveBeenCalledTimes(1);
      expect(registerSyncContext).toHaveBeenCalledWith({ doc: source, collabType: Types.Document });
      const mirror = renderedDocs[0];
      const destroyMirror = jest.spyOn(mirror, 'destroy');
      const destroySource = jest.spyOn(source, 'destroy');

      act(() => {
        source.getMap(YjsEditorKey.data_section).set('remote-text', 'Updated by another client');
      });
      expect(mirror.getMap(YjsEditorKey.data_section).get('remote-text')).toBe('Updated by another client');

      unmount();
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
      expect(scheduleDeferredCleanup).toHaveBeenCalledWith(source.guid);
      expect(destroyMirror).toHaveBeenCalledTimes(1);
      expect(destroySource).not.toHaveBeenCalled();
    }
  );

  it('does not acquire a sync owner when a load completes after unmount', async () => {
    let resolve!: (doc: YDoc) => void;

    loadRowDocument.mockReturnValue(
      new Promise<YDoc>((done) => {
        resolve = done;
      })
    );
    const { unmount } = render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);

    unmount();
    await act(async () => resolve(createDocumentDoc()));
    expect(registerSyncContext).not.toHaveBeenCalled();
    expect(scheduleDeferredCleanup).not.toHaveBeenCalled();
    expect(renderedDocs).toHaveLength(0);
  });

  it('releases the old document and ignores late loads when the row document changes', async () => {
    const first = createDocumentDoc();
    const last = createDocumentDoc();
    let resolveStale!: (doc: YDoc) => void;

    loadRowDocument
      .mockResolvedValueOnce(first)
      .mockReturnValueOnce(
        new Promise<YDoc>((resolve) => {
          resolveStale = resolve;
        })
      )
      .mockResolvedValueOnce(last);
    const { rerender, unmount } = render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);

    await screen.findByTestId('mock-editor');
    rerender(<FeedDocumentPreview documentId='doc-2' rowId='row-1' />);
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith(first.guid);
    rerender(<FeedDocumentPreview documentId='doc-3' rowId='row-1' />);
    await screen.findByTestId('mock-editor');
    await act(async () => resolveStale(createDocumentDoc()));

    expect(screen.getByTestId('mock-editor').getAttribute('data-view-id')).toBe('doc-3');
    expect(registerSyncContext).toHaveBeenCalledTimes(2);
    expect(registerSyncContext).toHaveBeenLastCalledWith({ doc: last, collabType: Types.Document });
    unmount();
    expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(2);
    expect(scheduleDeferredCleanup).toHaveBeenLastCalledWith(last.guid);
  });

  it('renders published snapshots without a realtime context', async () => {
    mockUseSyncInternalOptional.mockReturnValue(null);
    render(<FeedDocumentPreview documentId='doc-1' rowId='row-1' />);
    await screen.findByTestId('mock-editor');
    expect(registerSyncContext).not.toHaveBeenCalled();
  });
});

describe('Feed preview reset ownership', () => {
  let documents: YDoc[];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    documents = [];
    renderedDocs.length = 0;
  });

  afterEach(() => {
    cleanup();
    documents.forEach((doc) => doc.destroy());
    jest.useRealTimers();
  });

  it.each([false, true])(
    'keeps row-detail edits syncing after repeated resets (detail initially bound: %s)',
    async (initiallyBound) => {
      const documentId = 'ba9d7062-d74b-458e-a3a4-cab8a9e39074';
      const source = createDocumentDoc(documentId) as YDocWithMeta;

      documents.push(source);
      source.object_id = documentId;
      source.view_id = documentId;
      source._collabType = Types.Document;
      source._syncBound = false;
      const noop = () => undefined;
      const { result: sync } = renderHook(() => {
        const refs = useSyncRefs();

        return { refs, ...useSyncContextLifecycle(refs, noop, noop) };
      });
      const eventEmitter = new EventEmitter();

      mockUseSyncInternalOptional.mockReturnValue({
        ...sync.current,
        eventEmitter,
      } as unknown as ReturnType<typeof useSyncInternalOptional>);
      mockUseDatabaseContextOptional.mockReturnValue({
        loadRowDocument: jest.fn().mockResolvedValue(source),
        workspaceId: 'workspace',
      } as unknown as ReturnType<typeof useDatabaseContextOptional>);
      const detail = renderHook(() => useBindViewSync());

      if (initiallyBound) {
        act(() => {
          detail.result.current(source);
        });
      }

      const preview = render(<FeedDocumentPreview documentId={documentId} rowId='row-id' />);

      await screen.findByTestId('mock-editor');
      const ownerCount = initiallyBound ? 2 : 1;

      expect(sync.current.refs.contextRefCounts.current.get(documentId)).toBe(ownerCount);
      let currentDoc = source;

      for (let reset = 0; reset < 2; reset++) {
        const replacement = createDocumentDoc(documentId) as YDocWithMeta;
        const context = sync.current.refs.registeredContexts.current.get(documentId)!;

        documents.push(replacement);
        await act(async () => {
          currentDoc.destroy();
          await rebuildCollabDoc({
            previousDoc: currentDoc,
            context,
            eventEmitter,
            registerSyncContext: sync.current.registerSyncContext,
            scheduleDeferredCleanup: sync.current.scheduleDeferredCleanup,
            openDoc: async () => replacement,
            ownerCount,
            hadPendingDeferredCleanup: false,
          });
        });
        currentDoc = replacement;
        if (initiallyBound) {
          act(() => {
            detail.result.current(currentDoc);
          });
        }

        expect(sync.current.refs.contextRefCounts.current.get(documentId)).toBe(ownerCount);
      }

      if (!initiallyBound) {
        act(() => {
          detail.result.current(currentDoc);
        });
      }

      // Opening the row full page removes its Feed preview. The row editor
      // must retain sync after the preview's deferred cleanup would expire.
      preview.unmount();
      act(() => {
        jest.advanceTimersByTime(10_001);
      });
      expect(sync.current.refs.registeredContexts.current.has(documentId)).toBe(true);
      expect(sync.current.refs.contextRefCounts.current.get(documentId)).toBe(1);

      jest.mocked(enqueueOutboxUpdate).mockClear();
      act(() => {
        currentDoc.transact(
          () => currentDoc.getMap(YjsEditorKey.data_section).set('text', 'Edited in the full-page row'),
          CollabOrigin.Local
        );
      });
      expect(enqueueOutboxUpdate).toHaveBeenCalledTimes(1);
      expect(enqueueOutboxUpdate).toHaveBeenCalledWith(expect.objectContaining({ objectId: documentId }));
    }
  );
});

describe('createMirroredPreviewDoc', () => {
  it('mirrors Local-origin edits from the source into the preview doc under a distinct origin', () => {
    const source = createDocumentDoc();
    const sourceText = new Y.Text();

    source.getMap(YjsEditorKey.data_section).set('text', sourceText);

    const { doc, dispose } = createMirroredPreviewDoc(source);
    const origins: unknown[] = [];

    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    expect(doc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.document)).toBe(true);

    source.transact(() => sourceText.insert(0, 'Feed row document content'), CollabOrigin.Local);

    expect((doc.getMap(YjsEditorKey.data_section).get('text') as Y.Text).toString()).toBe('Feed row document content');
    expect(origins).toEqual([FEED_PREVIEW_MIRROR_ORIGIN]);

    dispose();
    source.transact(() => sourceText.insert(0, 'ignored '), CollabOrigin.Local);
    expect(origins).toHaveLength(1);
  });
});
