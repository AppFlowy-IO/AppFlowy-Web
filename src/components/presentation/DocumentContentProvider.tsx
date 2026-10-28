import { type ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';

import { APP_EVENTS } from '@/application/constants';
import type { LoadView, LoadViewMeta } from '@/application/types';
import { useCurrentWorkspaceIdOptional, useEventEmitterOptional } from '@/components/app/app.hooks';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';
import { AppOutlineContext } from '@/components/app/contexts/AppOutlineContext';
import { AppSyncContext } from '@/components/app/contexts/AppSyncContext';
import { LeafContext } from '@/components/editor/components/leaf/leaf.hooks';
import { EditorContextProvider } from '@/components/editor/EditorContext';

const READ_ONLY_LEAF_CONTEXT = {};

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
    const loadViewMeta: LoadViewMeta = (id) => {
      let pending = metadata.get(id);

      if (!pending) {
        pending = loadMetadata?.(id, undefined, { metadataOnly: true }) ?? Promise.resolve(null);
        metadata.set(id, pending);
      }

      return pending;
    };

    const loadView: LoadView | undefined = loadDocument
      ? (id) => {
          let pending = documents.get(id);

          if (!pending) {
            pending = loadDocument(id, false, false);
            documents.set(id, pending);
          }

          return pending;
        }
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

  const navigateToView = useCallback(
    async (viewId: string, blockId?: string) => {
      if (!toView) return;
      onNavigate?.();
      await toView(viewId, blockId);
    },
    [toView, onNavigate]
  );

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
