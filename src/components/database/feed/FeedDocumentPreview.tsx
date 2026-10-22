import { memo, useEffect, useState } from 'react';
import * as Y from 'yjs';

import { useDatabaseContextOptional } from '@/application/database-yjs';
import { Types, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useSyncInternalOptional } from '@/components/app/contexts/SyncInternalContext';
import { HistoricalRowDocumentNotice } from '@/components/database/history/HistoricalRowDocumentNotice';
import { Editor } from '@/components/editor';
import { subscribeCollabDocReset } from '@/components/ws/sync/subscribeCollabDocReset';
import { CollabDocResetPayload } from '@/components/ws/sync/types';

/** Transaction origin for updates mirrored into a preview doc; never a `CollabOrigin`. */
export const FEED_PREVIEW_MIRROR_ORIGIN = 'feed-document-preview';

/**
 * Mirror a live row document into a detached read-only doc.
 *
 * Every editor bound to the same Y.Doc treats transactions tagged with the
 * shared `CollabOrigin.Local` origin as its own and skips them, so a second
 * editor on the live doc would never see edits typed in the row detail page.
 * Re-applying the source updates under a distinct origin keeps the preview
 * live without ever writing back.
 */
export function createMirroredPreviewDoc(source: YDoc): { doc: YDoc; dispose: () => void } {
  const doc = new Y.Doc({ guid: `${source.guid}:feed-preview` }) as YDoc;

  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source), FEED_PREVIEW_MIRROR_ORIGIN);

  const onUpdate = (update: Uint8Array) => {
    Y.applyUpdate(doc, update, FEED_PREVIEW_MIRROR_ORIGIN);
  };

  source.on('update', onUpdate);

  return {
    doc,
    dispose: () => {
      source.off('update', onUpdate);
      doc.destroy();
    },
  };
}

/**
 * Read-only preview of the row document (Desktop `FeedDocumentPreview`). The
 * card clips it at its height cap and offers "Open as full page" instead of
 * expanding in place. The mirrored row document keeps the preview live after
 * the row detail page edits it, so no manual refresh is needed.
 */
export const FeedDocumentPreview = memo(function FeedDocumentPreview({
  documentId,
  rowId,
}: {
  documentId: string;
  rowId: string;
}) {
  const context = useDatabaseContextOptional();
  const loadRowDocument = context?.loadRowDocument;
  const workspaceId = context?.workspaceId;
  const databaseId =
    context?.databaseDoc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database)?.get(YjsDatabaseKey.id) ||
    context?.databaseDoc?.guid;
  const databaseViewId = context?.activeViewId || context?.databasePageId;
  const sync = useSyncInternalOptional();
  const registerSyncContext = sync?.registerSyncContext;
  const scheduleDeferredCleanup = sync?.scheduleDeferredCleanup;
  const eventEmitter = sync?.eventEmitter;
  const [doc, setDoc] = useState<YDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    let disposeMirror: (() => void) | undefined;
    let syncOwnerDoc: YDoc | null = null;
    let latestResetDoc: YDoc | null = null;

    setDoc(null);

    if (!documentId || !loadRowDocument) return;

    const replaceMirror = (source: YDoc) => {
      disposeMirror?.();
      const mirror = createMirroredPreviewDoc(source);
      const root = mirror.doc.getMap(YjsEditorKey.data_section);
      const updateDocument = () => {
        // Empty local docs can hydrate after the loader exhausts its retries.
        // Only publish a ready mirror so hydration also triggers measurement.
        setDoc(root.get(YjsEditorKey.document) ? mirror.doc : null);
      };

      root.observe(updateDocument);
      updateDocument();
      disposeMirror = () => {
        root.unobserve(updateDocument);
        mirror.dispose();
      };
    };

    const handleReset = ({ objectId, doc: nextDoc }: CollabDocResetPayload) => {
      if (cancelled || objectId !== documentId || nextDoc === latestResetDoc) return;
      latestResetDoc = nextDoc;
      if (!disposeMirror) return;

      // rebuildCollabDoc already transfers the preview's sync ownership.
      // Re-registering here would leak an extra owner on every reset.
      if (syncOwnerDoc) syncOwnerDoc = nextDoc;
      replaceMirror(nextDoc);
    };

    const unsubscribeReset = eventEmitter ? subscribeCollabDocReset(eventEmitter, handleReset) : undefined;

    loadRowDocument(
      documentId,
      databaseId && databaseViewId
        ? { rowDocumentSource: { database_id: databaseId, database_view_id: databaseViewId, row_id: rowId } }
        : undefined
    )
      .then((loadedDoc) => {
        // A reset can finish before the initial load returns its old source.
        const source = latestResetDoc ?? loadedDoc;

        if (cancelled || !source) return;

        // A preview owns its subscription even when a row-detail editor already
        // bound the source. bindViewSync's _syncBound guard cannot acquire this
        // additional owner. Published previews have no realtime context.
        if (registerSyncContext && scheduleDeferredCleanup) {
          registerSyncContext({ doc: source, collabType: Types.Document });
          syncOwnerDoc = source;
        }

        replaceMirror(source);
      })
      .catch(() => {
        // A missing or forbidden row document simply has no preview.
      });

    return () => {
      cancelled = true;
      unsubscribeReset?.();
      disposeMirror?.();
      if (syncOwnerDoc) scheduleDeferredCleanup?.(syncOwnerDoc.guid);
    };
  }, [
    databaseId,
    databaseViewId,
    documentId,
    eventEmitter,
    loadRowDocument,
    registerSyncContext,
    rowId,
    scheduleDeferredCleanup,
  ]);

  if (context?.dataSource?.type === 'history') return <HistoricalRowDocumentNotice />;

  if (!doc || !documentId || !context || !workspaceId) return null;

  const { openPageModal: _openPageModal, ...editorContext } = context;

  return (
    <div data-testid={`feed-document-preview-${rowId}`}>
      <div
        className='feed-document-preview-content pointer-events-none select-none text-sm [&_[role=textbox]]:!px-0 [&_[role=textbox]]:!pb-0'
        data-testid={`feed-document-preview-content-${rowId}`}
      >
        <Editor
          key={doc.clientID}
          {...editorContext}
          canComment={false}
          canWrite={false}
          doc={doc}
          fullWidth
          preview
          readOnly
          viewId={documentId}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
});

export default FeedDocumentPreview;
