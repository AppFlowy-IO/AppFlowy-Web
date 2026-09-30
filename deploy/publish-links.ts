/**
 * Resolves the published URLs of the pages a server-rendered page links to
 * (sub-page blocks and page mentions), so the SSR body can emit real <a href>
 * links that crawlers follow to the rest of a site.
 *
 * The snapshot only knows view ids; the published URL of each one takes an
 * extra upstream lookup. That work is bounded (target count, concurrency, a
 * hard deadline) and cached briefly, and every failure degrades to what the
 * page rendered before: the page name without a link.
 */

import { type PublishedViewRoute } from './api';

/** Most link targets resolved for one page; the rest render as plain names. */
export const MAX_LINK_TARGETS = 50;
const CONCURRENCY = 6;

// Routes change rarely (publish, unpublish, rename). A short TTL keeps a burst
// of crawler requests from re-resolving the same links each time, while an
// unpublished or renamed page stops being linked within a minute.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1000;

type CacheEntry = { route: PublishedViewRoute | null; expiresAt: number };

const routeCache = new Map<string, CacheEntry>();

/** Clears the route cache. For tests. */
export const clearViewRouteCache = () => routeCache.clear();

const readCache = (viewId: string, now: number): CacheEntry | undefined => {
  const entry = routeCache.get(viewId);

  if (entry && entry.expiresAt > now) return entry;
  if (entry) routeCache.delete(viewId);

  return undefined;
};

const writeCache = (viewId: string, route: PublishedViewRoute | null, now: number) => {
  routeCache.delete(viewId);
  routeCache.set(viewId, { route, expiresAt: now + CACHE_TTL_MS });

  // Maps iterate in insertion order, so the first key is the oldest entry.
  while (routeCache.size > CACHE_MAX_ENTRIES) {
    const oldest = routeCache.keys().next().value;

    if (oldest === undefined) break;
    routeCache.delete(oldest);
  }
};

export interface ResolveViewHrefsOptions {
  /** Upstream lookup; returns null for "not published", throws for transient errors. */
  fetchRoute: (viewId: string, signal: AbortSignal) => Promise<PublishedViewRoute | null>;
  /** Overall deadline for all lookups; whatever resolved by then is used. */
  timeoutMs: number;
  /**
   * Whether a target's namespace may be linked. A link makes a page
   * discoverable to crawlers, so callers restrict it to namespaces that are
   * already meant to be crawled, never widening exposure beyond them.
   */
  isLinkableNamespace: (namespace: string) => boolean;
  now?: () => number;
}

/**
 * Resolves view ids to relative published-page URLs.
 *
 * @param viewIds - Target view ids, in document order. Only the first
 *   `MAX_LINK_TARGETS` distinct ids are resolved.
 * @param options - Lookup function, deadline and namespace filter.
 * @returns A map of view id → `/namespace/publish-name` for each target that
 *   is published, resolved before the deadline, and in a linkable namespace.
 *   Never throws: failed, slow and filtered targets are simply absent, and the
 *   serializer renders those as plain names.
 */
export const resolveViewHrefs = async (
  viewIds: string[],
  { fetchRoute, timeoutMs, isLinkableNamespace, now = Date.now }: ResolveViewHrefsOptions
): Promise<Map<string, string>> => {
  const routes = new Map<string, PublishedViewRoute | null>();
  const pending: string[] = [];

  for (const viewId of [...new Set(viewIds)].slice(0, MAX_LINK_TARGETS)) {
    const cached = readCache(viewId, now());

    if (cached) routes.set(viewId, cached.route);
    else pending.push(viewId);
  }

  if (pending.length > 0) {
    const controller = new AbortController();
    const queue = [...pending];

    const worker = async () => {
      for (let viewId = queue.shift(); viewId !== undefined; viewId = queue.shift()) {
        // Past the deadline: leave the rest of the queue alone rather than
        // starting lookups that are doomed to be aborted.
        if (controller.signal.aborted) return;

        try {
          const route = await fetchRoute(viewId, controller.signal);

          if (controller.signal.aborted) return;

          routes.set(viewId, route);
          writeCache(viewId, route, now());
        } catch {
          // Transient failure (or aborted at the deadline): no link, not cached.
        }
      }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });

    await Promise.race([Promise.all(Array.from({ length: CONCURRENCY }, worker)), deadline]);
    clearTimeout(timer);
    // Stop any lookups still in flight; results arriving after this are ignored.
    controller.abort();
  }

  const hrefs = new Map<string, string>();

  for (const [viewId, route] of routes) {
    if (!route || !isLinkableNamespace(route.namespace)) continue;

    hrefs.set(viewId, `/${encodeURIComponent(route.namespace)}/${encodeURIComponent(route.publishName)}`);
  }

  return hrefs;
};
