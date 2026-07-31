import { forwardRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { APP_EVENTS } from '@/application/constants';
import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { UIVariant, View, YjsDatabaseKey } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';
import { findView } from '@/components/_shared/outline/utils';
import { type ReorderResult } from '@/components/_shared/reorder/useReorderMonitor';
import RenameModal from '@/components/app/view-actions/RenameModal';
import { DatabaseActions } from '@/components/database/components/conditions';
import { DatabaseViewTabs } from '@/components/database/components/tabs/DatabaseViewTabs';
import DeleteViewConfirm from '@/components/database/components/tabs/DeleteViewConfirm';

const TAB_BAR_CLASS_NAME =
  '-mb-[0.5px] flex items-center  text-text-primary flex-col  max-sm:!px-6 min-w-0 overflow-hidden';

interface RenameTarget {
  viewId: string;
  name: string;
  isContainer: boolean;
}

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
  onBeforeViewAddedToDatabase?: () => void;
  onAfterViewAddedToDatabase?: () => void;
  /**
   * Callback when view IDs change (views added or removed).
   * Used to update the block data in embedded database blocks.
   */
  onViewIdsChanged?: (viewIds: string[]) => void;
  /** Persist a tab reorder (optimistic order + folder/localStorage). */
  onReorderTabs?: (result: ReorderResult) => void;
}

export const DatabaseTabs = forwardRef<HTMLDivElement, DatabaseTabBarProps>(
  (
    {
      viewIds,
      databasePageId,
      selectedViewId,
      setSelectedViewId,
      viewName: _viewName,
      onViewAddedToDatabase,
      onBeforeViewAddedToDatabase,
      onAfterViewAddedToDatabase,
      onViewIdsChanged,
      onReorderTabs,
    },
    ref
  ) => {
    const { t } = useTranslation();
    const views = useDatabase()?.get(YjsDatabaseKey.views);
    const context = useDatabaseContext();
    const {
      loadViewMeta,
      navigateToView,
      readOnly,
      showActions = true,
      eventEmitter,
      updatePage: updateContainerPage,
    } = context;
    const updateDatabaseView = useUpdateDatabaseView();
    const [meta, setMeta] = useState<View | null>(null);
    const [pendingContainerName, setPendingContainerName] = useState<{ viewId: string; name: string } | null>(null);
    const scrollLeftPadding = context.paddingStart;
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<string | null>(null);
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
    const [menuViewId, setMenuViewId] = useState<string | null>(null);

    // Used to trigger a scroll in the child component
    const [pendingScrollToViewId, setPendingScrollToViewId] = useState<string | null>(null);

    const updateRenameTargetFromMeta = useCallback((nextMeta: View) => {
      setRenameTarget((current) => {
        if (!current) return current;

        const currentView =
          nextMeta.view_id === current.viewId
            ? nextMeta
            : nextMeta.children.find((child) => child.view_id === current.viewId);

        if (!currentView || current.name === currentView.name) return current;

        return { ...current, name: currentView.name };
      });
    }, []);

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

    useEffect(() => {
      const handleViewMetaChanged = (updatedView: View) => {
        setMeta((current) => {
          if (!current) return current;

          if (current.view_id === updatedView.view_id) {
            return {
              ...current,
              ...updatedView,
              children: current.children,
            };
          }

          const childIndex = current.children.findIndex((child) => child.view_id === updatedView.view_id);

          if (childIndex < 0) return current;

          const children = [...current.children];

          children[childIndex] = {
            ...children[childIndex],
            ...updatedView,
            children: children[childIndex].children,
          };

          return { ...current, children };
        });
        updateRenameTargetFromMeta(updatedView);
      };

      if (eventEmitter) {
        eventEmitter.on(APP_EVENTS.VIEW_META_CHANGED, handleViewMetaChanged);
      }

      return () => {
        if (eventEmitter) {
          eventEmitter.off(APP_EVENTS.VIEW_META_CHANGED, handleViewMetaChanged);
        }
      };
    }, [eventEmitter, updateRenameTargetFromMeta]);

    const openRenameModal = useCallback(
      (view: View) => {
        const fromMeta =
          meta?.view_id === view.view_id ? meta : meta?.children.find((child) => child.view_id === view.view_id);

        // The live tab name wins over lagging outline metadata. Only retain
        // interaction state; current metadata continues to live in `meta`.
        setRenameTarget({
          viewId: view.view_id,
          name: view.name,
          isContainer: isDatabaseContainer(fromMeta ?? view),
        });
      },
      [meta]
    );

    const viewNameById = (() => {
      if (!meta) return undefined;

      // Outline metadata can lag behind the database collab after a rename.
      // In the editable app, only use it as a fallback for views that are not
      // loaded in Yjs. Published pages intentionally prefer outline names.
      if (isDatabaseContainer(meta)) {
        const mapping: Record<string, string> = {};

        for (const child of meta.children ?? []) {
          if (context.variant === UIVariant.Publish || !views?.has(child.view_id)) {
            mapping[child.view_id] = child.name;
          }
        }

        return mapping;
      }

      return context.variant !== UIVariant.Publish && views?.has(meta.view_id)
        ? undefined
        : {
            [meta.view_id]: meta.name,
          };
    })();

    useEffect(() => {
      void reloadView();
    }, [reloadView]);

    useEffect(() => {
      if (
        pendingContainerName &&
        meta?.view_id === pendingContainerName.viewId &&
        meta.name === pendingContainerName.name
      ) {
        setPendingContainerName(null);
      }
    }, [meta, pendingContainerName]);

    useEffect(() => {
      setPendingContainerName(null);
    }, [databasePageId]);

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

    const embeddedDatabaseMeta = context.isDocumentBlock && isDatabaseContainer(meta) ? meta : null;
    const embeddedDatabaseRawName = embeddedDatabaseMeta
      ? pendingContainerName?.viewId === embeddedDatabaseMeta.view_id
        ? pendingContainerName.name
        : embeddedDatabaseMeta.name
      : '';
    const embeddedDatabaseName = embeddedDatabaseRawName.trim() || t('untitled');

    return (
      <div
        ref={ref}
        className={TAB_BAR_CLASS_NAME}
        style={{
          paddingLeft: scrollLeftPadding === undefined ? 96 : scrollLeftPadding,
          paddingRight: scrollLeftPadding === undefined ? 96 : scrollLeftPadding,
        }}
      >
        {embeddedDatabaseMeta ? (
          <h3 data-testid='embedded-database-title' className='w-full pb-3 text-xl font-semibold text-text-primary'>
            {!readOnly && updateContainerPage ? (
              <button
                type='button'
                data-testid='embedded-database-title-rename'
                className='w-full cursor-pointer text-left'
                onClick={() =>
                  setRenameTarget({
                    viewId: embeddedDatabaseMeta.view_id,
                    name: embeddedDatabaseRawName,
                    isContainer: true,
                  })
                }
              >
                {embeddedDatabaseName}
              </button>
            ) : (
              embeddedDatabaseName
            )}
          </h3>
        ) : null}
        <div className={`database-tabs flex w-full items-center gap-1.5 overflow-hidden border-b border-border-primary`}>
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
            setRenameView={openRenameModal}
            pendingScrollToViewId={pendingScrollToViewId}
            setPendingScrollToViewId={setPendingScrollToViewId}
            onReorderTabs={onReorderTabs}
            onBeforeViewAdded={onBeforeViewAddedToDatabase}
            onAfterViewAdded={onAfterViewAddedToDatabase}
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

        {renameTarget && (
          <RenameModal
            open
            onClose={() => {
              setRenameTarget(null);
            }}
            view={renameTarget}
            updatePage={async (viewId, payload) => {
              if (renameTarget.isContainer) {
                if (!updateContainerPage) {
                  throw new Error('Database container rename is unavailable');
                }

                await updateContainerPage(viewId, payload);
                if (payload.name) {
                  setPendingContainerName({ viewId, name: payload.name });
                }

                return;
              }

              await updateDatabaseView(viewId, payload);
              void reloadView();
            }}
            viewId={renameTarget.viewId}
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
              const safeTarget =
                (selectedViewId && selectedViewId !== deletedViewId ? selectedViewId : nextViewId) || null;

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
