import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { View, YDatabaseView, YjsDatabaseKey } from '@/application/types';
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
  ({ viewIds, databasePageId, selectedViewId, setSelectedViewId, onViewAddedToDatabase, onViewIdsChanged }, ref) => {
    const views = useDatabase()?.get(YjsDatabaseKey.views);
    const context = useDatabaseContext();
    const { loadViewMeta, readOnly, showActions = true, eventEmitter } = context;
    const updatePage = useUpdateDatabaseView();
    const [meta, setMeta] = useState<View | null>(null);
    const scrollLeftPadding = context.paddingStart;
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<string | null>(null);
    const [renameViewId, setRenameViewId] = useState<string | null>(null);
    const [menuViewId, setMenuViewId] = useState<string | null>(null);

    // Used to trigger a scroll in the child component
    const [pendingScrollToViewId, setPendingScrollToViewId] = useState<string | null>(null);

    const reloadView = useCallback(async () => {
      if (loadViewMeta) {
        try {
          const meta = await loadViewMeta(databasePageId);

          setMeta(meta);
          return meta;
        } catch (e) {
          console.error('[DatabaseTabs] Error loading meta:', e);
          // do nothing
        }
      }
    }, [databasePageId, loadViewMeta]);

    useEffect(() => {
      const handleOutlineLoaded = (outline: View[]) => {
        const view = findView(outline, databasePageId);

        if (view) {
          setMeta(view);
        }
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
      if (renameViewId === databasePageId) return meta;
      return meta?.children.find((v) => v.view_id === renameViewId);
    }, [databasePageId, meta, renameViewId]);

    const visibleViewIds = useMemo(() => {
      return viewIds.filter((viewId) => {
        const databaseView = views?.get(viewId) as YDatabaseView | null;

        return !!databaseView;
      });
    }, [viewIds, views]);

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
            views={views}
            readOnly={!!readOnly}
            visibleViewIds={visibleViewIds}
            menuViewId={menuViewId}
            setMenuViewId={setMenuViewId}
            setDeleteConfirmOpen={setDeleteConfirmOpen}
            setRenameViewId={setRenameViewId}
            pendingScrollToViewId={pendingScrollToViewId}
            setPendingScrollToViewId={setPendingScrollToViewId}
            onViewAdded={(viewId) => {
              // For embedded databases, first update visibleViewIds immediately
              // This ensures the tab is rendered before we try to select it
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
              void reloadView();
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
            if (!meta) return;

            if (setSelectedViewId) {
              setSelectedViewId(meta.view_id);
            }

            void reloadView();

            // Update the block data with the view ID removed
            if (onViewIdsChanged && deleteConfirmOpen) {
              const newViewIds = viewIds.filter((id) => id !== deleteConfirmOpen);

              onViewIdsChanged(newViewIds);
            }
          }}
        />
      </div>
    );
  }
);

DatabaseTabs.displayName = 'DatabaseTabs';
