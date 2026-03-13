import { createContext } from 'react';

import { AppendBreadcrumb, View } from '@/application/types';

/**
 * Navigation state context — changes on every page navigation.
 *
 * **Provider:** `AppBusinessLayer`
 *
 * **Change frequency:** HIGH — updates whenever the user navigates to a
 * different view or opens/closes a page modal.
 *
 * Holds the currently active view ID, breadcrumb trail, view error states,
 * and the page-modal machinery.
 *
 * **Hooks:**
 * - `useAppViewId()` — current route view ID
 * - `useAppRendered()` — whether the current view has finished rendering
 * - `useOnRendered()` — callback to mark rendering complete
 * - `useAppendBreadcrumb()` — push a view onto the breadcrumb trail
 * - `useBreadcrumb()` — the breadcrumb trail (optional, no throw)
 * - `useViewErrorStatus()` — memoized `{ notFound, deleted }`
 * - `useOpenPageModal()` — open a view in a modal overlay
 * - `useOpenModalViewId()` — the view ID currently shown in the modal
 */
export interface AppNavigationContextType {
  /** The view ID from the current route (e.g. `/app/:workspaceId/:viewId`). */
  viewId?: string;
  /** Ordered breadcrumb trail of ancestor views. */
  breadcrumbs?: View[];
  /** Push a view onto the breadcrumb trail. */
  appendBreadcrumb?: AppendBreadcrumb;
  /** Whether the current view's main content has finished rendering. */
  rendered?: boolean;
  /** Callback for the view component to signal that rendering is complete. */
  onRendered?: () => void;
  /** True when the requested view was not found (404). */
  notFound?: boolean;
  /** True when the requested view exists but has been soft-deleted. */
  viewHasBeenDeleted?: boolean;
  /** The view ID currently displayed in the page modal overlay, if any. */
  openPageModalViewId?: string;
  /** Open a view in the page modal overlay. */
  openPageModal?: (viewId: string) => void;
}

export const AppNavigationContext = createContext<AppNavigationContextType | null>(null);
