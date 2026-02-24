import { View } from '@/application/types';

/**
 * Immutably replaces a single view's children in the outline tree.
 * Returns the original array reference if the parentViewId is not found
 * (referential equality check to minimize re-renders).
 */
export function mergeChildrenIntoOutline(
  outline: View[],
  parentViewId: string,
  children: View[],
  hasChildrenOverride?: boolean
): View[] {
  let changed = false;

  const next = outline.map((view) => {
    if (view.view_id === parentViewId) {
      const nextHasChildren = hasChildrenOverride ?? (children.length > 0);

      // Only create a new object if children/has_children actually differ
      if (view.children === children && view.has_children === nextHasChildren) return view;
      changed = true;
      return { ...view, children, has_children: nextHasChildren };
    }

    if (view.children && view.children.length > 0) {
      const nextChildren = mergeChildrenIntoOutline(view.children, parentViewId, children, hasChildrenOverride);

      if (nextChildren !== view.children) {
        changed = true;
        return { ...view, children: nextChildren };
      }
    }

    return view;
  });

  return changed ? next : outline;
}

export interface OutlineMerge {
  parentViewId: string;
  children: View[];
}

/**
 * Applies multiple parent->children merges in a single tree walk.
 * Used for startup restore (batch-fetching children for all expanded views).
 */
export function batchMergeChildrenIntoOutline(
  outline: View[],
  merges: OutlineMerge[]
): View[] {
  if (merges.length === 0) return outline;

  // Build a lookup map for O(1) access
  const mergeMap = new Map<string, View[]>();

  for (const m of merges) {
    mergeMap.set(m.parentViewId, m.children);
  }

  return applyMerges(outline, mergeMap);
}

/**
 * Replace a view's fields in the outline tree (preserving local children).
 * Used for VIEW_FIELDS_CHANGED notifications.
 */
export function updateViewInOutline(
  outline: View[],
  updatedView: View
): View[] {
  let changed = false;

  const next = outline.map((view) => {
    if (view.view_id === updatedView.view_id) {
      changed = true;
      // Merge: use server fields but keep local children (which may be deeper)
      return { ...updatedView, children: view.children };
    }

    if (view.children && view.children.length > 0) {
      const nextChildren = updateViewInOutline(view.children, updatedView);

      if (nextChildren !== view.children) {
        changed = true;
        return { ...view, children: nextChildren };
      }
    }

    return view;
  });

  return changed ? next : outline;
}

/**
 * Add a new view to a parent in the outline tree.
 * Used for VIEW_ADDED notifications.
 */
export function addViewToOutline(
  outline: View[],
  parentId: string,
  newView: View
): View[] {
  let changed = false;

  const next = outline.map((view) => {
    if (view.view_id === parentId) {
      // In lazy outline mode, an unloaded parent can have has_children=true
      // with empty children. Don't materialize a partial child list in that case.
      // Treat has_children undefined as loaded-empty for realtime VIEW_ADDED so
      // new children appear immediately when backend omits explicit false.
      const parentChildrenLoaded = view.children.length > 0 || view.has_children !== true;

      if (!parentChildrenLoaded) {
        if (view.has_children) return view;
        changed = true;
        return { ...view, has_children: true };
      }

      // Don't add duplicates
      if (view.children.some((c) => c.view_id === newView.view_id)) {
        return view;
      }

      changed = true;
      return { ...view, children: [...view.children, newView], has_children: true };
    }

    if (view.children && view.children.length > 0) {
      const nextChildren = addViewToOutline(view.children, parentId, newView);

      if (nextChildren !== view.children) {
        changed = true;
        return { ...view, children: nextChildren };
      }
    }

    return view;
  });

  return changed ? next : outline;
}

/**
 * Filter a parent's children to only include the given IDs (in order).
 * Used for VIEW_REMOVED notifications.
 */
export function removeViewFromOutline(
  outline: View[],
  parentId: string,
  remainingChildIds: string[]
): View[] {
  let changed = false;

  const next = outline.map((view) => {
    if (view.view_id === parentId) {
      const childMap = new Map(view.children.map((c) => [c.view_id, c]));
      const filtered = remainingChildIds
        .map((id) => childMap.get(id))
        .filter((c): c is View => c !== undefined);
      // remainingChildIds comes from server and is authoritative, even if local
      // children are currently unloaded/partial.
      const nextHasChildren = remainingChildIds.length > 0;
      const childrenUnchanged =
        filtered.length === view.children.length &&
        filtered.every((child, index) => child.view_id === view.children[index]?.view_id);
      const hasChildrenUnchanged = view.has_children === nextHasChildren;

      if (childrenUnchanged && hasChildrenUnchanged) return view;
      changed = true;
      return childrenUnchanged
        ? { ...view, has_children: nextHasChildren }
        : { ...view, children: filtered, has_children: nextHasChildren };
    }

    if (view.children && view.children.length > 0) {
      const nextChildren = removeViewFromOutline(view.children, parentId, remainingChildIds);

      if (nextChildren !== view.children) {
        changed = true;
        return { ...view, children: nextChildren };
      }
    }

    return view;
  });

  return changed ? next : outline;
}

/**
 * Reorder a parent's children by the given ID list.
 * Used for CHILDREN_REORDERED notifications.
 */
export function reorderChildrenInOutline(
  outline: View[],
  parentId: string,
  childIds: string[]
): View[] {
  let changed = false;

  const next = outline.map((view) => {
    if (view.view_id === parentId) {
      const childMap = new Map(view.children.map((c) => [c.view_id, c]));
      const reordered = childIds
        .map((id) => childMap.get(id))
        .filter((c): c is View => c !== undefined);

      // Check if order actually changed
      if (
        reordered.length === view.children.length &&
        reordered.every((c, i) => c.view_id === view.children[i]?.view_id)
      ) {
        return view;
      }

      changed = true;
      return { ...view, children: reordered };
    }

    if (view.children && view.children.length > 0) {
      const nextChildren = reorderChildrenInOutline(view.children, parentId, childIds);

      if (nextChildren !== view.children) {
        changed = true;
        return { ...view, children: nextChildren };
      }
    }

    return view;
  });

  return changed ? next : outline;
}

/**
 * Set has_children on a view in the outline tree.
 */
export function setHasChildrenInOutline(
  outline: View[],
  viewId: string,
  value: boolean
): View[] {
  let changed = false;

  const next = outline.map((view) => {
    if (view.view_id === viewId) {
      if (view.has_children === value) return view;
      changed = true;
      return { ...view, has_children: value };
    }

    if (view.children && view.children.length > 0) {
      const nextChildren = setHasChildrenInOutline(view.children, viewId, value);

      if (nextChildren !== view.children) {
        changed = true;
        return { ...view, children: nextChildren };
      }
    }

    return view;
  });

  return changed ? next : outline;
}

function applyMerges(views: View[], mergeMap: Map<string, View[]>): View[] {
  let changed = false;

  const next = views.map((view) => {
    let v = view;

    const newChildren = mergeMap.get(view.view_id);

    if (newChildren !== undefined) {
      const nextHasChildren = newChildren.length > 0;

      if (v.children !== newChildren || v.has_children !== nextHasChildren) {
        v = { ...v, children: newChildren, has_children: nextHasChildren };
        changed = true;
      }
    }

    if (v.children && v.children.length > 0) {
      const nextChildren = applyMerges(v.children, mergeMap);

      if (nextChildren !== v.children) {
        v = { ...v, children: nextChildren };
        changed = true;
      }
    }

    return v;
  });

  return changed ? next : views;
}
