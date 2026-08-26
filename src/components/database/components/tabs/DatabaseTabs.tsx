import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { useDuplicateDatabaseView, useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { View, YjsDatabaseKey } from '@/application/types';
import {
  getDatabaseIdFromExtra,
  isDatabaseContainer,
  isEmbeddedDatabaseViewWithoutChildren,
} from '@/application/view-utils';
import { ReactComponent as RelationIcon } from '@/assets/icons/relation.svg';
import { findView } from '@/components/_shared/outline/utils';
import { type ReorderResult } from '@/components/_shared/reorder/useReorderMonitor';
import RenameModal from '@/components/app/view-actions/RenameModal';
import { DatabaseActions } from '@/components/database/components/conditions';
import { DatabaseViewTabs } from '@/components/database/components/tabs/DatabaseViewTabs';
import DeleteViewConfirm from '@/components/database/components/tabs/DeleteViewConfirm';
import { useOpenDatabaseAsPage } from '@/components/database/hooks';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
    const database = useDatabase();
    const views = database?.get(YjsDatabaseKey.views);
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
    const duplicateView = useDuplicateDatabaseView();
    const [meta, setMeta] = useState<View | null>(null);
    const [pendingEmbeddedName, setPendingEmbeddedName] = useState<{ viewId: string; name: string } | null>(null);
    const scrollLeftPadding = context.paddingStart;
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<string | null>(null);
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
    const [menuViewId, setMenuViewId] = useState<string | null>(null);
    const [duplicatingViewId, setDuplicatingViewId] = useState<string | null>(null);

    // Used to trigger a scroll in the child component
    const [pendingScrollToViewId, setPendingScrollToViewId] = useState<string | null>(null);

    // Inline editing state for the embedded database title.
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');
    const titleInputRef = useRef<HTMLInputElement>(null);

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

    // Folder/outline names are the tab-label source of truth, matching desktop:
    // desktop renames only ever update the folder view, while the database
    // collab's view name keeps its creation-time layout default ("Grid",
    // "Board", ...). The Yjs name is only a fallback for views missing from
    // the outline. Renames stay live because folder changes stream in through
    // OUTLINE_LOADED / VIEW_META_CHANGED and patch `meta`.
    const viewNameById = useMemo(() => {
      if (!meta) return undefined;

      if (isDatabaseContainer(meta) && !isEmbeddedDatabaseViewWithoutChildren(meta)) {
        const mapping: Record<string, string> = {};

        for (const child of meta.children ?? []) {
          mapping[child.view_id] = child.name;
        }

        return mapping;
      }

      return { [meta.view_id]: meta.name };
    }, [meta]);

    useEffect(() => {
      void reloadView();
    }, [reloadView]);

    useEffect(() => {
      if (
        pendingEmbeddedName &&
        meta?.view_id === pendingEmbeddedName.viewId &&
        meta.name === pendingEmbeddedName.name
      ) {
        setPendingEmbeddedName(null);
      }
    }, [meta, pendingEmbeddedName]);

    useEffect(() => {
      setPendingEmbeddedName(null);
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

    // An inline database owns an embedded container with child views. A linked
    // database is the embedded leaf itself (including legacy Web metadata that
    // incorrectly marks that leaf as a container).
    const embeddedReferenceMeta =
      context.isDocumentBlock && meta?.view_id === databasePageId && isEmbeddedDatabaseViewWithoutChildren(meta)
        ? meta
        : null;
    const embeddedDatabaseMeta =
      context.isDocumentBlock && isDatabaseContainer(meta) && !embeddedReferenceMeta ? meta : null;
    const embeddedTitleMeta = embeddedReferenceMeta ?? embeddedDatabaseMeta;
    const embeddedDatabaseRawName = embeddedTitleMeta
      ? pendingEmbeddedName?.viewId === embeddedTitleMeta.view_id
        ? pendingEmbeddedName.name
        : embeddedTitleMeta.name
      : '';
    const embeddedDatabaseName = embeddedDatabaseRawName.trim() || t('untitled');
    const embeddedDatabaseViewId = embeddedTitleMeta?.view_id;
    const canRenameEmbeddedTitle = Boolean(embeddedTitleMeta && !readOnly && updateContainerPage);
    const embeddedReferenceDatabaseId = embeddedReferenceMeta
      ? getDatabaseIdFromExtra(embeddedReferenceMeta) ?? database?.get(YjsDatabaseKey.id)
      : undefined;
    const {
      canOpen: canOpenOriginalDatabase,
      isOpening: isOpeningOriginalDatabase,
      openDatabaseAsPage: openOriginalDatabase,
    } = useOpenDatabaseAsPage({
      databaseId: embeddedReferenceDatabaseId,
      fallbackViewId: embeddedReferenceMeta?.view_id,
    });

    const startEditingTitle = useCallback(() => {
      setTitleDraft(embeddedDatabaseRawName);
      setEditingTitle(true);
    }, [embeddedDatabaseRawName]);

    const cancelEditingTitle = useCallback(() => {
      setEditingTitle(false);
      setTitleDraft('');
    }, []);

    const commitTitle = useCallback(async () => {
      if (!editingTitle || !embeddedDatabaseViewId || !updateContainerPage) return;

      const nextName = titleDraft.trim();
      const currentName = embeddedDatabaseRawName.trim();

      setEditingTitle(false);

      // An empty title is not a rename — restore the previous name.
      if (!nextName || nextName === currentName) return;

      try {
        await updateContainerPage(embeddedDatabaseViewId, { name: nextName });
        setPendingEmbeddedName({ viewId: embeddedDatabaseViewId, name: nextName });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    }, [editingTitle, embeddedDatabaseViewId, embeddedDatabaseRawName, titleDraft, updateContainerPage]);

    // Focus and select deterministically once the input is mounted. Doing this
    // here (rather than on a timer) avoids racing any other focus handler, which
    // would otherwise collapse the selection and make typing append to the old
    // name instead of replacing it.
    useEffect(() => {
      if (!editingTitle) return;

      const input = titleInputRef.current;

      if (!input) return;

      input.focus();
      input.select();
    }, [editingTitle]);

    // Stop editing if the database this title belongs to changes underneath us.
    useEffect(() => {
      setEditingTitle(false);
    }, [embeddedDatabaseViewId]);

    const handleViewAdded = useCallback(
      (viewId: string, insertBeforeViewId?: string) => {
        const viewIdsWithoutAddedView = viewIds.filter((existingViewId) => existingViewId !== viewId);
        const appendedViewIds = [...viewIdsWithoutAddedView, viewId];
        const insertBeforeIndex = insertBeforeViewId ? viewIdsWithoutAddedView.indexOf(insertBeforeViewId) : -1;
        let nextViewIds = viewIds.includes(viewId) ? viewIds : appendedViewIds;

        if (insertBeforeIndex >= 0) {
          nextViewIds = [
            ...viewIdsWithoutAddedView.slice(0, insertBeforeIndex),
            viewId,
            ...viewIdsWithoutAddedView.slice(insertBeforeIndex),
          ];
        }

        // For embedded databases, notify the parent immediately.
        onViewAddedToDatabase?.(viewId);

        // Update embedded block data before selecting the new view so the
        // database context already allows the new ID.
        onViewIdsChanged?.(nextViewIds);

        // DatabaseViews initially appends every created view. Reapply the
        // duplicate's source-relative position locally and, when available,
        // persist the same move in the folder hierarchy.
        if (insertBeforeIndex >= 0 && onReorderTabs) {
          const fromIndex = appendedViewIds.indexOf(viewId);
          const toIndex = nextViewIds.indexOf(viewId);

          if (fromIndex !== toIndex) {
            onReorderTabs({
              movedId: viewId,
              prevId: toIndex > 0 ? nextViewIds[toIndex - 1] : null,
              nextIds: nextViewIds,
              fromIndex,
              toIndex,
            });
          }
        }

        setSelectedViewId?.(viewId);
        setPendingScrollToViewId(viewId);
      },
      [onReorderTabs, onViewAddedToDatabase, onViewIdsChanged, setSelectedViewId, viewIds]
    );

    const duplicateDatabaseView = useCallback(
      async (viewId: string) => {
        if (!context.createDatabaseView || !views || duplicatingViewId) return;
        const sourceName = viewNameById?.[viewId] ?? views.get(viewId)?.get(YjsDatabaseKey.name);
        const copySuffix = t('menuAppHeader.pageNameSuffix');
        const duplicatedName = `${sourceName ? String(sourceName).trim() : 'View'} (${copySuffix})`;

        onBeforeViewAddedToDatabase?.();
        setDuplicatingViewId(viewId);
        setMenuViewId(null);

        try {
          const duplicatedViewId = await duplicateView(viewId, duplicatedName);

          handleViewAdded(duplicatedViewId, viewId);
          toast.success(t('button.duplicateSuccessfully'));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t('document.plugins.subPage.errors.failedDuplicatePage'));
        } finally {
          setDuplicatingViewId(null);
          onAfterViewAddedToDatabase?.();
        }
      },
      [
        context.createDatabaseView,
        duplicateView,
        duplicatingViewId,
        handleViewAdded,
        onAfterViewAddedToDatabase,
        onBeforeViewAddedToDatabase,
        t,
        viewNameById,
        views,
      ]
    );

    return (
      <div
        ref={ref}
        className={TAB_BAR_CLASS_NAME}
        style={{
          paddingLeft: scrollLeftPadding === undefined ? 96 : scrollLeftPadding,
          paddingRight: scrollLeftPadding === undefined ? 96 : scrollLeftPadding,
        }}
      >
        {embeddedTitleMeta ? (
          <h3
            data-testid='embedded-database-title'
            className='flex w-full items-center pb-3 text-xl font-semibold text-text-primary'
          >
            {embeddedReferenceMeta ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t('tooltip.viewDataBase')}
                    className='mr-1.5 h-6 w-6'
                    data-testid='embedded-database-open-original'
                    disabled={!canOpenOriginalDatabase}
                    loading={isOpeningOriginalDatabase}
                    onClick={() => void openOriginalDatabase()}
                    onMouseDown={(event) => event.stopPropagation()}
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                  >
                    <RelationIcon aria-hidden='true' className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('tooltip.viewDataBase')}</TooltipContent>
              </Tooltip>
            ) : null}
            <div className='min-w-0 flex-1'>
              {canRenameEmbeddedTitle ? (
                editingTitle ? (
                  <input
                    ref={titleInputRef}
                    data-testid='embedded-database-title-input'
                    className='w-full bg-transparent text-xl font-semibold text-text-primary outline-none'
                    value={titleDraft}
                    placeholder={t('untitled')}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => void commitTitle()}
                    // The title lives inside the document editor; keep its keys and
                    // pointer events from reaching the surrounding Slate editor.
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();

                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void commitTitle();
                        return;
                      }

                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEditingTitle();
                      }
                    }}
                  />
                ) : (
                  <button
                    type='button'
                    data-testid='embedded-database-title-rename'
                    className='w-full cursor-text rounded-200 text-left hover:bg-fill-list-hover'
                    onClick={startEditingTitle}
                  >
                    {embeddedDatabaseName}
                  </button>
                )
              ) : (
                embeddedDatabaseName
              )}
            </div>
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
            onDuplicateView={context.createDatabaseView ? duplicateDatabaseView : undefined}
            duplicateDisabled={Boolean(duplicatingViewId)}
            pendingScrollToViewId={pendingScrollToViewId}
            setPendingScrollToViewId={setPendingScrollToViewId}
            onReorderTabs={onReorderTabs}
            onBeforeViewAdded={onBeforeViewAddedToDatabase}
            onAfterViewAdded={onAfterViewAddedToDatabase}
            onViewAdded={handleViewAdded}
          />

          <div
            className='mb-1 ml-auto'
            data-testid='database-actions-container'
            style={{ opacity: readOnly || showActions ? 1 : 0 }}
          >
            <DatabaseActions />
          </div>
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
                  setPendingEmbeddedName({ viewId, name: payload.name });
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
