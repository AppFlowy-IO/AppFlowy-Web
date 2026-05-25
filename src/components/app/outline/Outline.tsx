import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { ViewService } from '@/application/services/domains';
import { View, ViewLayout } from '@/application/types';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { findView, getOutlineExpands, setOutlineExpands } from '@/components/_shared/outline/utils';
import DirectoryStructure from '@/components/_shared/skeleton/DirectoryStructure';
import {
  useAppOutline,
  useCurrentWorkspaceId,
  useLoadedViewIds,
  useToView,
  useLoadViewChildrenBatch,
  useLoadViewChildren,
  useMarkViewChildrenStale,
  useSidebarSelectedViewId,
} from '@/components/app/app.hooks';
import { Favorite } from '@/components/app/favorite';
import { resolveAncestorViewIds } from '@/components/app/hooks/resolveAncestorViewIds';
import SpaceItem from '@/components/app/outline/SpaceItem';
import { ShareWithMe } from '@/components/app/share-with-me';
import ViewActionsPopover from '@/components/app/view-actions/ViewActionsPopover';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Log } from '@/utils/log';

// Lazy: MUI Dialog + import-service (yjs / md parser) shouldn't sit in the Outline bundle.
const ImportDialog = lazy(() => import('@/components/app/import/ImportDialog'));

const AUTO_LOAD_RETRY_DELAY_MS = 15000;

function collectSubtreeViewIds(rootView: View): string[] {
  const ids: string[] = [];
  const stack: View[] = [rootView];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current) continue;
    ids.push(current.view_id);

    for (const child of current.children || []) {
      stack.push(child);
    }
  }

  return ids;
}

export function Outline({ width }: { width: number }) {
  const outline = useAppOutline();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const selectedViewId = useSidebarSelectedViewId();
  const loadedViewIds = useLoadedViewIds();
  const loadViewChildren = useLoadViewChildren();
  const loadViewChildrenBatch = useLoadViewChildrenBatch();
  const markViewChildrenStale = useMarkViewChildrenStale();

  const [menuProps, setMenuProps] = useState<
    | {
        x: number;
        y: number;
        view: View;
        popoverType: {
          category: 'space' | 'page';
          type: 'more' | 'add';
        };
      }
    | undefined
  >(undefined);
  // Import dialog state lives here (not in ViewActionsPopover) because the
  // popover is unmounted as soon as the dropdown closes — clicking the Import
  // menu item closes the dropdown, which would otherwise tear down the dialog
  // before it can render.
  const [importTarget, setImportTarget] = useState<View | undefined>(undefined);
  const handleImportClick = useCallback((view: View) => {
    setImportTarget(view);
  }, []);
  const importLastChildId = importTarget?.children?.[importTarget.children.length - 1]?.view_id;
  const handleImportOpenChange = useCallback((open: boolean) => {
    if (!open) setImportTarget(undefined);
  }, []);

  const revealedViewIdRef = useRef<string | undefined>(undefined);
  // Latest outline, read by the async reveal walk below. Kept in a ref so the
  // walk isn't torn down every time the outline updates (e.g. as it lazy-loads
  // the very branch the walk is populating).
  const outlineRef = useRef(outline);

  useEffect(() => {
    outlineRef.current = outline;
  });

  const loadingViewIdsRef = useRef<Set<string>>(new Set());
  const autoLoadRetryAfterRef = useRef<Map<string, number>>(new Map());
  const validatingRestoreIdsRef = useRef<Set<string>>(new Set());
  const validatedExistingRestoreIdsRef = useRef<Set<string>>(new Set());
  const [loadingRevision, setLoadingRevision] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const loadingViewIds = useMemo(() => loadingViewIdsRef.current, [loadingRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  const [expandViewIds, setExpandViewIds] = React.useState<string[]>(Object.keys(getOutlineExpands()));
  const [pendingAutoLoadIds, setPendingAutoLoadIds] = useState<string[]>(Object.keys(getOutlineExpands()));

  useEffect(() => {
    const restoredExpandedIds = Object.keys(getOutlineExpands());

    setExpandViewIds(restoredExpandedIds);
    setPendingAutoLoadIds(restoredExpandedIds);
    loadingViewIdsRef.current = new Set();
    autoLoadRetryAfterRef.current = new Map();
    validatingRestoreIdsRef.current = new Set();
    validatedExistingRestoreIdsRef.current = new Set();
    revealedViewIdRef.current = undefined;
    setLoadingRevision((r) => r + 1);
  }, [currentWorkspaceId]);

  // Expand the given ancestor ids and route them through the startup auto-load
  // path. Expanding alone only flips the UI flag — queuing them in
  // pendingAutoLoadIds is what makes the existing cascade fetch + merge each
  // node's children top-down, so an unloaded branch actually renders.
  const expandAncestors = useCallback((ancestorIds: string[]) => {
    if (ancestorIds.length === 0) return;

    // Persist expand state outside the state updaters below — updater functions
    // must stay pure (React may invoke them more than once). setOutlineExpands
    // is idempotent, so writing every ancestor (not only newly-added ones) is
    // safe, and it mirrors how toggleExpandView persists expand state.
    ancestorIds.forEach((id) => setOutlineExpands(id, true));

    setExpandViewIds((prev) => {
      const prevSet = new Set(prev);
      const missing = ancestorIds.filter((id) => !prevSet.has(id));

      return missing.length === 0 ? prev : [...prev, ...missing];
    });

    setPendingAutoLoadIds((prev) => {
      const prevSet = new Set(prev);
      const missing = ancestorIds.filter((id) => !prevSet.has(id));

      return missing.length === 0 ? prev : [...prev, ...missing];
    });
  }, []);

  // Reveal the active view in the sidebar by expanding its ancestor folders.
  // This is what makes the tree open to the page you land on — e.g. the
  // last-viewed page that `/app` auto-redirects to on load.
  //
  // Fast path: the whole ancestor chain is already in the loaded tree.
  // Slow path: the view (or part of its branch) isn't in the shallow (depth=1)
  // outline — walk parent_view_id from remote to resolve the chain, then expand
  // + lazy-load down to it. If a node can't be resolved (deleted / no access),
  // we leave the sidebar as-is rather than forcing it open.
  //
  // The ref gate keeps this to once per selected view: it runs on navigation,
  // not on every outline change, so a folder the user manually collapses while
  // staying on the same page won't snap back open.
  useEffect(() => {
    if (!selectedViewId || !currentWorkspaceId) return;
    if (revealedViewIdRef.current === selectedViewId) return;

    let cancelled = false;

    void resolveAncestorViewIds({
      selectedViewId,
      workspaceId: currentWorkspaceId,
      outline: outlineRef.current || [],
      fetchView: (workspaceId, viewId) => ViewService.get(workspaceId, viewId),
    }).then((ancestorIds) => {
      if (cancelled) return;

      // Mark revealed only once the walk finishes, so a transient unmount
      // (e.g. StrictMode's mount → unmount → mount) doesn't cancel the only
      // walk and then gate the retry. null means the chain couldn't be
      // resolved — leave the sidebar as-is; an empty array means nothing to
      // expand.
      revealedViewIdRef.current = selectedViewId;
      if (!ancestorIds) return;
      expandAncestors(ancestorIds);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedViewId, currentWorkspaceId, expandAncestors]);

  // Validate restored expanded IDs that are not in the current tree and prune only truly stale IDs.
  // This avoids keeping deleted/moved IDs forever, while preserving valid deep IDs.
  useEffect(() => {
    if (!outline || outline.length === 0 || !loadViewChildrenBatch || pendingAutoLoadIds.length === 0) return;

    const unknownIds = pendingAutoLoadIds.filter((id) => {
      if (findView(outline, id)) return false;
      if (validatedExistingRestoreIdsRef.current.has(id)) return false;
      if (validatingRestoreIdsRef.current.has(id)) return false;
      return true;
    });

    if (unknownIds.length === 0) return;

    unknownIds.forEach((id) => validatingRestoreIdsRef.current.add(id));

    void loadViewChildrenBatch(unknownIds)
      .then((views) => {
        const existingIds = new Set((views || []).map((view) => view.view_id));
        const staleIds = unknownIds.filter((id) => !existingIds.has(id));

        existingIds.forEach((id) => validatedExistingRestoreIdsRef.current.add(id));

        if (staleIds.length === 0) return;

        const staleSet = new Set(staleIds);

        staleIds.forEach((id) => {
          setOutlineExpands(id, false);
          loadingViewIdsRef.current.delete(id);
          autoLoadRetryAfterRef.current.delete(id);
        });

        setPendingAutoLoadIds((prev) => {
          const next = prev.filter((id) => !staleSet.has(id));

          return next.length === prev.length ? prev : next;
        });
        setExpandViewIds((prev) => {
          const next = prev.filter((id) => !staleSet.has(id));

          return next.length === prev.length ? prev : next;
        });
        setLoadingRevision((r) => r + 1);
      })
      .catch(() => {
        // Keep restored expand ids on transient failures; do not prune.
      })
      .finally(() => {
        unknownIds.forEach((id) => validatingRestoreIdsRef.current.delete(id));
      });
  }, [outline, pendingAutoLoadIds, loadViewChildrenBatch]);

  // Drop startup pending ids as soon as they are confirmed loaded.
  useEffect(() => {
    setPendingAutoLoadIds((prev) => {
      const next = prev.filter((id) => !loadedViewIds?.has(id));

      return next.length === prev.length ? prev : next;
    });
  }, [loadedViewIds]);

  // Auto-load only the restored expanded ids from startup state.
  // Manual expand clicks should use single-view loading path only.
  const autoLoadState = useMemo(() => {
    if (!outline || outline.length === 0 || !loadViewChildren) {
      return {
        fetchableAutoLoadIds: [] as string[],
        nextRetryAt: null as number | null,
      };
    }

    let nextRetryAt: number | null = null;
    const fetchableAutoLoadIds = pendingAutoLoadIds.filter((id) => {
      if (loadedViewIds?.has(id)) return false;
      if (loadingViewIdsRef.current.has(id)) return false;
      if (!findView(outline, id)) return false;

      const retryAfter = autoLoadRetryAfterRef.current.get(id) ?? 0;

      if (nowMs < retryAfter) {
        if (nextRetryAt === null || retryAfter < nextRetryAt) {
          nextRetryAt = retryAfter;
        }

        return false;
      }

      return true;
    });

    return {
      fetchableAutoLoadIds,
      nextRetryAt,
    };
  }, [pendingAutoLoadIds, outline, loadViewChildren, loadedViewIds, nowMs]);
  const { fetchableAutoLoadIds, nextRetryAt } = autoLoadState;

  // Schedule a wake-up at nearest retry time so blocked ids can refetch.
  useEffect(() => {
    if (!nextRetryAt) return;

    const delayMs = Math.max(0, nextRetryAt - Date.now());
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, delayMs + 10);

    return () => {
      window.clearTimeout(timer);
    };
  }, [nextRetryAt]);

  // Startup/outline restore: fetch expanded nodes that are currently in tree.
  // As deeper expanded nodes appear after parent fetches, this effect runs again.
  useEffect(() => {
    if (fetchableAutoLoadIds.length === 0 || !loadViewChildren) return;

    for (const id of fetchableAutoLoadIds) {
      loadingViewIdsRef.current.add(id);
      autoLoadRetryAfterRef.current.set(id, Date.now() + AUTO_LOAD_RETRY_DELAY_MS);
    }

    setLoadingRevision((r) => r + 1);

    if (loadViewChildrenBatch && fetchableAutoLoadIds.length > 1) {
      void loadViewChildrenBatch(fetchableAutoLoadIds)
        .catch(() => {
          // No-op: retry scheduling is driven by retryAfter timestamps.
        })
        .finally(() => {
          for (const id of fetchableAutoLoadIds) {
            loadingViewIdsRef.current.delete(id);
          }

          setLoadingRevision((r) => r + 1);
        });
      return;
    }

    void Promise.allSettled(fetchableAutoLoadIds.map((id) => loadViewChildren(id))).then(() => {
      for (const id of fetchableAutoLoadIds) {
        loadingViewIdsRef.current.delete(id);
      }

      setLoadingRevision((r) => r + 1);
    });
  }, [fetchableAutoLoadIds, loadViewChildren, loadViewChildrenBatch]);

  const toggleExpandView = useCallback((id: string, isExpanded: boolean) => {
    const collapsedSubtreeIds = !isExpanded
      ? (() => {
          const rootView = findView(outline ?? [], id);

          return rootView ? collectSubtreeViewIds(rootView) : [id];
        })()
      : [id];
    const collapsedSubtreeSet = new Set(collapsedSubtreeIds);

    // Manual interaction should not be handled by startup auto-load path.
    setPendingAutoLoadIds((prev) => {
      const next = prev.filter((viewId) => !collapsedSubtreeSet.has(viewId));

      return next.length === prev.length ? prev : next;
    });

    if (isExpanded) {
      setOutlineExpands(id, true);
      setExpandViewIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    } else {
      collapsedSubtreeIds.forEach((viewId) => setOutlineExpands(viewId, false));
      setExpandViewIds((prev) => {
        const next = prev.filter((viewId) => !collapsedSubtreeSet.has(viewId));

        return next.length === prev.length ? prev : next;
      });
      Log.debug('[Outline] [manual-expand] collapse node', {
        viewId: id,
        collapsedSubtreeIds,
      });
      markViewChildrenStale?.(id);
    }

    // Lazy load children when expanding a view that hasn't been loaded yet
    if (isExpanded && loadViewChildren) {
      const alreadyLoaded = loadedViewIds?.has(id) ?? false;

      Log.debug('[Outline] [manual-expand] expand node', {
        viewId: id,
        alreadyLoaded,
      });

      if (alreadyLoaded) return;

      Log.debug('[Outline] [manual-expand] requesting single subtree', {
        viewId: id,
        depth: 1,
      });

      // Call loadViewChildren first — it adds to loadingViewIdsRef synchronously
      // before the first await. Adding here *before* the call would trip its
      // in-flight dedup guard and silently skip the API request.
      void loadViewChildren(id).finally(() => {
        loadingViewIdsRef.current.delete(id);
        setLoadingRevision((r) => r + 1);
      });

      // Trigger shimmer UI — loadViewChildren has already set loadingViewIdsRef.
      setLoadingRevision((r) => r + 1);
    }
  }, [loadViewChildren, loadedViewIds, markViewChildrenStale, outline]);
  const { t } = useTranslation();

  const renderActions = useCallback(
    ({ hovered, view }: { hovered: boolean; view: View }) => {
      const isSpace = view?.extra?.is_space;
      const layout = view?.layout;

      const onClick = (e: React.MouseEvent<HTMLButtonElement>, type: 'more' | 'add') => {
        const target = e.currentTarget as HTMLButtonElement;
        const rect = target.getBoundingClientRect();
        const x = rect.left;
        const y = rect.top + rect.height;

        setMenuProps({
          x,
          y,
          view,
          popoverType: {
            type,
            category: isSpace ? 'space' : 'page',
          },
        });
      };

      const shouldHidden = !hovered && menuProps?.view.view_id !== view.view_id;

      // For testing purposes, always show the button if it has a data-testid
      // This is a temporary workaround until we can properly simulate hover in tests
      const isTestEnvironment = typeof window !== 'undefined' && 'Cypress' in window;

      if (shouldHidden && !isTestEnvironment) return null;

      return (
        <div onClick={(e) => e.stopPropagation()} className={'flex items-center px-2'}>
          <Tooltip disableHoverableContent delayDuration={500}>
            <TooltipTrigger asChild>
              <Button
                data-testid={isSpace ? 'inline-more-actions' : 'page-more-actions'}
                variant={'ghost'}
                size={'icon-sm'}
                onClick={(e) => {
                  onClick(e, 'more');
                }}
              >
                <MoreIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isSpace ? t('space.manage') : t('menuAppHeader.moreButtonToolTip')}</TooltipContent>
          </Tooltip>
          {layout === ViewLayout.Document ? (
            <Tooltip disableHoverableContent delayDuration={500}>
              <TooltipTrigger asChild>
                <Button
                  data-testid='inline-add-page'
                  variant={'ghost'}
                  size={'icon-sm'}
                  onClick={(e) => {
                    onClick(e, 'add');
                  }}
                >
                  <PlusIcon />
                </Button>
              </TooltipTrigger>

              <TooltipContent>{isSpace ? t('sideBar.addAPage') : t('menuAppHeader.addPageTooltip')}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      );
    },
    [menuProps, t]
  );

  const toView = useToView();

  const onClickView = useCallback(
    (viewId: string) => {
      void toView(viewId);
    },
    [toView]
  );

  return (
    <>
      <div className={'folder-views flex w-full flex-1 flex-col px-[8px] pb-[10px] pt-1'}>
        <Favorite />
        <ShareWithMe width={width - 20} />
        {!outline || outline.length === 0 ? (
          <div
            style={{
              width: width - 20,
            }}
          >
            <DirectoryStructure />
          </div>
        ) : (
          outline
            .filter((view) => !view.extra?.is_hidden_space)
            .map((view) => (
              <SpaceItem
                view={view}
                key={view.view_id}
                width={width - 20}
                renderExtra={renderActions}
                expandIds={expandViewIds}
                toggleExpand={toggleExpandView}
                onClickView={onClickView}
                loadingViewIds={loadingViewIds}
                loadedViewIds={loadedViewIds}
              />
            ))
        )}
      </div>
      {menuProps &&
        createPortal(
          <ViewActionsPopover
            popoverType={menuProps.popoverType}
            view={menuProps.view}
            open={Boolean(menuProps)}
            onOpenChange={(open) => {
              if (!open) {
                setMenuProps(undefined);
              }
            }}
            onImportClick={handleImportClick}
          >
            <div
              style={{
                width: '24px',
                height: '5px',
                position: 'absolute',
                pointerEvents: menuProps ? 'auto' : 'none',
                top: menuProps ? menuProps.y : 0,
                left: menuProps ? menuProps.x : 0,
                zIndex: menuProps ? 1 : -1,
              }}
            />
          </ViewActionsPopover>,
          document.body
        )}
      {importTarget && (
        <Suspense fallback={null}>
          <ImportDialog
            open={Boolean(importTarget)}
            parentViewId={importTarget.view_id}
            prevViewId={importLastChildId}
            onOpenChange={handleImportOpenChange}
          />
        </Suspense>
      )}
    </>
  );
}

export default Outline;
