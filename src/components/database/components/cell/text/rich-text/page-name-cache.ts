import type { LoadViewMeta } from '@/application/types';

/**
 * Names of the pages Text cells mention, so a save writes a mention's
 * current page name (what its chip shows) without waiting for a lookup.
 * Shared by the cell editors of a workspace: an editor reloads the names it
 * needs when it opens and follows renames while it is open (see
 * RichTextCellEditor), so a rename since the last edit is never saved as the
 * old name.
 */

// A page that could not be named (no access, deleted, outside the
// workspace, or named "") is looked up again only after this long, not on
// every keystroke.
export const PAGE_NAME_RETRY_MS = 60_000;

const names = new Map<string, string>();
const retryAt = new Map<string, number>();
const pending = new Map<string, Promise<void>>();

function cacheKey(workspaceId: string, pageId: string) {
  return `${workspaceId}/${pageId}`;
}

export function getCachedPageName(workspaceId: string, pageId: string) {
  return names.get(cacheKey(workspaceId, pageId));
}

/** A save must join refreshes even when an older cached or stored title exists. */
export function isPageNameLoading(workspaceId: string, pageId: string) {
  return pending.has(cacheKey(workspaceId, pageId));
}

/** Whether the page could not be named recently; saves then use the stored title. */
export function isPageNameUnavailable(workspaceId: string, pageId: string) {
  const at = retryAt.get(cacheKey(workspaceId, pageId));

  return at !== undefined && at > Date.now();
}

/** Records a page's current name; an empty or missing one counts as unavailable. */
export function setCachedPageName(workspaceId: string, pageId: string, name: string | null | undefined) {
  const key = cacheKey(workspaceId, pageId);

  // Accepted metadata (including rename events) supersedes any older lookup.
  // The request's identity check also prevents its cleanup from removing a
  // replacement lookup started after this update.
  pending.delete(key);

  if (name) {
    names.set(key, name);
    retryAt.delete(key);
    return;
  }

  names.delete(key);
  retryAt.set(key, Date.now() + PAGE_NAME_RETRY_MS);
}

/**
 * Looks the pages up. `refresh` reloads names already known as well (an
 * editor opening); otherwise only unknown ones are loaded. Either way a page
 * that could not be named recently is skipped, and a lookup already running
 * is shared.
 */
export function loadPageNames(
  workspaceId: string,
  pageIds: string[],
  loadViewMeta: LoadViewMeta,
  { refresh = false }: { refresh?: boolean } = {}
): Promise<void> {
  return Promise.all(
    pageIds.map((pageId) => {
      const key = cacheKey(workspaceId, pageId);

      const running = pending.get(key);

      if (running) return running;
      if (isPageNameUnavailable(workspaceId, pageId)) return undefined;
      if (!refresh && names.has(key)) return undefined;

      const remember = (name: string | null | undefined) => {
        if (pending.get(key) === request) setCachedPageName(workspaceId, pageId, name);
      };

      const request = loadViewMeta(pageId)
        .then(
          (view) => remember(view?.name),
          () => remember(undefined)
        )
        .finally(() => {
          if (pending.get(key) === request) pending.delete(key);
        });

      pending.set(key, request);
      return request;
    })
  ).then(() => undefined);
}

/** Forgets every name (tests). */
export function clearPageNameCache() {
  names.clear();
  retryAt.clear();
  pending.clear();
}
