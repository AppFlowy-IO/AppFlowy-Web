import { getView } from '@/application/services/js-services/http/view-api';
import { View, ViewLayout } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';

export const FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE =
  'This page contains a Form and cannot be duplicated yet because its Form settings would not be preserved.';

export const FORM_DEEP_DUPLICATE_CHECK_FAILED_MESSAGE =
  'Could not verify that this database can be duplicated safely. Refresh the page and try again.';

const FORM_DEEP_DUPLICATE_PREFLIGHT_DEPTH = 50;

type LoadDuplicateSubtree = (workspaceId: string, viewId: string, depth: number) => Promise<View>;

/**
 * Generic page duplication is server-driven and currently omits the Form view
 * configuration stored in the database Y.Doc. Database-tab duplication has a
 * separate, Form-aware path and must not use this guard.
 */
export function isUnsafeFormDeepDuplicate(view: View | null | undefined): boolean {
  if (!view) return false;
  const pending = [view];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop();

    if (!current || visited.has(current.view_id)) continue;
    visited.add(current.view_id);
    if (current.layout === ViewLayout.Form) return true;
    pending.push(...current.children);
  }

  return false;
}

export async function assertGenericDeepDuplicateIsSafe({
  workspaceId,
  viewId,
  knownView,
  loadFreshView = getView,
}: {
  workspaceId: string;
  viewId: string;
  knownView?: View | null;
  loadFreshView?: LoadDuplicateSubtree;
}): Promise<void> {
  if (isUnsafeFormDeepDuplicate(knownView)) {
    throw new Error(FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE);
  }

  let freshView: View;

  try {
    // Generic page duplication includes descendants. Refresh a deep subtree
    // even when the selected page is a Document or Space: a nested database
    // may contain a Form whose Yjs-only settings the server copy would omit.
    freshView = await loadFreshView(workspaceId, viewId, FORM_DEEP_DUPLICATE_PREFLIGHT_DEPTH);
  } catch {
    throw new Error(FORM_DEEP_DUPLICATE_CHECK_FAILED_MESSAGE);
  }

  if (isUnsafeFormDeepDuplicate(freshView)) {
    throw new Error(FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE);
  }

  // Every database has at least one view. An empty container response means the
  // safety check did not receive the child metadata it needs, so fail closed.
  if (isDatabaseContainer(freshView) && freshView.children.length === 0) {
    throw new Error(FORM_DEEP_DUPLICATE_CHECK_FAILED_MESSAGE);
  }
}
