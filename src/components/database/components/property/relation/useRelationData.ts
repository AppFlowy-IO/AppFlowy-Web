import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { parseRelationTypeOption, useDatabaseContext, useFieldSelector } from '@/application/database-yjs';
import { useUpdateRelationTypeOption } from '@/application/database-yjs/dispatch/relation';
import { RelationTypeOption } from '@/application/database-yjs/fields/relation/relation.type';
import {
  getCachedWorkspaceDatabaseCatalog,
  getWorkspaceDatabaseCatalogRevision,
  subscribeWorkspaceDatabaseCatalog,
} from '@/application/services/domains/view';
import { WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { EventType, on } from '@/application/session/event';
import { getTokenParsed } from '@/application/session/token';
import { View } from '@/application/types';

import {
  buildRelationDatabaseCandidates,
  loadRelationDatabaseCandidates,
  RelationDatabaseCandidatesResult,
} from './relationDatabaseCandidates';

import type { EventEmitter } from 'events';

type CandidateRequest = {
  generation: number;
  promise: Promise<RelationDatabaseCandidatesResult>;
};

type OutlineCheck = {
  generation: number;
  promise: Promise<void>;
};

type CandidateSource = {
  loadViews: (() => Promise<View[] | undefined>) | undefined;
  loaderRevision: number;
  outline: View[] | undefined;
  outlineRevision: number;
};

type MetadataSubscriber = {
  hasFallback: () => boolean;
  matches: (view: View) => boolean;
  matchesViewId: (viewId: string) => boolean;
  outlineAccepted: (outline: View[]) => void;
  refresh: () => void;
  restore: (viewId: string) => void;
  suspendBroad: () => void;
  suspendTarget: () => void;
};

type WorkspaceEventBinding = {
  eventEmitter: EventEmitter;
  metadataSubscribers: Set<MetadataSubscriber>;
  workspaceId: string;
};

// The app renders normal and sticky copies of virtualized headers. Keep their
// catalog work and EventEmitter listeners at workspace scope so mounting more
// copies does not repeat the same work or trip EventEmitter's listener limit.
let cachedWorkspaceId: string | null = null;
let cachedResult: RelationDatabaseCandidatesResult | null = null;
let activeWorkspaceId: string | null = null;
let candidateGeneration = 0;
let candidateSourceRevision = 0;
let workspaceEventBinding: WorkspaceEventBinding | null = null;
const candidateRequests = new Map<string, CandidateRequest>();
const candidateSources = new Map<string, CandidateSource>();
const outlineChecks = new Map<string, OutlineCheck>();
const cacheListeners = new Set<() => void>();
const EMPTY_RESULT: RelationDatabaseCandidatesResult = { candidates: [], relations: {}, outline: [], databases: [] };
const SERVER_CATALOG_REVISION = 'server';

function getCachedResult(workspaceId: string): RelationDatabaseCandidatesResult | null {
  return cachedWorkspaceId === workspaceId ? cachedResult : null;
}

function getCurrentCachedResult(workspaceId: string): RelationDatabaseCandidatesResult | null {
  const cached = getCachedResult(workspaceId);
  const catalog = getCachedWorkspaceDatabaseCatalog(workspaceId);

  return cached && catalog && cached.databases === catalog ? cached : null;
}

function getCachedResultForCatalog(
  workspaceId: string,
  catalog: WorkspaceDatabaseWithViews[] | undefined
): RelationDatabaseCandidatesResult | null {
  const cached = getCachedResult(workspaceId);

  return cached && catalog && cached.databases === catalog ? cached : null;
}

function emitCacheChange(): void {
  cacheListeners.forEach((listener) => listener());
}

function detachWorkspaceEventBinding(): void {
  const binding = workspaceEventBinding;

  if (!binding) return;
  binding.eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, handleBoundOutlineLoaded);
  binding.eventEmitter.off(APP_EVENTS.VIEW_META_CHANGED, handleBoundViewMetaChanged);
  binding.eventEmitter.off(APP_EVENTS.VIEW_ACCESS_REVOKED, handleBoundViewAccessRevoked);
  binding.eventEmitter.off(APP_EVENTS.VIEW_ACCESS_RESTORED, handleBoundViewAccessRestored);
  binding.eventEmitter.off(APP_EVENTS.PERMISSION_CHANGED, handleBoundPermissionChanged);
  binding.eventEmitter.off(APP_EVENTS.SHARE_VIEWS_CHANGED, handleBoundShareViewsChanged);
  workspaceEventBinding = null;
}

function prepareWorkspace(workspaceId: string): void {
  if (activeWorkspaceId === workspaceId) return;

  const previousWorkspaceId = activeWorkspaceId;

  activeWorkspaceId = workspaceId;

  if (!previousWorkspaceId) return;

  candidateGeneration += 1;
  candidateRequests.clear();
  candidateSources.clear();
  outlineChecks.clear();

  if (cachedWorkspaceId !== workspaceId) {
    cachedWorkspaceId = null;
    cachedResult = null;
    emitCacheChange();
  }

  if (workspaceEventBinding?.workspaceId !== workspaceId) {
    detachWorkspaceEventBinding();
  }
}

function setCachedResult(workspaceId: string, result: RelationDatabaseCandidatesResult) {
  if (cachedWorkspaceId === workspaceId && cachedResult === result) return;
  cachedWorkspaceId = workspaceId;
  cachedResult = result;
  emitCacheChange();
}

function subscribeToCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

export function clearRelationViewsCache(): void {
  candidateGeneration += 1;
  candidateRequests.clear();
  candidateSources.clear();
  outlineChecks.clear();
  activeWorkspaceId = null;
  cachedWorkspaceId = null;
  cachedResult = null;
  detachWorkspaceEventBinding();
  emitCacheChange();
}

function updateCandidateLoader(workspaceId: string, loadViews: () => Promise<View[] | undefined>): void {
  const previous = candidateSources.get(workspaceId);

  candidateSources.set(workspaceId, {
    loadViews,
    loaderRevision: ++candidateSourceRevision,
    outline: previous?.outline,
    outlineRevision: previous?.outlineRevision ?? 0,
  });
}

function updateCandidateOutline(workspaceId: string, outline: View[]): void {
  const previous = candidateSources.get(workspaceId);

  candidateSources.set(workspaceId, {
    loadViews: previous?.loadViews,
    loaderRevision: previous?.loaderRevision ?? 0,
    outline,
    outlineRevision: ++candidateSourceRevision,
  });
}

async function loadLatestCandidateOutline(workspaceId: string): Promise<View[] | undefined> {
  const source = candidateSources.get(workspaceId);

  if (!source) return undefined;
  if (source.outline && source.outlineRevision > source.loaderRevision) return source.outline;
  if (!source.loadViews) return source.outline;

  const loaderRevision = source.loaderRevision;
  const outlineRevision = source.outlineRevision;
  const loadedOutline = await source.loadViews();
  const latestSource = candidateSources.get(workspaceId);

  if (latestSource?.outline && latestSource.outlineRevision > outlineRevision) return latestSource.outline;

  // A header with a newer context may mount while the previous loader is in
  // flight. Resolve through that latest loader instead of publishing the old
  // closure's result after its owner unmounts.
  if (latestSource && latestSource.loaderRevision > loaderRevision) {
    return loadLatestCandidateOutline(workspaceId);
  }

  if (Array.isArray(loadedOutline)) {
    updateCandidateOutline(workspaceId, loadedOutline);
    return loadedOutline;
  }

  return latestSource?.outline;
}

function refreshCachedOutline(workspaceId: string): Promise<void> {
  const existing = outlineChecks.get(workspaceId);

  if (existing?.generation === candidateGeneration) return existing.promise;

  const generation = candidateGeneration;
  const promise = Promise.resolve()
    .then(() => loadLatestCandidateOutline(workspaceId))
    .then((outline) => {
      if (generation !== candidateGeneration || activeWorkspaceId !== workspaceId || !Array.isArray(outline)) return;

      const current = getCurrentCachedResult(workspaceId);
      const latestOutline = candidateSources.get(workspaceId)?.outline ?? outline;

      if (!current || current.outline === latestOutline) return;
      setCachedResult(workspaceId, buildRelationDatabaseCandidates(current.databases, latestOutline));
    })
    .catch(() => undefined)
    .finally(() => {
      if (outlineChecks.get(workspaceId)?.promise === promise) {
        outlineChecks.delete(workspaceId);
      }
    });
  const check = { generation, promise };

  outlineChecks.set(workspaceId, check);
  return promise;
}

function getCandidateRequest(workspaceId: string): CandidateRequest {
  const existing = candidateRequests.get(workspaceId);

  if (existing?.generation === candidateGeneration) return existing;

  const generation = candidateGeneration;
  const loadLatestOutline = () => loadLatestCandidateOutline(workspaceId);
  const promise = loadRelationDatabaseCandidates({ workspaceId, loadViews: loadLatestOutline })
    .then(async (result) => {
      try {
        // The catalog and outline load in parallel. Re-read the cheap in-memory
        // outline after the catalog settles so an OUTLINE_LOADED event received
        // while there was no candidate snapshot cannot be overwritten by the
        // older outline captured at request start.
        const latestOutline = await loadLatestOutline();

        return Array.isArray(latestOutline) && latestOutline !== result.outline
          ? buildRelationDatabaseCandidates(result.databases, latestOutline)
          : result;
      } catch {
        return result;
      }
    })
    .finally(() => {
      if (candidateRequests.get(workspaceId)?.promise === promise) {
        candidateRequests.delete(workspaceId);
      }
    });
  const request = { generation, promise };

  candidateRequests.set(workspaceId, request);
  return request;
}

function publishCandidateResult(
  workspaceId: string,
  request: CandidateRequest,
  result: RelationDatabaseCandidatesResult
): boolean {
  if (request.generation !== candidateGeneration || activeWorkspaceId !== workspaceId) return true;
  if (getCachedWorkspaceDatabaseCatalog(workspaceId) !== result.databases) return false;

  const latestOutline = candidateSources.get(workspaceId)?.outline;
  const publishResult =
    latestOutline && latestOutline !== result.outline
      ? buildRelationDatabaseCandidates(result.databases, latestOutline)
      : result;
  const current = getCachedResult(workspaceId);

  if (current?.databases === publishResult.databases && current.outline === publishResult.outline) return true;
  setCachedResult(workspaceId, publishResult);
  return true;
}

function handleBoundOutlineLoaded(outline?: View[]): void {
  const binding = workspaceEventBinding;

  if (!binding || !Array.isArray(outline)) return;

  updateCandidateOutline(binding.workspaceId, outline);

  Array.from(binding.metadataSubscribers).forEach((subscriber) => subscriber.outlineAccepted(outline));

  const cached = getCurrentCachedResult(binding.workspaceId);

  if (!cached || cached.outline === outline) return;
  setCachedResult(binding.workspaceId, buildRelationDatabaseCandidates(cached.databases, outline));
}

function handleBoundViewMetaChanged(updatedView?: View): void {
  const binding = workspaceEventBinding;

  if (!binding || !updatedView) return;

  Array.from(binding.metadataSubscribers).forEach((subscriber) => {
    if (subscriber.matches(updatedView)) subscriber.refresh();
  });
}

function handleBoundViewAccessRevoked(payload?: { viewId?: string | null }): void {
  const binding = workspaceEventBinding;
  const viewId = payload?.viewId;

  if (!binding || !viewId) return;

  Array.from(binding.metadataSubscribers).forEach((subscriber) => {
    if (subscriber.matchesViewId(viewId)) subscriber.suspendTarget();
  });
}

function handleBoundViewAccessRestored(payload?: { viewId?: string | null }): void {
  const binding = workspaceEventBinding;
  const viewId = payload?.viewId;

  if (!binding || !viewId) return;

  Array.from(binding.metadataSubscribers).forEach((subscriber) => subscriber.restore(viewId));
}

function handleBoundPermissionChanged(): void {
  const binding = workspaceEventBinding;

  if (!binding) return;

  Array.from(binding.metadataSubscribers).forEach((subscriber) => {
    if (subscriber.hasFallback()) subscriber.suspendBroad();
  });
}

function shareMayAffectCurrentUser(payload?: { emails?: Array<string | null> | null }): boolean {
  const currentEmail = getTokenParsed()?.user.email?.trim().toLowerCase();
  const emails = payload?.emails;

  if (
    !currentEmail ||
    !Array.isArray(emails) ||
    emails.length === 0 ||
    emails.some((email) => typeof email !== 'string' || email.trim().length === 0)
  ) {
    return true;
  }

  return emails.some((email) => email?.trim().toLowerCase() === currentEmail);
}

function handleBoundShareViewsChanged(payload?: { emails?: Array<string | null> | null }): void {
  const binding = workspaceEventBinding;

  if (!binding || !shareMayAffectCurrentUser(payload)) return;

  Array.from(binding.metadataSubscribers).forEach((subscriber) => {
    // Share changes can alter inherited access for descendants, so a payload
    // scoped to an ancestor is still broad from the relation header's point
    // of view. Wait for an accepted outline or explicit restore before using
    // metadata caches again.
    if (subscriber.hasFallback()) subscriber.suspendBroad();
  });
}

function retainWorkspaceEventBinding(
  workspaceId: string,
  eventEmitter: EventEmitter,
  metadataSubscriber: MetadataSubscriber
): () => void {
  if (
    !workspaceEventBinding ||
    workspaceEventBinding.workspaceId !== workspaceId ||
    workspaceEventBinding.eventEmitter !== eventEmitter
  ) {
    detachWorkspaceEventBinding();
    workspaceEventBinding = {
      eventEmitter,
      metadataSubscribers: new Set(),
      workspaceId,
    };
    eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, handleBoundOutlineLoaded);
    eventEmitter.on(APP_EVENTS.VIEW_META_CHANGED, handleBoundViewMetaChanged);
    eventEmitter.on(APP_EVENTS.VIEW_ACCESS_REVOKED, handleBoundViewAccessRevoked);
    eventEmitter.on(APP_EVENTS.VIEW_ACCESS_RESTORED, handleBoundViewAccessRestored);
    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, handleBoundPermissionChanged);
    eventEmitter.on(APP_EVENTS.SHARE_VIEWS_CHANGED, handleBoundShareViewsChanged);
  }

  const binding = workspaceEventBinding;

  binding.metadataSubscribers.add(metadataSubscriber);

  return () => {
    binding.metadataSubscribers.delete(metadataSubscriber);
    if (workspaceEventBinding === binding && binding.metadataSubscribers.size === 0) {
      detachWorkspaceEventBinding();
    }
  };
}

// The cache is keyed by workspace only, while the IndexedDB catalog is keyed by
// user — drop it on session invalidation so a later login as a different user
// cannot be served the previous user's candidates.
on(EventType.SESSION_INVALID, clearRelationViewsCache);

type LoadingState = {
  workspaceId: string;
  fieldId: string;
  enabled: boolean;
  catalogRevision: string;
  catalogSnapshot: WorkspaceDatabaseWithViews[] | undefined;
  loading: boolean;
};

function withLoading(
  workspaceId: string,
  fieldId: string,
  enabled: boolean,
  catalogRevision: string,
  catalogSnapshot: WorkspaceDatabaseWithViews[] | undefined,
  loading: boolean
) {
  return (previous: LoadingState): LoadingState =>
    previous.workspaceId === workspaceId &&
    previous.fieldId === fieldId &&
    previous.enabled === enabled &&
    previous.catalogRevision === catalogRevision &&
    previous.catalogSnapshot === catalogSnapshot &&
    previous.loading === loading
      ? previous
      : { workspaceId, fieldId, enabled, catalogRevision, catalogSnapshot, loading };
}

export interface UseRelationDataOptions {
  enabled?: boolean;
}

export function useRelationData(fieldId: string, options: UseRelationDataOptions = {}) {
  const { enabled = true } = options;
  const { eventEmitter, getViewIdFromDatabaseId, loadViewMeta, loadViews, workspaceId } = useDatabaseContext();
  const { field } = useFieldSelector(fieldId);
  const relationOption: RelationTypeOption | null = field ? parseRelationTypeOption(field) : null;
  const relatedDatabaseId = relationOption?.database_id || null;
  const catalogRevision = useSyncExternalStore(
    subscribeWorkspaceDatabaseCatalog,
    () => getWorkspaceDatabaseCatalogRevision(workspaceId),
    () => SERVER_CATALOG_REVISION
  );
  const catalogSnapshot = getCachedWorkspaceDatabaseCatalog(workspaceId);
  const cachedCandidateResult = useSyncExternalStore(
    subscribeToCache,
    () => getCachedResult(workspaceId) ?? EMPTY_RESULT,
    () => EMPTY_RESULT
  );
  const result =
    cachedCandidateResult !== EMPTY_RESULT &&
    catalogSnapshot &&
    cachedCandidateResult.databases === catalogSnapshot
      ? cachedCandidateResult
      : EMPTY_RESULT;
  const [loadingState, setLoadingState] = useState<LoadingState>(() => ({
    workspaceId,
    fieldId,
    enabled,
    catalogRevision,
    catalogSnapshot,
    loading: enabled && Boolean(fieldId) && !getCachedResultForCatalog(workspaceId, catalogSnapshot),
  }));

  // Effects from a newly enabled picker run in one commit. Derive that
  // activation's loading state synchronously so the fallback effect cannot
  // race ahead of the catalog effect's state update.
  const catalogLoading =
    loadingState.workspaceId === workspaceId &&
    loadingState.fieldId === fieldId &&
    loadingState.enabled === enabled &&
    loadingState.catalogRevision === catalogRevision &&
    loadingState.catalogSnapshot === catalogSnapshot
      ? loadingState.loading
      : enabled && Boolean(fieldId) && !getCachedResultForCatalog(workspaceId, catalogSnapshot);
  const catalogRelatedViewId = relatedDatabaseId ? result.relations[relatedDatabaseId] : null;
  const selectedCandidate = useMemo(
    () => result.candidates.find((candidate) => candidate.databaseId === relatedDatabaseId),
    [relatedDatabaseId, result.candidates]
  );
  const hasSelectedCandidate = Boolean(selectedCandidate);

  type DatabaseViewState = {
    databaseId: string | null;
    parentViewId: string | null;
    viewId: string | null;
    view: View | undefined;
  };
  const [fallbackSelectedView, setFallbackSelectedView] = useState<DatabaseViewState>({
    databaseId: null,
    parentViewId: null,
    viewId: null,
    view: undefined,
  });
  const fallbackSelectedViewRef = useRef(fallbackSelectedView);

  type FallbackAccessState = {
    databaseId: string | null;
    suspension: 'broad' | 'targeted' | null;
  };
  const [fallbackAccess, setFallbackAccess] = useState<FallbackAccessState>({
    databaseId: null,
    suspension: null,
  });
  const fallbackAccessRef = useRef({
    ...fallbackAccess,
    allowOutlineRestore: false,
  });
  const fallbackAccessGenerationRef = useRef(0);
  const authoritativeFallbackRef = useRef<{
    databaseId: string;
    suspension: 'broad' | 'targeted';
  } | null>(null);
  const [fallbackRefreshRevision, setFallbackRefreshRevision] = useState(0);

  type OptimisticDatabaseViewState = {
    catalogRevision: string;
    databaseId: string | null;
    view: View | undefined;
  };
  const [optimisticSelectedView, setOptimisticSelectedView] = useState<OptimisticDatabaseViewState>({
    catalogRevision,
    databaseId: null,
    view: undefined,
  });

  const loadViewMetaRef = useRef(loadViewMeta);
  const loadViewsRef = useRef(loadViews);
  const getViewIdFromDatabaseIdRef = useRef(getViewIdFromDatabaseId);
  const loadCurrentViews = useCallback(async () => loadViewsRef.current?.(), []);
  const onUpdateTypeOption = useUpdateRelationTypeOption(fieldId);
  const onUpdateDatabaseId = useCallback(
    (databaseId: string) => onUpdateTypeOption({ database_id: databaseId }),
    [onUpdateTypeOption]
  );

  useEffect(() => {
    loadViewMetaRef.current = loadViewMeta;
  }, [loadViewMeta]);

  useEffect(() => {
    loadViewsRef.current = loadViews;
  }, [loadViews]);

  useEffect(() => {
    getViewIdFromDatabaseIdRef.current = getViewIdFromDatabaseId;
  }, [getViewIdFromDatabaseId]);

  useEffect(() => {
    fallbackSelectedViewRef.current = fallbackSelectedView;
  }, [fallbackSelectedView]);

  useEffect(() => {
    if (enabled) return;

    // RelationCellMenu disables this hook while it is closed, which also
    // removes its access-event subscriber. Retire the last fallback so an
    // unobserved revoke cannot expose that metadata when the menu reopens and
    // its fresh lookup fails.
    fallbackAccessGenerationRef.current += 1;
    authoritativeFallbackRef.current = null;
    fallbackAccessRef.current = {
      databaseId: relatedDatabaseId,
      allowOutlineRestore: false,
      suspension: null,
    };
    setFallbackAccess((access) =>
      access.databaseId === relatedDatabaseId && access.suspension === null
        ? access
        : { databaseId: relatedDatabaseId, suspension: null }
    );
    const retiredFallback: DatabaseViewState = {
      databaseId: null,
      parentViewId: null,
      viewId: null,
      view: undefined,
    };

    fallbackSelectedViewRef.current = retiredFallback;
    setFallbackSelectedView((fallback) =>
      fallback.databaseId === null &&
      fallback.parentViewId === null &&
      fallback.viewId === null &&
      fallback.view === undefined
        ? fallback
        : retiredFallback
    );
  }, [enabled, relatedDatabaseId, workspaceId]);

  useEffect(() => {
    const access = fallbackAccessRef.current;

    if (access.databaseId === relatedDatabaseId) return;

    fallbackAccessGenerationRef.current += 1;
    fallbackAccessRef.current = {
      databaseId: relatedDatabaseId,
      allowOutlineRestore: false,
      suspension: null,
    };
    authoritativeFallbackRef.current = null;
    setFallbackAccess({ databaseId: relatedDatabaseId, suspension: null });
  }, [relatedDatabaseId, workspaceId]);

  useEffect(() => {
    setOptimisticSelectedView((optimistic) => {
      const isInvalidated = optimistic.catalogRevision !== catalogRevision;
      const isAuthoritative =
        Boolean(selectedCandidate) && optimistic.databaseId === selectedCandidate?.databaseId;

      return isInvalidated || isAuthoritative
        ? { catalogRevision, databaseId: null, view: undefined }
        : optimistic;
    });
  }, [catalogRevision, selectedCandidate]);

  useEffect(() => {
    if (!enabled || !fieldId) {
      setLoadingState(withLoading(workspaceId, fieldId, enabled, catalogRevision, catalogSnapshot, false));
      return;
    }

    prepareWorkspace(workspaceId);
    updateCandidateLoader(workspaceId, loadCurrentViews);

    if (getCachedResultForCatalog(workspaceId, catalogSnapshot)) {
      setLoadingState(withLoading(workspaceId, fieldId, enabled, catalogRevision, catalogSnapshot, false));
      void refreshCachedOutline(workspaceId);
      return;
    }

    let cancelled = false;

    setLoadingState(withLoading(workspaceId, fieldId, enabled, catalogRevision, catalogSnapshot, true));

    void (async () => {
      let request = getCandidateRequest(workspaceId);

      while (!cancelled) {
        const nextResult = await request.promise;

        if (cancelled || publishCandidateResult(workspaceId, request, nextResult)) return;

        // The accepted catalog snapshot changed while this request was in
        // flight. Retry against that snapshot; concurrent headers join the
        // same replacement request through getCandidateRequest.
        request = getCandidateRequest(workspaceId);
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setLoadingState(withLoading(workspaceId, fieldId, enabled, catalogRevision, catalogSnapshot, false));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [catalogRevision, catalogSnapshot, enabled, fieldId, loadCurrentViews, workspaceId]);

  const fallbackRelatedViewId =
    fallbackSelectedView.databaseId === relatedDatabaseId ? fallbackSelectedView.viewId : null;
  const relatedViewId = relatedDatabaseId ? catalogRelatedViewId || fallbackRelatedViewId : null;
  const canLoadFallback = Boolean(loadViewMeta && (catalogRelatedViewId || getViewIdFromDatabaseId));
  const fallbackSuspended =
    fallbackAccess.databaseId === relatedDatabaseId && fallbackAccess.suspension !== null;

  useEffect(() => {
    if (!enabled || !eventEmitter) return;

    const fallbackTargetIds = () => {
      const fallback = fallbackSelectedViewRef.current;

      return new Set(
        [catalogRelatedViewId, fallback.viewId, fallback.parentViewId].filter(
          (viewId): viewId is string => Boolean(viewId)
        )
      );
    };

    const resumeFallback = () => {
      const access = fallbackAccessRef.current;

      if (!relatedDatabaseId || access.databaseId !== relatedDatabaseId || !access.suspension) return;

      fallbackAccessGenerationRef.current += 1;
      authoritativeFallbackRef.current =
        access.suspension === 'broad'
          ? {
              databaseId: relatedDatabaseId,
              suspension: access.suspension,
            }
          : null;
      fallbackAccessRef.current = {
        databaseId: relatedDatabaseId,
        allowOutlineRestore: false,
        suspension: null,
      };
      setFallbackAccess({ databaseId: relatedDatabaseId, suspension: null });
      setFallbackRefreshRevision((revision) => revision + 1);
    };

    const suspendFallback = (suspension: 'broad' | 'targeted') => {
      if (!relatedDatabaseId) return;

      const generation = ++fallbackAccessGenerationRef.current;
      const currentSuspension = fallbackAccessRef.current.suspension;
      const nextSuspension = currentSuspension === 'targeted' ? currentSuspension : suspension;

      authoritativeFallbackRef.current = null;
      fallbackAccessRef.current = {
        databaseId: relatedDatabaseId,
        allowOutlineRestore: false,
        suspension: nextSuspension,
      };
      setFallbackAccess({ databaseId: relatedDatabaseId, suspension: nextSuspension });
      setFallbackSelectedView((fallback) =>
        fallback.databaseId === relatedDatabaseId ? { ...fallback, view: undefined } : fallback
      );
      setOptimisticSelectedView((optimistic) =>
        optimistic.databaseId === relatedDatabaseId
          ? { catalogRevision, databaseId: null, view: undefined }
          : optimistic
      );

      // Ignore an OUTLINE_LOADED emitted synchronously by the same permission
      // event. It can still be the pre-refresh outline. A later accepted
      // outline or VIEW_ACCESS_RESTORED is the evidence that permits reads.
      queueMicrotask(() => {
        const access = fallbackAccessRef.current;

        if (
          fallbackAccessGenerationRef.current === generation &&
          access.databaseId === relatedDatabaseId &&
          access.suspension === 'broad'
        ) {
          fallbackAccessRef.current = { ...access, allowOutlineRestore: true };
        }
      });
    };

    return retainWorkspaceEventBinding(workspaceId, eventEmitter, {
      hasFallback: () => Boolean(relatedDatabaseId && canLoadFallback),
      matches: (updatedView) => {
        if (hasSelectedCandidate || !relatedDatabaseId) return false;

        return fallbackTargetIds().has(updatedView.view_id);
      },
      matchesViewId: (viewId) => Boolean(relatedDatabaseId && fallbackTargetIds().has(viewId)),
      outlineAccepted: (outline) => {
        const access = fallbackAccessRef.current;

        if (
          access.databaseId === relatedDatabaseId &&
          access.suspension === 'broad' &&
          access.allowOutlineRestore &&
          Array.isArray(outline)
        ) {
          resumeFallback();
        }
      },
      refresh: () => {
        const access = fallbackAccessRef.current;

        if (access.databaseId === relatedDatabaseId && access.suspension) return;
        setFallbackRefreshRevision((revision) => revision + 1);
      },
      restore: (viewId) => {
        if (fallbackTargetIds().has(viewId)) resumeFallback();
      },
      suspendBroad: () => suspendFallback('broad'),
      suspendTarget: () => suspendFallback('targeted'),
    });
  }, [
    canLoadFallback,
    catalogRelatedViewId,
    catalogRevision,
    enabled,
    eventEmitter,
    hasSelectedCandidate,
    relatedDatabaseId,
    workspaceId,
  ]);

  useEffect(() => {
    const getViewId = getViewIdFromDatabaseIdRef.current;
    const loadMetadata = loadViewMetaRef.current;

    if (
      !enabled ||
      catalogLoading ||
      hasSelectedCandidate ||
      fallbackSuspended ||
      !relatedDatabaseId ||
      !canLoadFallback ||
      !loadMetadata ||
      (!catalogRelatedViewId && !getViewId)
    ) {
      return;
    }

    let cancelled = false;
    const requestedDatabaseId = relatedDatabaseId;
    const accessGeneration = fallbackAccessGenerationRef.current;
    const authoritativeRequest =
      authoritativeFallbackRef.current?.databaseId === requestedDatabaseId
        ? authoritativeFallbackRef.current
        : null;
    const metadataOptions = authoritativeRequest
      ? { authoritative: true, metadataOnly: true }
      : { metadataOnly: true };
    const isCurrentRequest = () => {
      const access = fallbackAccessRef.current;

      return (
        !cancelled &&
        fallbackAccessGenerationRef.current === accessGeneration &&
        !(access.databaseId === requestedDatabaseId && access.suspension)
      );
    };

    const completeAuthoritativeRequest = () => {
      if (authoritativeFallbackRef.current === authoritativeRequest) {
        authoritativeFallbackRef.current = null;
      }
    };

    void (async () => {
      const currentFallback = fallbackSelectedViewRef.current;
      let viewId =
        catalogRelatedViewId ||
        (currentFallback.databaseId === requestedDatabaseId ? currentFallback.viewId : null);

      if (!viewId && getViewId) {
        try {
          viewId = await getViewId(requestedDatabaseId);
        } catch {
          viewId = null;
        }
      }

      if (!isCurrentRequest()) return;
      setFallbackSelectedView((previous) =>
        previous.databaseId === requestedDatabaseId && previous.viewId === viewId
          ? previous
          : { databaseId: requestedDatabaseId, parentViewId: null, viewId, view: undefined }
      );
      if (!viewId) return;

      let childView: View | null;

      try {
        childView = await loadMetadata(viewId, undefined, metadataOptions);
      } catch {
        childView = null;
      }

      if (!childView || !isCurrentRequest()) return;

      // The child is sufficient to render the relation header. Publish it
      // before the optional parent lookup so a missing or inaccessible
      // container never erases valid relation metadata.
      setFallbackSelectedView({
        databaseId: requestedDatabaseId,
        parentViewId: childView.parent_view_id ?? null,
        viewId,
        view: childView,
      });

      if (!childView.parent_view_id) {
        completeAuthoritativeRequest();
        return;
      }

      try {
        const parentView = await loadMetadata(childView.parent_view_id, undefined, metadataOptions);

        if (isCurrentRequest() && parentView?.name) {
          setFallbackSelectedView({
            databaseId: requestedDatabaseId,
            parentViewId: childView.parent_view_id ?? null,
            viewId,
            view: {
              ...childView,
              icon: parentView.icon ?? childView.icon,
              name: parentView.name,
            },
          });
        }
      } catch {
        // Keep the already-published child metadata. The shared view resolver
        // owns retry and request-deduplication policy for the missing parent.
      } finally {
        completeAuthoritativeRequest();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    canLoadFallback,
    catalogLoading,
    catalogRelatedViewId,
    enabled,
    fallbackSuspended,
    fallbackRefreshRevision,
    hasSelectedCandidate,
    relatedDatabaseId,
    workspaceId,
  ]);

  const setSelectedView = useCallback(
    (view: View | undefined) => {
      const candidateDatabaseId = view
        ? result.candidates.find((candidate) => candidate.displayView.view_id === view.view_id)?.databaseId
        : undefined;

      if (candidateDatabaseId && candidateDatabaseId === relatedDatabaseId) {
        setOptimisticSelectedView({ catalogRevision, databaseId: null, view: undefined });
        return;
      }

      setOptimisticSelectedView({
        catalogRevision,
        databaseId: candidateDatabaseId ?? relatedDatabaseId,
        view,
      });
    },
    [catalogRevision, relatedDatabaseId, result.candidates]
  );

  // Keep the view and database identity as one render-time value. Effect-
  // syncing a bare View allowed one commit where database B was paired with
  // the selected view left over from database A.
  const selectedView = selectedCandidate
    ? selectedCandidate.displayView
    : optimisticSelectedView.catalogRevision === catalogRevision &&
        optimisticSelectedView.databaseId === relatedDatabaseId
      ? optimisticSelectedView.view
      : fallbackSelectedView.databaseId === relatedDatabaseId
        ? fallbackSelectedView.view
        : undefined;

  const views = useMemo(() => result.candidates.map((candidate) => candidate.displayView), [result.candidates]);

  return {
    loading: catalogLoading,
    relations: result.relations,
    relatedViewId,
    selectedView,
    views,
    databaseCandidates: result.candidates,
    onUpdateDatabaseId,
    onUpdateTypeOption,
    setSelectedView,
    relatedDatabaseId,
    relationOption,
  };
}
