/**
 * View utility functions for database container support.
 *
 * These utilities mirror the Desktop/Flutter implementation in view_ext.dart
 * to ensure consistent behavior across platforms.
 *
 * Database Container behavior reference:
 * - AppFlowy-Premium/frontend/doc/context/database_container_behavior.md
 * - Scenario 1: Sidebar create → creates container with child view
 * - Scenario 2: New DB in doc → creates container, returns embedded child view
 * - Scenario 3: Link existing DB → NO container, embedded=true
 * - Scenario 4: Tab bar add view → NO container, adds to existing container
 */

import { View, ViewLayout } from './types';

/**
 * Check if a layout is a database layout (Grid, Board, or Calendar)
 */
export function isDatabaseLayout(layout: ViewLayout): boolean {
  return layout === ViewLayout.Grid || layout === ViewLayout.Board || layout === ViewLayout.Calendar;
}

/**
 * Check if a view is marked as embedded in its extra.
 *
 * Embedded views are created inside documents (e.g. database blocks) and should not
 * appear as tabs in the "source" database container page.
 */
export function isEmbeddedView(view: View | null | undefined): boolean {
  return view?.extra?.embedded === true;
}

/**
 * Check if view is a database container.
 *
 * Container views hold database views as children and appear in the sidebar.
 * When opening a container, the app should auto-select the first child view.
 *
 * @param view The view to check
 * @returns true if this view is a database container
 */
export function isDatabaseContainer(view: View | null | undefined): boolean {
  return view?.extra?.is_database_container === true;
}

/**
 * Get the database_id from a view's extra field.
 *
 * The database_id is stored in the extra field for both:
 * - Database containers (pointing to the underlying database)
 * - Database views (pointing to the database they belong to)
 *
 * @param view The view to get database_id from
 * @returns The database_id or undefined if not found
 */
export function getDatabaseIdFromExtra(view: View | null | undefined): string | undefined {
  return view?.extra?.database_id;
}

/**
 * Check if a view is a referenced database view (child of another database view).
 *
 * Referenced database views show a dot icon instead of normal expand/collapse.
 * This is used for linked database views that share the same database.
 * This mirrors the Flutter implementation: any database view whose parent is
 * also a database layout is treated as "referenced" for sidebar rendering.
 *
 * @param view The view to check
 * @param parentView The parent view (optional)
 * @returns true if this is a referenced database view
 */
export function isReferencedDatabaseView(view: View | null | undefined, parentView: View | null | undefined): boolean {
  if (!parentView || !view) {
    return false;
  }

  return isDatabaseLayout(view.layout) && isDatabaseLayout(parentView.layout);
}

/**
 * Get the first child view of a container for auto-selection.
 *
 * When a user clicks on a database container, the app should automatically
 * open the first child view (typically a Grid, Board, or Calendar).
 *
 * @param view The container view
 * @returns The first child view or undefined if none exists
 */
export function getFirstChildView(view: View | null | undefined): View | undefined {
  if (isDatabaseContainer(view) && view?.children && view.children.length > 0) {
    return view.children[0];
  }

  return undefined;
}

/**
 * Check if a view is a linked database view under a document.
 *
 * These are non-container database views whose parent is a Document.
 * They should not be movable because they are tied to the document content.
 *
 * Note: On web, the backend currently sets `is_database_container: true` for ALL
 * embedded database views, including linked ones. This is different from desktop
 * where linked views have `is_database_container: false`. To work around this,
 * we also check for embedded views without children (linked views don't have children).
 *
 * @param view The view to check
 * @param parentView The parent view
 * @returns true if this is a linked database view under a document
 */
export function isLinkedDatabaseViewUnderDocument(
  view: View | null | undefined,
  parentView: View | null | undefined
): boolean {
  if (!parentView || !view) {
    return false;
  }

  // A linked database view under a document is:
  // 1. A database layout (Grid, Board, Calendar)
  // 2. Under a Document parent
  // 3. Either:
  //    a. Not marked as a container (desktop behavior), OR
  //    b. Embedded with no children (web workaround for incorrect is_database_container flag)
  const isNonContainerView = !isDatabaseContainer(view);
  const hasLoadedChildren = (view.children && view.children.length > 0) || view.has_children === true;
  const isEmbeddedWithNoChildren = isEmbeddedView(view) && !hasLoadedChildren;

  return (
    isDatabaseLayout(view.layout) &&
    parentView.layout === ViewLayout.Document &&
    (isNonContainerView || isEmbeddedWithNoChildren)
  );
}

/**
 * Check if a view can be moved.
 *
 * Mirrors Desktop/Flutter implementation in view_ext.dart canBeDragged().
 *
 * Returns false for:
 * - Case 1: Referenced database views (database inside database)
 * - Case 2: Children of database containers (managed by the database)
 * - Case 3: Linked database views under documents (tied to document content)
 *
 * @param view The view to check
 * @param parentView The parent view
 * @returns true if the view can be moved
 */
export function canBeMoved(view: View | null | undefined, parentView: View | null | undefined): boolean {
  // Case 1: Referenced database views
  if (isReferencedDatabaseView(view, parentView)) {
    return false;
  }

  // Case 2: Children of database containers
  if (isDatabaseContainer(parentView)) {
    return false;
  }

  // Case 3: Linked database views under documents
  if (isLinkedDatabaseViewUnderDocument(view, parentView)) {
    return false;
  }

  return true;
}

/**
 * Check if a view can be reordered within its current parent (sidebar drag).
 *
 * Unlike `canBeMoved`, which governs moving a view to a *different* parent,
 * reordering keeps the view inside its existing parent and only changes its
 * position among its siblings. This is intentionally more permissive than the
 * desktop `canBeDragged` rule (which blocks database-container children from
 * being dragged at all): on web we allow reordering database views *within*
 * their container while still preventing them from escaping it (escaping is
 * impossible because a reorder never leaves the sibling group).
 *
 * Returns true for:
 * - Database container children (reorder database views within the container),
 * - Regular pages within a space or document.
 *
 * Returns false for views that are managed elsewhere and should not be picked
 * up, even though they remain valid drop neighbours:
 * - Referenced database views (database inside another database view),
 * - Linked database views embedded under a document.
 *
 * @param view The view being dragged
 * @param parentView The parent the view currently lives under
 * @returns true if the view can be reordered among its siblings
 */
export function canReorderWithinParent(view: View | null | undefined, parentView: View | null | undefined): boolean {
  if (!view || !parentView) {
    return false;
  }

  // Database container children are reorderable within the container.
  if (isDatabaseContainer(parentView)) {
    return true;
  }

  // Referenced/linked database views are managed by another view; don't allow
  // picking them up (they can still be drop neighbours for sibling pages).
  if (isReferencedDatabaseView(view, parentView)) {
    return false;
  }

  if (isLinkedDatabaseViewUnderDocument(view, parentView)) {
    return false;
  }

  return true;
}

/**
 * Returns the list of database view IDs that should be displayed in the tab bar.
 *
 * Mirrors Desktop/Flutter behavior:
 * - Database containers can have both non-embedded "display views" and embedded views.
 * - Embedded views should not appear as tabs when viewing the source database container.
 * - When navigating directly to an embedded child view from the sidebar, show only that view.
 */
export function getDatabaseTabViewIds(currentViewId: string, containerView: View): string[] {
  const children = containerView.children ?? [];
  const childViewIds = children.map((child) => child.view_id);

  if (childViewIds.length === 0) {
    return [currentViewId];
  }

  const nonEmbeddedChildIds = children.filter((child) => !isEmbeddedView(child)).map((child) => child.view_id);

  const displayViewIds = nonEmbeddedChildIds.length > 0 ? nonEmbeddedChildIds : childViewIds;

  // If the current view is one of the display views, show the full display list.
  if (displayViewIds.includes(currentViewId)) {
    return displayViewIds;
  }

  // If the current view is a child but not a display view, treat it as an embedded
  // view opened as a standalone page and only show itself as a single tab.
  if (childViewIds.includes(currentViewId)) {
    return [currentViewId];
  }

  // Otherwise, treat it as opening the container (or a stale route param).
  return displayViewIds;
}

export function resolveActiveDatabaseViewId({
  databasePageId,
  tabViewId,
  visibleViewIds,
}: {
  databasePageId?: string;
  tabViewId?: string | null;
  visibleViewIds?: string[];
}): string | undefined {
  const hasAuthoritativeVisibleViews = Boolean(visibleViewIds && visibleViewIds.length > 0);

  if (tabViewId && (!hasAuthoritativeVisibleViews || visibleViewIds?.includes(tabViewId))) {
    return tabViewId;
  }

  if (!databasePageId) {
    return visibleViewIds?.[0];
  }

  if (hasAuthoritativeVisibleViews && !visibleViewIds?.includes(databasePageId)) {
    return visibleViewIds?.[0] ?? databasePageId;
  }

  return databasePageId;
}

/**
 * Build the app URL for a view, resolving the workspace from the view's
 * `workspace_id` when available (cross-workspace / shared views) and
 * falling back to the caller-supplied current workspace.
 *
 * Returns `null` when no workspace can be determined.
 */
export function getViewUrl(view: View, currentWorkspaceId?: string): string | null {
  const workspaceId = view.workspace_id || currentWorkspaceId;

  return workspaceId ? `/app/${workspaceId}/${view.view_id}` : null;
}
