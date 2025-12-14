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
  return (
    layout === ViewLayout.Grid ||
    layout === ViewLayout.Board ||
    layout === ViewLayout.Calendar
  );
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
export function isReferencedDatabaseView(
  view: View | null | undefined,
  parentView: View | null | undefined
): boolean {
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

  const nonEmbeddedChildIds = children
    .filter((child) => !isEmbeddedView(child))
    .map((child) => child.view_id);

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
