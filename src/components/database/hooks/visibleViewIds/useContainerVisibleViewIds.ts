import { useMemo } from 'react';

import { filterOwnedTabViewIds } from '@/application/database-yjs/dashboard-owned-views';
import { View } from '@/application/types';
import {
  isDashboardOwnedView,
  isDatabaseContainer,
  isLinkedDatabaseViewUnderDocument,
} from '@/application/view-utils';
import { findView } from '@/components/_shared/outline/utils';

interface UseContainerVisibleViewIdsProps {
  /**
   * The current view from the outline
   */
  view: View | null | undefined;
  /**
   * The full outline tree
   */
  outline: View[] | null | undefined;
  /**
   * Parent id from the active view metadata. Used when the outline is shallow
   * and does not currently include the active database child view.
   */
  parentViewId?: string;
  /**
   * Database id from the active view metadata. Used as a compatibility
   * fallback only when parent identity is unavailable.
   */
  databaseId?: string;
  /**
   * Embedded database views should not resolve to another database's sidebar
   * container just because they share the same database id.
   */
  embedded?: boolean;
}

interface UseContainerVisibleViewIdsResult {
  /**
   * The container view if the current view is a database container
   * or a child of a database container. Undefined otherwise.
   */
  containerView: View | undefined;
  /**
   * For database containers: the container's children view IDs, without the
   * views a dashboard owns (only the opened view when it is one of those).
   * For a document-owned link: its opened view only. For standalone database
   * roots: undefined (show all non-embedded views).
   */
  visibleViewIds: string[] | undefined;
}

/**
 * Hook to determine visible view IDs for database containers.
 *
 * This hook handles the case where a database is accessed via its container view
 * (a view with `is_database_container: true`). In this case, the visible views
 * are the container's children.
 *
 * For standalone databases (no container), returns undefined to show all
 * non-embedded views.
 *
 * @example
 * // Database container with Grid and Board tabs
 * const { containerView, visibleViewIds } = useContainerVisibleViewIds({ view, outline });
 * // visibleViewIds: ['grid-view-id', 'board-view-id']
 * // containerView: { view_id: 'container-id', children: [...] }
 *
 * @example
 * // Standalone database (no container)
 * const { containerView, visibleViewIds } = useContainerVisibleViewIds({ view, outline });
 * // visibleViewIds: undefined
 * // containerView: undefined
 */
export function useContainerVisibleViewIds({
  view,
  outline,
  parentViewId,
  databaseId,
  embedded,
}: UseContainerVisibleViewIdsProps): UseContainerVisibleViewIdsResult {
  const containerView = useMemo((): View | undefined => {
    if (!outline) return undefined;

    // Check if current view is a container
    if (view && isDatabaseContainer(view)) {
      return view;
    }

    // Check if parent is a container
    const parentId = view?.parent_view_id || parentViewId;

    if (parentId) {
      const parent = findView(outline, parentId);

      if (parent && isDatabaseContainer(parent)) {
        return parent;
      }
    }

    // Linked views can live under a document while sharing the source's row
    // store. Its container owns a different tab list; borrowing that list
    // replaces this route's selection with the source's first tab. A known
    // parent remains authoritative even before its outline branch arrives.
    if (parentId || !databaseId || embedded) {
      return undefined;
    }

    const stack = [...outline];

    while (stack.length > 0) {
      const current = stack.shift();

      if (!current) continue;
      if (isDatabaseContainer(current) && current.extra?.database_id === databaseId) {
        return current;
      }

      stack.push(...(current.children || []));
    }

    return undefined;
  }, [databaseId, embedded, outline, parentViewId, view]);

  const openedViewId = view?.view_id;
  const visibleViewIds = useMemo(() => {
    if (!containerView) {
      const parentId = view?.parent_view_id || parentViewId;
      const parent = parentId && outline ? findView(outline, parentId) : undefined;

      // A linked route opens that document's view, not every view in the row
      // store. An explicit list also retains embedded tabs that the legacy
      // standalone selector would hide.
      return openedViewId && parent && !parent.extra?.is_space && isLinkedDatabaseViewUnderDocument(view, parent)
        ? [openedViewId]
        : undefined;
    }

    if (containerView.children.length === 0) return undefined;
    const ownedViewIds = new Set(
      containerView.children.filter((child) => isDashboardOwnedView(child)).map((child) => child.view_id)
    );

    // Dashboard-owned widget views are not tabs (WP05 §1.2).
    return filterOwnedTabViewIds(
      containerView.children.map((child) => child.view_id),
      openedViewId,
      (viewId) => ownedViewIds.has(viewId) || (viewId === openedViewId && isDashboardOwnedView(view))
    );
  }, [containerView, openedViewId, outline, parentViewId, view]);

  return { containerView, visibleViewIds };
}
