import { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

import { APP_EVENTS } from '@/application/constants';
import type { LoadView, LoadViewMeta } from '@/application/types';
import { useCurrentWorkspaceIdOptional, useEventEmitterOptional } from '@/components/app/app.hooks';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';
import { AppOutlineContext } from '@/components/app/contexts/AppOutlineContext';
import { AppSyncContext } from '@/components/app/contexts/AppSyncContext';
import { LeafContext } from '@/components/editor/components/leaf/leaf.hooks';
import { EditorContextProvider } from '@/components/editor/EditorContext';

const READ_ONLY_LEAF_CONTEXT = {};

/** Share a request until it fails: a rejection must not answer later readers or a mention's Retry. */
function remember<T>(cache: Map<string, Promise<T>>, id: string, pending: Promise<T>) {
  cache.set(id, pending);
  pending.catch(() => {
    if (cache.get(id) === pending) cache.delete(id);
  });
  return pending;
}

/** Resolve native mentions once across the slides and their hidden measurement copies. */
export default function DocumentContentProvider({
  children,
  onNavigate,
}: {
  children: ReactNode;
  onNavigate?: () => void;
}) {
  const operations = useContext(AppOperationsContext);
  const outline = useContext(AppOutlineContext);
  const sync = useContext(AppSyncContext);
  const loadMetadata = operations?.loadViewMeta;
  const loadDocument = operations?.loadView;
  const scheduleDeferredCleanup = sync?.scheduleDeferredCleanup;
  const toView = operations?.toView;
  const workspaceId = useCurrentWorkspaceIdOptional() ?? '';
  const eventEmitter = useEventEmitterOptional();
  const loaders = useMemo(() => {
    const metadata = new Map<string, ReturnType<LoadViewMeta>>();
    const documents = new Map<string, ReturnType<LoadView>>();
    const loadViewMeta: LoadViewMeta = (id, onChange, options) => {
      // An authoritative lookup (a mention's Retry) bypasses the cached answer and replaces it for every copy.
      const cached = options?.authoritative ? undefined : metadata.get(id);

      if (cached) {
        if (onChange) void cached.then(onChange, () => undefined);
        return cached;
      }

      const pending = loadMetadata?.(id, onChange, { metadataOnly: true, ...options }) ?? Promise.resolve(null);

      return remember(metadata, id, pending);
    };

    const loadView: LoadView | undefined = loadDocument
      ? (id) => documents.get(id) ?? remember(documents, id, loadDocument(id, false, false))
      : undefined;

    return { workspaceId, loadViewMeta, loadView, metadata, documents };
  }, [loadMetadata, loadDocument, workspaceId]);

  useEffect(() => {
    const invalidate = () => loaders.metadata.clear();

    eventEmitter?.on(APP_EVENTS.VIEW_META_CHANGED, invalidate);
    eventEmitter?.on(APP_EVENTS.OUTLINE_LOADED, invalidate);
    return () => {
      eventEmitter?.off(APP_EVENTS.VIEW_META_CHANGED, invalidate);
      eventEmitter?.off(APP_EVENTS.OUTLINE_LOADED, invalidate);
      loaders.documents.forEach((_doc, id) => scheduleDeferredCleanup?.(id));
    };
  }, [loaders, eventEmitter, scheduleDeferredCleanup]);

  // Hosts pass a fresh close callback on every render. A stable navigator keeps the editor context,
  // and every mention in the slides and their measuring copy, from re-rendering with them.
  const navigation = useRef({ toView, onNavigate });

  navigation.current = { toView, onNavigate };
  const navigateToView = useCallback(async (viewId: string, blockId?: string) => {
    const latest = navigation.current;

    if (!latest.toView) return;
    latest.onNavigate?.();
    await latest.toView(viewId, blockId);
  }, []);

  return (
    <EditorContextProvider
      workspaceId={loaders.workspaceId}
      // Excerpts have no editable source blocks: block links resolve against their source document.
      viewId=''
      readOnly
      canWrite={false}
      canComment={false}
      enableReminderMentions={false}
      loadViewMeta={loaders.loadViewMeta}
      loadView={loaders.loadView}
      getMentionUser={outline?.getMentionUser}
      getViewIdFromDatabaseId={operations?.getViewIdFromDatabaseId}
      eventEmitter={eventEmitter}
      navigateToView={navigateToView}
    >
      <LeafContext.Provider value={READ_ONLY_LEAF_CONTEXT}>{children}</LeafContext.Provider>
    </EditorContextProvider>
  );
}
