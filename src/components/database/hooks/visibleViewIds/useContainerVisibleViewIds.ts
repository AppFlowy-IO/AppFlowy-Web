import { useMemo } from 'react';

import { View } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';
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
}

interface UseContainerVisibleViewIdsResult {
  /**
   * The container view if the current view is a database container
   * or a child of a database container. Undefined otherwise.
   */
  containerView: View | undefined;
  /**
   * For database containers: the container's children view IDs.
   * For standalone databases: undefined (show all non-embedded views).
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
}: UseContainerVisibleViewIdsProps): UseContainerVisibleViewIdsResult {
  const containerView = useMemo((): View | undefined => {
    if (!outline || !view) return undefined;

    // Check if current view is a container
    if (isDatabaseContainer(view)) {
      return view;
    }

    // Check if parent is a container
    const parentId = view.parent_view_id;

    if (!parentId) {
      return undefined;
    }

    const parent = findView(outline, parentId);

    // Return parent if it's a container, otherwise undefined
    return parent && isDatabaseContainer(parent) ? parent : undefined;
  }, [outline, view]);

  const visibleViewIds = useMemo(() => {
    if (!containerView) return undefined;
    return containerView.children.map((child) => child.view_id);
  }, [containerView]);

  return { containerView, visibleViewIds };
}
