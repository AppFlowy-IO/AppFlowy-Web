import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import {
  AccessLevel,
  Types,
  View,
  ViewLayout,
  YDoc,
} from '@/application/types';
import { openView } from '@/application/view-loader';
import { getFirstChildView, isDatabaseContainer } from '@/application/view-utils';
import { findView, findViewInShareWithMe } from '@/components/_shared/outline/utils';
import { CollabDocResetPayload } from '@/components/ws/sync/types';
import { Log } from '@/utils/log';
import { getPlatform } from '@/utils/platform';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';

import { useDatabaseIdentity } from './useDatabaseIdentity';

/**
 * Extended YDoc with metadata for deferred sync binding.
 * These properties are set during loadView and used by bindViewSync.
 */
export interface YDocWithMeta extends YDoc {
  /** Collab object ID used by sync/persistence routing */
  object_id?: string;
  /** Host view ID used by route/render guards */
  view_id?: string;
  /** The collab type for sync binding */
  _collabType?: Types;
  /** Whether sync has been bound for this doc */
  _syncBound?: boolean;
}

export function getViewReadOnlyStatus(viewId: string, outline?: View[]) {
  const isMobile = getPlatform().isMobile;

  if (isMobile) return true; // Mobile has highest priority - always readonly

  if (!outline) return false;

  // Check if view exists in shareWithMe
  const shareWithMeView = findViewInShareWithMe(outline, viewId);

  if (shareWithMeView?.access_level !== undefined) {
    // If found in shareWithMe, check access level
    return shareWithMeView.access_level <= AccessLevel.ReadAndComment;
  }

  // If not found in shareWithMe, default is false (editable)
  return false;
}

// Hook for managing view-related operations
export function useViewOperations() {
  const { service, currentWorkspaceId, userWorkspaceInfo } = useAuthInternal();
  const { registerSyncContext, eventEmitter } = useSyncInternal();
  const navigate = useNavigate();
  const databaseStorageId = userWorkspaceInfo?.selectedWorkspace?.databaseStorageId;

  const [awarenessMap, setAwarenessMap] = useState<Record<string, Awareness>>({});
  // Ref for stable access to awarenessMap in callbacks (prevents bindViewSync recreation)
  const awarenessMapRef = useRef<Record<string, Awareness>>({});

  useEffect(() => {
    awarenessMapRef.current = { ...awarenessMapRef.current, ...awarenessMap };
  }, [awarenessMap]);

  useEffect(() => {
    const handleCollabDocReset = ({ viewId, awareness }: CollabDocResetPayload) => {
      if (!viewId || !awareness) {
        return;
      }

      awarenessMapRef.current = { ...awarenessMapRef.current, [viewId]: awareness };
      setAwarenessMap((prev) => {
        if (prev[viewId] === awareness) {
          return prev;
        }

        return { ...prev, [viewId]: awareness };
      });
    };

    eventEmitter.on(APP_EVENTS.COLLAB_DOC_RESET, handleCollabDocReset);
    return () => {
      eventEmitter.off(APP_EVENTS.COLLAB_DOC_RESET, handleCollabDocReset);
    };
  }, [eventEmitter]);

  const { resolveCollabObjectId, getViewIdFromDatabaseId } = useDatabaseIdentity({
    currentWorkspaceId,
    databaseStorageId,
    registerSyncContext,
  });

  // Check if view should be readonly based on access permissions
  const getViewReadOnlyStatusFromOutline = useCallback((viewId: string, outline?: View[]) => {
    return getViewReadOnlyStatus(viewId, outline);
  }, []);

  /**
   * Load view document WITHOUT binding sync.
   *
   * This function:
   * 1. Opens the Y.Doc from cache (IndexedDB) or fetches from server
   * 2. Stores metadata (_collabType) on the doc for later sync binding
   * 3. Returns the doc immediately for rendering
   *
   * Call bindViewSync() AFTER render to start WebSocket sync.
   */
  const loadView = useCallback(
    async (viewId: string, isSubDocument = false, loadAwareness = false, outline?: View[]) => {
      try {
        if (!service || !currentWorkspaceId) {
          throw new Error('Service or workspace not found');
        }

        const view = findView(outline || [], viewId);

        // Check for AIChat early
        if (view?.layout === ViewLayout.AIChat) {
          return Promise.reject(new Error('AIChat views cannot be loaded as collab documents'));
        }

        if (loadAwareness) {
          // Add recent pages when view is loaded (fire and forget)
          void (async () => {
            try {
              await service.addRecentPages(currentWorkspaceId, [viewId]);
            } catch (e) {
              console.error(e);
            }
          })();
        }

        // Use view-loader to open document (handles cache vs fetch)
        const { doc, collabType: detectedCollabType } = await openView(
          currentWorkspaceId,
          viewId,
          isSubDocument ? ViewLayout.Document : view?.layout
        );

        // Use detected collab type, or override for sub-documents
        const collabType = isSubDocument ? Types.Document : detectedCollabType;

        Log.debug('[useViewOperations] loadView complete (sync not bound)', {
          viewId,
          layout: view?.layout,
          collabType,
          isSubDocument,
        });

        const collabObjectId = await resolveCollabObjectId(doc, viewId, collabType);

        // Store metadata on doc for deferred sync binding
        const docWithMeta = doc as YDocWithMeta;

        docWithMeta.object_id = collabObjectId;
        docWithMeta.view_id = viewId;
        docWithMeta._collabType = collabType;
        docWithMeta._syncBound = false;

        // For documents with awareness, create and store awareness
        if (collabType === Types.Document && loadAwareness) {
          if (!awarenessMapRef.current[viewId]) {
            const awareness = new Awareness(doc);

            awarenessMapRef.current = { ...awarenessMapRef.current, [viewId]: awareness };
            setAwarenessMap((prev) => {
              if (prev[viewId]) {
                return prev;
              }

              return { ...prev, [viewId]: awareness };
            });
          }
        }

        return doc;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [service, currentWorkspaceId, resolveCollabObjectId]
  );

  /**
   * Bind sync for a loaded document.
   *
   * Call this AFTER the component has rendered to start WebSocket sync.
   * This separation prevents race conditions where sync messages arrive
   * before the component finishes rendering.
   *
   * @param doc - The YDoc returned from loadView
   * @returns The sync context, or null if already bound or invalid doc
   */
  const bindViewSync = useCallback(
    (doc: YDoc) => {
      const docWithMeta = doc as YDocWithMeta;

      // Skip if already bound
      if (docWithMeta._syncBound) {
        Log.debug('[useViewOperations] bindViewSync skipped - already bound', {
          viewId: docWithMeta.view_id,
          objectId: docWithMeta.object_id,
        });
        return null;
      }

      const collabType = docWithMeta._collabType;
      const objectId = docWithMeta.object_id;
      const viewId = docWithMeta.view_id ?? objectId;

      // Use explicit undefined check for collabType since Types.Document = 0 is falsy
      if (collabType === undefined || !objectId || !viewId) {
        console.warn('[useViewOperations] bindViewSync failed - missing metadata', {
          hasCollabType: collabType !== undefined,
          hasObjectId: !!objectId,
          hasViewId: !!viewId,
        });
        return null;
      }

      // Get awareness for documents if available (use ref for stable callback)
      const awareness = collabType === Types.Document ? awarenessMapRef.current[viewId] : undefined;

      Log.debug('[useViewOperations] bindViewSync starting', {
        viewId,
        objectId,
        collabType,
        hasAwareness: !!awareness,
      });

      const syncContext = registerSyncContext({ doc, collabType, awareness });

      docWithMeta._syncBound = true;

      Log.debug('[useViewOperations] bindViewSync complete', {
        viewId,
        objectId,
        collabType,
      });

      return syncContext;
    },
    [registerSyncContext]
  );

  // Navigate to view
  const toView = useCallback(
    async (viewId: string, blockId?: string, keepSearch?: boolean, loadViewMeta?: (viewId: string) => Promise<View>) => {
      // Prefer outline/meta when available (fast), but fall back to server fetch for cases
      // where the outline does not include container children (e.g. shallow outline fetch).
      let view: View | undefined;

      if (loadViewMeta) {
        try {
          view = await loadViewMeta(viewId);
        } catch (e) {
          Log.debug('[toView] loadViewMeta failed', {
            viewId,
            error: e,
          });
        }
      }

      // If meta is unavailable (e.g. outline not loaded yet), fall back to a direct server fetch so we can
      // still resolve database containers and block routing.
      if (!view && currentWorkspaceId && service) {
        try {
          view = await service.getAppView(currentWorkspaceId, viewId);
        } catch (e) {
          Log.warn('[toView] Failed to fetch view from server', {
            viewId,
            error: e,
          });
        }
      }

      // If this is a database container, navigate to the first child view instead
      // This matches Desktop/Flutter behavior where clicking a container opens its first child
      let targetViewId = viewId;
      let targetView = view;

      if (isDatabaseContainer(view)) {
        let firstChild = getFirstChildView(view);

        // Fallback: fetch the container subtree from server to resolve first child.
        if (!firstChild && currentWorkspaceId && service) {
          try {
            const remote = await service.getAppView(currentWorkspaceId, viewId);

            // Update local variable so blockId routing below uses the correct layout.
            view = remote;
            targetView = remote;

            if (isDatabaseContainer(remote)) {
              firstChild = getFirstChildView(remote);
            }
          } catch (e) {
            Log.warn('[toView] Failed to fetch container view from server', {
              containerId: viewId,
              error: e,
            });
          }
        }

        if (firstChild) {
          Log.debug('[toView] Database container detected, navigating to first child', {
            containerId: viewId,
            firstChildId: firstChild.view_id,
          });
          targetViewId = firstChild.view_id;
          targetView = firstChild;
        }
      }

      let url = `/app/${currentWorkspaceId}/${targetViewId}`;
      const searchParams = new URLSearchParams(keepSearch ? window.location.search : undefined);

      if (blockId && targetView) {
        switch (targetView.layout) {
          case ViewLayout.Document:
            searchParams.set('blockId', blockId);
            break;
          case ViewLayout.Grid:
          case ViewLayout.Board:
          case ViewLayout.Calendar:
            searchParams.set('r', blockId);
            break;
          default:
            break;
        }
      }

      if (searchParams.toString()) {
        url += `?${searchParams.toString()}`;
      }

      // Avoid pushing duplicate history entries (also prevents loops when a container has no child).
      if (typeof window !== 'undefined') {
        const currentUrl = `${window.location.pathname}${window.location.search}`;

        if (currentUrl === url) {
          return;
        }
      }

      navigate(url);
    },
    [currentWorkspaceId, navigate, service]
  );

  const getCollabHistory = useCallback(
    async (viewId: string, since?: Date) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('Service not found');
      }

      try {
        const versions = await service.getCollabHistory(currentWorkspaceId, viewId, since);

        return versions;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service]
  );

  const previewCollabVersion = useCallback(
    async (viewId: string, versionId: string, collabType: Types) => {
      if (!currentWorkspaceId || !service) {
        throw new Error('Service not found');
      }

      try {
        const docState = await service.previewCollabVersion(currentWorkspaceId, viewId, versionId, collabType);

        if (!docState) {
          return Promise.reject(new Error('No document state returned'));
        }

        if (collabType === Types.Document) {
          const doc = new Y.Doc() as YDoc;

          doc.version = versionId;

          Y.transact(
            doc,
            () => {
              try {
                Y.applyUpdate(doc, docState);
              } catch (e) {
                Log.error('Error applying Yjs update for document version preview', e);
                throw e;
              }
            }
          );

          return doc;
        }
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, service]
  );

  return {
    loadView,
    bindViewSync,
    toView,
    awarenessMap,
    getViewIdFromDatabaseId,
    getViewReadOnlyStatus: getViewReadOnlyStatusFromOutline,
    getCollabHistory,
    previewCollabVersion,
  };
}
