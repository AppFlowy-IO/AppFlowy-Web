import { View } from '@/application/types';
import { findAncestors, findView } from '@/components/_shared/outline/utils';

export interface ResolveAncestorViewIdsParams {
  /** The view the sidebar should reveal (the active / selected view). */
  selectedViewId: string;
  /** Workspace root id — the walk stops here and never expands it. */
  workspaceId: string;
  /** The currently loaded (possibly shallow, depth=1) outline tree. */
  outline: View[];
  /**
   * Fetch a single view from remote when it isn't in the loaded outline. Injected
   * so this stays a pure, testable function (production passes `ViewService.get`).
   * Returning `null` (or rejecting) is treated as "not found".
   */
  fetchView: (workspaceId: string, viewId: string) => Promise<View | null>;
}

/**
 * Resolve the ancestor view ids (root → … → the selected view's parent) that
 * must be expanded to reveal `selectedViewId` in the sidebar.
 *
 * - Fast path: the whole chain is already in the loaded tree, so we read it
 *   straight from the outline without any network round-trips.
 * - Slow path: the view (or part of its branch) isn't in the shallow outline —
 *   walk `parent_view_id` upward, preferring the loaded tree and falling back to
 *   `fetchView` per node.
 *
 * Returns:
 * - a (possibly empty) array of ancestor ids to expand — empty means the view
 *   has no ancestors to open (e.g. it's a top-level space); or
 * - `null` when the chain can't be resolved (view deleted / no access),
 *   signalling the caller to leave the sidebar as-is rather than force it open.
 */
export async function resolveAncestorViewIds(params: ResolveAncestorViewIdsParams): Promise<string[] | null> {
  const { selectedViewId, workspaceId, outline, fetchView } = params;

  // Fast path: fully resolvable from the loaded tree (no fetches).
  const localAncestors = findAncestors(outline, selectedViewId);

  if (localAncestors) {
    return localAncestors.slice(0, -1).map((view) => view.view_id);
  }

  // Slow path: walk parent_view_id up to (but not including) the workspace root.
  const ancestorIds: string[] = [];
  const visited = new Set<string>();
  let cursorId: string | undefined = selectedViewId;

  while (cursorId && cursorId !== workspaceId && !visited.has(cursorId)) {
    visited.add(cursorId);

    let view: View | null = findView(outline, cursorId);

    if (!view) {
      try {
        view = await fetchView(workspaceId, cursorId);
      } catch {
        // View not found / no access — leave the sidebar as-is.
        return null;
      }
    }

    if (!view) return null;

    const parentId: string | undefined = view.parent_view_id;

    if (parentId && parentId !== workspaceId) {
      ancestorIds.unshift(parentId);
    }

    cursorId = parentId;
  }

  return ancestorIds;
}
