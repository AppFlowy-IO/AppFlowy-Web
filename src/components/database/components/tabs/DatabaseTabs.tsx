import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, View, ViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';
import { findView } from '@/components/_shared/outline/utils';
import RenameModal from '@/components/app/view-actions/RenameModal';
import { DatabaseActions } from '@/components/database/components/conditions';
import { DatabaseViewTabs } from '@/components/database/components/tabs/DatabaseViewTabs';
import DeleteViewConfirm from '@/components/database/components/tabs/DeleteViewConfirm';

export interface DatabaseTabBarProps {
  viewIds: string[];
  selectedViewId?: string;
  setSelectedViewId?: (viewId: string) => void;
  viewName?: string;
  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant.
   */
  databasePageId: string;
  hideConditions?: boolean;
  /**
   * Callback when a new view is added to the database.
   * Used by embedded databases to update state immediately before Yjs sync.
   */
  onViewAddedToDatabase?: (viewId: string) => void;
  /**
   * Callback when view IDs change (views added or removed).
   * Used to update the block data in embedded database blocks.
   */
  onViewIdsChanged?: (viewIds: string[]) => void;
}

export const DatabaseTabs = forwardRef<HTMLDivElement, DatabaseTabBarProps>(
  (
    { viewIds, databasePageId, selectedViewId, setSelectedViewId, viewName: _viewName, onViewAddedToDatabase, onViewIdsChanged },
    ref
  ) => {
    const views = useDatabase()?.get(YjsDatabaseKey.views);
    const context = useDatabaseContext();
    const { loadViewMeta, navigateToView, readOnly, showActions = true, eventEmitter } = context;
    const updatePage = useUpdateDatabaseView();
    const [meta, setMeta] = useState<View | null>(null);
    const scrollLeftPadding = context.paddingStart;
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<string | null>(null);
    const [renameViewId, setRenameViewId] = useState<string | null>(null);
    const [menuViewId, setMenuViewId] = useState<string | null>(null);

    // Used to trigger a scroll in the child component
    const [pendingScrollToViewId, setPendingScrollToViewId] = useState<string | null>(null);

    const reloadView = useCallback(async () => {
      if (!loadViewMeta) return;

      try {
        const current = await loadViewMeta(databasePageId);

        if (!current) return;

        // Prefer the database container meta when this view is inside a container.
        if (isDatabaseContainer(current)) {
          setMeta(current);
          return current;
        }

        const parentId = current.parent_view_id;

        if (parentId) {
          const parent = await loadViewMeta(parentId);

          if (isDatabaseContainer(parent)) {
            setMeta(parent);
            return parent;
          }
        }

        setMeta(current);
        return current;
      } catch (e) {
        console.error('[DatabaseTabs] Error loading meta:', e);
        // do nothing
      }
    }, [databasePageId, loadViewMeta]);

    useEffect(() => {
      const handleOutlineLoaded = (outline: View[]) => {
        const current = findView(outline, databasePageId);

        if (!current) return;

        if (isDatabaseContainer(current)) {
          setMeta(current);
          return;
        }

        const parentId = current.parent_view_id;

        if (parentId) {
          const parent = findView(outline, parentId);

          if (isDatabaseContainer(parent)) {
            setMeta(parent);
            return;
          }
        }

        setMeta(current);
      };

      if (eventEmitter) {
        eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
      }

      return () => {
        if (eventEmitter) {
          eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
        }
      };
    }, [databasePageId, eventEmitter, reloadView]);

    const renameView = useMemo(() => {
      if (!renameViewId) return null;

      const fromMeta = meta?.view_id === renameViewId ? meta : meta?.children.find((v) => v.view_id === renameViewId);

      if (fromMeta) return fromMeta;

      // Fallback: build a minimal view from Yjs so rename still works even when meta
      // doesn't include siblings (e.g., embedded linked views without a container).
      const databaseView = views?.get(renameViewId) as YDatabaseView | null;

      if (!databaseView) return null;

      const rawLayoutValue = databaseView.get(YjsDatabaseKey.layout);
      const databaseLayout = Number(rawLayoutValue) as DatabaseViewLayout;
      const computedLayout =
        databaseLayout === DatabaseViewLayout.Board
          ? ViewLayout.Board
          : databaseLayout === DatabaseViewLayout.Calendar
          ? ViewLayout.Calendar
          : ViewLayout.Grid;

      const name = databaseView.get(YjsDatabaseKey.name) || '';

      return {
        view_id: renameViewId,
        name,
        layout: computedLayout,
        parent_view_id: meta?.view_id ?? databasePageId,
        children: [],
        icon: null,
        extra: null,
        is_published: false,
        is_private: false,
      } as View;
    }, [databasePageId, meta, renameViewId, views]);

    const viewNameById = useMemo(() => {
      if (!meta) return undefined;

      // Prefer container children when available.
      if (isDatabaseContainer(meta)) {
        const mapping: Record<string, string> = {};

        for (const child of meta.children ?? []) {
          mapping[child.view_id] = child.name;
        }

        return mapping;
      }

      return {
        [meta.view_id]: meta.name,
      };
    }, [meta]);

    useEffect(() => {
      void reloadView();
    }, [reloadView]);

    const className = useMemo(() => {
      const classList = [
        '-mb-[0.5px] flex items-center  text-text-primary flex-col  max-sm:!px-6 min-w-0 overflow-hidden',
      ];

      return classList.join(' ');
    }, []);

    useEffect(() => {
      const preventDefault = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (menuViewId) {
        document.addEventListener('contextmenu', preventDefault);
      } else {
        document.removeEventListener('contextmenu', preventDefault);
      }

      return () => {
        document.removeEventListener('contextmenu', preventDefault);
      };
    }, [menuViewId]);

    return (
      <div
        ref={ref}
        className={className}
        style={{
          paddingLeft: scrollLeftPadding === undefined ? 96 : scrollLeftPadding,
          paddingRight: scrollLeftPadding === undefined ? 96 : scrollLeftPadding,
        }}
      >
        <div
          className={`database-tabs flex w-full items-center gap-1.5 overflow-hidden border-b border-border-primary`}
        >
          <DatabaseViewTabs
            viewIds={viewIds}
            selectedViewId={selectedViewId}
            setSelectedViewId={setSelectedViewId}
            databasePageId={databasePageId}
            viewNameById={viewNameById}
            views={views}
            readOnly={!!readOnly}
            visibleViewIds={viewIds}
            menuViewId={menuViewId}
            setMenuViewId={setMenuViewId}
            setDeleteConfirmOpen={setDeleteConfirmOpen}
            setRenameViewId={setRenameViewId}
            pendingScrollToViewId={pendingScrollToViewId}
            setPendingScrollToViewId={setPendingScrollToViewId}
            onViewAdded={(viewId) => {
              // For embedded databases, notify parent immediately
              if (onViewAddedToDatabase) {
                onViewAddedToDatabase(viewId);
              }

              // Update the block data with the new view ID BEFORE selecting
              // This ensures allowedViewIds includes the new view when selection happens
              if (onViewIdsChanged) {
                const newViewIds = [...viewIds, viewId];

                onViewIdsChanged(newViewIds);
              }

              // Always call setSelectedViewId to trigger the view change flow
              // This handles both embedded and standalone databases
              if (setSelectedViewId) {
                setSelectedViewId(viewId);
              }

              setPendingScrollToViewId(viewId);
              // Note: We don't call reloadView() here because:
              // 1. The view tab already appears from Yjs (useDatabaseViewsSelector)
              // 2. The outline will be loaded by createDatabaseView in usePageOperations
              // 3. OUTLINE_LOADED event will update meta with view names
              // Calling reloadView() here would cause redundant setMeta() calls.
            }}
          />

          {!readOnly ? (
            <div style={{ opacity: showActions ? 1 : 0 }} className={'mb-1 ml-auto'}>
              <DatabaseActions />
            </div>
          ) : null}
        </div>

        {renameView && Boolean(renameViewId) && (
          <RenameModal
            open={Boolean(renameViewId)}
            onClose={() => {
              setRenameViewId(null);
            }}
            view={renameView}
            updatePage={async (viewId, payload) => {
              await updatePage(viewId, payload);
              void reloadView();
            }}
            viewId={renameViewId || ''}
          />
        )}

        <DeleteViewConfirm
          viewId={deleteConfirmOpen || ''}
          open={Boolean(deleteConfirmOpen)}
          onClose={() => {
            setDeleteConfirmOpen(null);
          }}
          onDeleted={() => {
            // Update the block data with the view ID removed
            if (onViewIdsChanged && deleteConfirmOpen) {
              const newViewIds = viewIds.filter((id) => id !== deleteConfirmOpen);

              onViewIdsChanged(newViewIds);
            }

            if (!deleteConfirmOpen) return;

            const deletedViewId = deleteConfirmOpen;
            const remainingViewIds = viewIds.filter((id) => id !== deletedViewId);
            const nextViewId = remainingViewIds[0] || null;

            // If the active tab was deleted, switch to the next available view.
            if (setSelectedViewId && selectedViewId === deletedViewId && nextViewId) {
              setSelectedViewId(nextViewId);
            }

            // If the "page view" in the URL was deleted, navigate to a remaining child view.
            // Otherwise the route can become a "Page Deleted" placeholder even though the database still has views.
            if (navigateToView && deletedViewId === databasePageId) {
              const safeTarget = (selectedViewId && selectedViewId !== deletedViewId ? selectedViewId : nextViewId) || null;

              if (safeTarget) {
                void navigateToView(safeTarget);
                return;
              }
            }

            void reloadView();
          }}
        />
      </div>
    );
  }
);

DatabaseTabs.displayName = 'DatabaseTabs';
