import { EventType, on } from '@/application/session/event';
import { getTokenParsed } from '@/application/session/token';
import { View } from '@/application/types';

const ANONYMOUS_SCOPE = 'anonymous';
const NEGATIVE_CACHE_TTL_MS = 30 * 1000;

export type WorkspaceViewMetadataLoader = () => Promise<View | null | undefined>;

export interface ResolveWorkspaceViewMetadataOptions {
  /** Ignore a completed positive/negative result while preserving in-flight deduplication. */
  refresh?: boolean;
}

export interface WorkspaceViewMetadataAccessToken {
  readonly accessEpoch: number;
  readonly userScope: string;
  readonly workspaceId: string;
  readonly workspaceScope: string;
}

type CacheScope = {
  userScope: string;
  workspaceId: string;
  viewId: string;
  workspaceScope: string;
};

type PositiveCacheEntry = CacheScope & {
  source: 'merged' | 'server' | 'targeted';
  view: View;
};

type NegativeCacheOutcome =
  | { kind: 'empty' }
  | {
      kind: 'error';
      error: unknown;
    };

type NegativeCacheEntry = CacheScope & {
  expiresAt: number;
  outcome: NegativeCacheOutcome;
};

type PendingRequest = CacheScope & {
  identity: object;
  promise: Promise<View | undefined>;
};

type WorkspaceEpoch = {
  generation: number;
};

const positiveCache = new Map<string, PositiveCacheEntry>();
const negativeCache = new Map<string, NegativeCacheEntry>();
const pendingRequests = new Map<string, PendingRequest>();
const workspaceEpochs = new Map<string, WorkspaceEpoch>();
const workspaceAccessEpochs = new Map<string, number>();
const untrustedOutlineScopes = new Set<string>();
let sessionGeneration = 0;

function getCurrentUserScope(): string {
  return `${getTokenParsed()?.user.id ?? ANONYMOUS_SCOPE}:${sessionGeneration}`;
}

function getWorkspaceScope(userScope: string, workspaceId: string): string {
  return JSON.stringify([userScope, workspaceId]);
}

function getCacheKey(userScope: string, workspaceId: string, viewId: string): string {
  return JSON.stringify([userScope, workspaceId, viewId]);
}

function getCurrentScope(workspaceId: string, viewId: string): CacheScope {
  const userScope = getCurrentUserScope();

  return {
    userScope,
    workspaceId,
    viewId,
    workspaceScope: getWorkspaceScope(userScope, workspaceId),
  };
}

function getWorkspaceEpoch(workspaceScope: string): WorkspaceEpoch {
  let epoch = workspaceEpochs.get(workspaceScope);

  if (!epoch) {
    epoch = { generation: 0 };
    workspaceEpochs.set(workspaceScope, epoch);
  }

  return epoch;
}

function removeKey(key: string): void {
  pendingRequests.delete(key);
  positiveCache.delete(key);
  negativeCache.delete(key);
}

function createSupersededRequestError(): Error {
  const error = new Error('Workspace view metadata request was superseded');

  error.name = 'AbortError';
  return error;
}

function withoutChildren(view: View): View {
  return { ...view, children: [] };
}

function flattenViewMetadata(views: View | View[]): View[] {
  const flattened: View[] = [];
  const visit = (view: View) => {
    flattened.push(withoutChildren(view));
    view.children?.forEach(visit);
  };

  (Array.isArray(views) ? views : [views]).forEach(visit);
  return flattened;
}

function findViewMetadata(views: View | View[], viewId: string): View | undefined {
  const stack = [...(Array.isArray(views) ? views : [views])];

  while (stack.length > 0) {
    const view = stack.pop();

    if (!view) continue;
    if (view.view_id === viewId) return withoutChildren(view);
    if (view.children?.length) stack.push(...view.children);
  }

  return undefined;
}

function writePositiveEntry(scope: CacheScope, view: View, source: PositiveCacheEntry['source']): void {
  const key = getCacheKey(scope.userScope, scope.workspaceId, scope.viewId);

  positiveCache.set(key, { ...scope, source, view: withoutChildren(view) });
  negativeCache.delete(key);
}

function writeNegativeEntry(scope: CacheScope, outcome: NegativeCacheOutcome): void {
  const key = getCacheKey(scope.userScope, scope.workspaceId, scope.viewId);

  positiveCache.delete(key);
  negativeCache.set(key, {
    ...scope,
    expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS,
    outcome,
  });
}

function getAccessEpoch(workspaceScope: string): number {
  return workspaceAccessEpochs.get(workspaceScope) ?? 0;
}

function bumpAccessEpoch(workspaceScope: string): void {
  workspaceAccessEpochs.set(workspaceScope, getAccessEpoch(workspaceScope) + 1);
}

function primeFlatMetadata(
  workspaceId: string,
  views: View[],
  source: PositiveCacheEntry['source'],
  allowUntrustedOutline = false
): void {
  const userScope = getCurrentUserScope();
  const workspaceScope = getWorkspaceScope(userScope, workspaceId);

  // Permission refreshes can graft previously lazy-loaded descendants onto a
  // new shallow outline. Once access changes, those merged descendants are no
  // longer an authoritative metadata source. Exact folder events, current raw
  // server responses, and resolver results may still refill the cache.
  if (!allowUntrustedOutline && untrustedOutlineScopes.has(workspaceScope)) return;

  getWorkspaceEpoch(workspaceScope);

  for (const view of views) {
    const scope = { userScope, workspaceId, workspaceScope, viewId: view.view_id };
    const key = getCacheKey(userScope, workspaceId, view.view_id);
    const existing = positiveCache.get(key);

    if (source !== 'targeted' && pendingRequests.has(key)) continue;
    if (source === 'server' && existing?.source === 'targeted') continue;
    if (source === 'merged' && (existing?.source !== undefined || negativeCache.has(key))) continue;

    if (source === 'targeted') removeKey(key);
    writePositiveEntry(scope, view, source);
  }
}

/** Return flat metadata already known for the current user and workspace. */
export function getCachedWorkspaceViewMetadata(workspaceId: string, viewId: string): View | undefined {
  const scope = getCurrentScope(workspaceId, viewId);

  return positiveCache.get(getCacheKey(scope.userScope, workspaceId, viewId))?.view;
}

/** Recursively index every materialized outline node as childless metadata. */
export function primeWorkspaceViewMetadata(workspaceId: string, views: View | View[]): void {
  primeFlatMetadata(workspaceId, flattenViewMetadata(views), 'merged');
}

/** Upsert only the supplied view fields; nested children are intentionally ignored. */
export function primeWorkspaceViewMetadataFields(workspaceId: string, views: View | View[]): void {
  // Folder field/add payloads describe the changed view itself and therefore
  // remain authoritative while the outline is trusted. Advance the epoch
  // first so a folder request started before this event cannot overwrite it.
  const userScope = getCurrentUserScope();
  const workspaceScope = getWorkspaceScope(userScope, workspaceId);
  const metadata = (Array.isArray(views) ? views : [views]).map(withoutChildren);

  bumpAccessEpoch(workspaceScope);

  if (untrustedOutlineScopes.has(workspaceScope)) {
    // A field/add frame queued before a broad share or permission event can
    // arrive afterward. Do not let it resurrect even a previously verified
    // view. Removing the exact key also supersedes an older pending resolver;
    // the next mounted header performs a current server read.
    metadata.forEach((view) => removeKey(getCacheKey(userScope, workspaceId, view.view_id)));
    return;
  }

  primeFlatMetadata(workspaceId, metadata, 'targeted', true);
}

/** Capture a user/session-scoped token before starting an authoritative folder request. */
export function captureWorkspaceViewMetadataAccessToken(workspaceId: string): WorkspaceViewMetadataAccessToken {
  const userScope = getCurrentUserScope();
  const workspaceScope = getWorkspaceScope(userScope, workspaceId);

  return {
    accessEpoch: getAccessEpoch(workspaceScope),
    userScope,
    workspaceId,
    workspaceScope,
  };
}

/**
 * Index metadata returned directly by the server when its request started in
 * the current access epoch. Unlike a merged outline, this source cannot carry
 * descendants preserved from before a permission/share change.
 */
export function primeWorkspaceViewMetadataFromServer(
  workspaceId: string,
  views: View | View[],
  token: WorkspaceViewMetadataAccessToken
): boolean {
  const currentUserScope = getCurrentUserScope();
  const currentWorkspaceScope = getWorkspaceScope(currentUserScope, workspaceId);

  if (
    token.userScope !== currentUserScope ||
    token.workspaceId !== workspaceId ||
    token.workspaceScope !== currentWorkspaceScope ||
    token.accessEpoch !== getAccessEpoch(currentWorkspaceScope)
  ) {
    return false;
  }

  primeFlatMetadata(workspaceId, flattenViewMetadata(views), 'server', true);
  return true;
}

/**
 * Resolve one view's flat folder metadata. Positive entries last for the
 * current session, misses retry after a short cooldown, and concurrent callers
 * share one loader invocation.
 */
export async function resolveWorkspaceViewMetadata(
  workspaceId: string,
  viewId: string,
  loader: WorkspaceViewMetadataLoader,
  options: ResolveWorkspaceViewMetadataOptions = {}
): Promise<View | undefined> {
  const scope = getCurrentScope(workspaceId, viewId);
  const { userScope, workspaceScope } = scope;
  const key = getCacheKey(userScope, workspaceId, viewId);
  const pending = pendingRequests.get(key);

  // An authoritative caller still joins an authoritative request started by
  // another normal/sticky header. The permission-change path clears workspace
  // pending entries before it reaches this resolver, so anything present here
  // belongs to the current refresh wave.
  if (pending) return pending.promise;

  if (options.refresh) {
    positiveCache.delete(key);
    negativeCache.delete(key);
  }

  const cached = positiveCache.get(key);

  if (cached) return cached.view;

  const failed = negativeCache.get(key);

  if (failed) {
    if (failed.expiresAt > Date.now()) {
      if (failed.outcome.kind === 'error') throw failed.outcome.error;
      return undefined;
    }

    negativeCache.delete(key);
  }

  // Fence bulk server requests that started before this targeted lookup. The
  // pending entry installed below also prevents a bulk result captured after
  // this point from cancelling the resolver before it settles.
  bumpAccessEpoch(workspaceScope);
  const requestSessionGeneration = sessionGeneration;
  const workspaceEpoch = getWorkspaceEpoch(workspaceScope);
  const requestWorkspaceGeneration = workspaceEpoch.generation;
  const requestIdentity = {};
  const requestScopeIsCurrent = () =>
    sessionGeneration === requestSessionGeneration &&
    getCurrentUserScope() === userScope &&
    workspaceEpoch.generation === requestWorkspaceGeneration;
  const requestIsCurrent = () =>
    requestScopeIsCurrent() && pendingRequests.get(key)?.identity === requestIdentity;
  const getSupersedingPositive = () => positiveCache.get(key)?.view;

  const promise = Promise.resolve()
    .then(loader)
    .then((loadedView): View | undefined => {
      if (!requestIsCurrent()) {
        const replacement = requestScopeIsCurrent() ? getSupersedingPositive() : undefined;

        if (replacement) return replacement;
        throw createSupersededRequestError();
      }

      if (!loadedView) {
        bumpAccessEpoch(workspaceScope);
        writeNegativeEntry(scope, { kind: 'empty' });
        return undefined;
      }

      const requestedView = findViewMetadata(loadedView, viewId);

      if (!requestedView) {
        bumpAccessEpoch(workspaceScope);
        writeNegativeEntry(scope, { kind: 'empty' });
        return undefined;
      }

      bumpAccessEpoch(workspaceScope);
      writePositiveEntry(scope, requestedView, 'targeted');
      return requestedView;
    })
    .catch((error: unknown): View | undefined => {
      if (!requestIsCurrent()) {
        const replacement = requestScopeIsCurrent() ? getSupersedingPositive() : undefined;

        if (replacement) return replacement;
        throw createSupersededRequestError();
      }

      bumpAccessEpoch(workspaceScope);
      writeNegativeEntry(scope, { kind: 'error', error });
      throw error;
    })
    .finally(() => {
      if (pendingRequests.get(key)?.identity === requestIdentity) {
        pendingRequests.delete(key);
      }
    });

  pendingRequests.set(key, {
    ...scope,
    identity: requestIdentity,
    promise,
  });

  return promise;
}

/** Invalidate one view, or every indexed view in a workspace when omitted. */
export function invalidateWorkspaceViewMetadata(workspaceId: string, viewId?: string): void {
  const userScope = getCurrentUserScope();
  const workspaceScope = getWorkspaceScope(userScope, workspaceId);

  if (viewId) {
    bumpAccessEpoch(workspaceScope);
    removeKey(getCacheKey(userScope, workspaceId, viewId));
    return;
  }

  bumpAccessEpoch(workspaceScope);

  const epoch = workspaceEpochs.get(workspaceScope);

  if (epoch) epoch.generation += 1;

  const removeWorkspaceEntries = <T extends CacheScope>(entries: Map<string, T>) => {
    for (const [key, entry] of entries) {
      if (entry.workspaceScope === workspaceScope) entries.delete(key);
    }
  };

  removeWorkspaceEntries(positiveCache);
  removeWorkspaceEntries(negativeCache);
  removeWorkspaceEntries(pendingRequests);
  workspaceEpochs.delete(workspaceScope);
}

/**
 * Clear a workspace after a broad access change and stop merged outline
 * snapshots from refilling it. Server-resolved metadata remains cacheable.
 */
export function markWorkspaceViewMetadataOutlineUntrusted(workspaceId: string): void {
  const userScope = getCurrentUserScope();

  untrustedOutlineScopes.add(getWorkspaceScope(userScope, workspaceId));
  invalidateWorkspaceViewMetadata(workspaceId);
}

/** Clear memory-only metadata and fence every request started by an old session. */
export function clearWorkspaceViewMetadataCache(): void {
  sessionGeneration += 1;
  positiveCache.clear();
  negativeCache.clear();
  pendingRequests.clear();
  workspaceEpochs.clear();
  workspaceAccessEpochs.clear();
  untrustedOutlineScopes.clear();
}

on(EventType.SESSION_INVALID, clearWorkspaceViewMetadataCache);
