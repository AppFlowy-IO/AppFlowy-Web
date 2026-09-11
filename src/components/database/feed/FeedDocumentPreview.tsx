import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

import { useDatabaseContextOptional } from '@/application/database-yjs';
import { Types, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useSyncInternalOptional } from '@/components/app/contexts/SyncInternalContext';
import { HistoricalRowDocumentNotice } from '@/components/database/history/HistoricalRowDocumentNotice';
import { Editor } from '@/components/editor';
import { subscribeCollabDocReset } from '@/components/ws/sync/subscribeCollabDocReset';
import { CollabDocResetPayload } from '@/components/ws/sync/types';
import { cn } from '@/lib/utils';

import { FEED_DOCUMENT_PREVIEW_MAX_HEIGHT } from './feed.constants';

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

function SeeMoreButton({ expanded, onToggle, rowId }: { expanded: boolean; onToggle: () => void; rowId: string }) {
  const { t } = useTranslation();
  const Icon = expanded ? ChevronUp : ChevronDown;

  return (
    <button
      aria-expanded={expanded}
      className='flex items-center gap-1 rounded-full bg-fill-content-hover px-3 py-1.5 text-[13px] text-text-primary shadow-sm hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
      data-feed-interactive='true'
      data-testid={`feed-document-preview-toggle-${rowId}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      type='button'
    >
      <Icon aria-hidden='true' className='h-4 w-4' />
      {expanded ? t('button.seeLess') : t('button.seeMore')}
    </button>
  );
}

/**
 * Read-only preview of the row document, capped at 120px until expanded
 * (Desktop `FeedDocumentPreview`). The shared row document doc keeps the
 * preview live after the row detail page edits it, so no manual refresh is
 * needed.
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
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

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

  useLayoutEffect(() => {
    const element = contentRef.current;

    if (!doc || !element) return;

    const measure = () => {
      setOverflows(element.scrollHeight > FEED_DOCUMENT_PREVIEW_MAX_HEIGHT + 1);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measure);

    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);

    return () => observer.disconnect();
  }, [doc, expanded]);

  if (context?.dataSource?.type === 'history') return <HistoricalRowDocumentNotice />;

  if (!doc || !documentId || !context || !workspaceId) return null;

  const { openPageModal: _openPageModal, ...editorContext } = context;
  const showToggle = expanded || overflows;

  return (
    <div
      className='group/feed-preview relative mt-1.5'
      data-expanded={expanded}
      data-overflows={overflows}
      data-testid={`feed-document-preview-${rowId}`}
    >
      <div
        className={cn(
          'feed-document-preview-content pointer-events-none select-none overflow-hidden text-sm',
          '[&_[role=textbox]]:!px-0 [&_[role=textbox]]:!pb-0'
        )}
        data-testid={`feed-document-preview-content-${rowId}`}
        ref={contentRef}
        style={expanded ? undefined : { maxHeight: FEED_DOCUMENT_PREVIEW_MAX_HEIGHT }}
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

      {showToggle ? (
        expanded ? (
          <div className='mt-2 flex justify-center'>
            <SeeMoreButton expanded onToggle={() => setExpanded(false)} rowId={rowId} />
          </div>
        ) : (
          <div className='absolute inset-x-0 bottom-0 flex justify-center opacity-0 transition-opacity group-focus-within/feed-card:opacity-100 group-hover/feed-card:opacity-100 motion-reduce:transition-none'>
            <SeeMoreButton expanded={false} onToggle={() => setExpanded(true)} rowId={rowId} />
          </div>
        )
      ) : null}
    </div>
  );
});

export default FeedDocumentPreview;
