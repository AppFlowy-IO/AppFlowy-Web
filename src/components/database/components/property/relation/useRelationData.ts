import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { parseRelationTypeOption, useDatabaseContext, useFieldSelector } from '@/application/database-yjs';
import { useUpdateRelationTypeOption } from '@/application/database-yjs/dispatch/relation';
import { RelationTypeOption } from '@/application/database-yjs/fields/relation/relation.type';
import { EventType, on } from '@/application/session/event';
import { View } from '@/application/types';

import {
  buildRelationDatabaseCandidates,
  loadRelationDatabaseCandidates,
  RelationDatabaseCandidatesResult,
} from './relationDatabaseCandidates';

// Workspace-scoped candidate cache shared by every hook instance. Reads go
// through useSyncExternalStore so render stays pure and every subscribed
// instance re-renders when any instance refreshes the cache.
let cachedWorkspaceId: string | null = null;
let cachedResult: RelationDatabaseCandidatesResult | null = null;
const cacheListeners = new Set<() => void>();
const EMPTY_RESULT: RelationDatabaseCandidatesResult = { candidates: [], relations: {}, outline: [], databases: [] };

function getCachedResult(workspaceId: string): RelationDatabaseCandidatesResult | null {
  return cachedWorkspaceId === workspaceId ? cachedResult : null;
}

function setCachedResult(workspaceId: string, result: RelationDatabaseCandidatesResult) {
  cachedWorkspaceId = workspaceId;
  cachedResult = result;
  cacheListeners.forEach((listener) => listener());
}

function subscribeToCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

export function clearRelationViewsCache(): void {
  cachedWorkspaceId = null;
  cachedResult = null;
  cacheListeners.forEach((listener) => listener());
}

// The cache is keyed by workspace only, while the IndexedDB catalog is keyed by
// user — drop it on session invalidation so a later login as a different user
// cannot be served the previous user's candidates.
on(EventType.SESSION_INVALID, clearRelationViewsCache);

type LoadingState = { workspaceId: string; loading: boolean };

function withLoading(workspaceId: string, loading: boolean) {
  return (previous: LoadingState): LoadingState =>
    previous.workspaceId === workspaceId && previous.loading === loading ? previous : { workspaceId, loading };
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
  const result = useSyncExternalStore(subscribeToCache, () => getCachedResult(workspaceId) ?? EMPTY_RESULT);
  const [loadingState, setLoadingState] = useState<LoadingState>(() => ({
    workspaceId,
    loading: enabled && !getCachedResult(workspaceId),
  }));

  // Reset loading when the workspace changes without a remount, before the
  // fetch effect runs, so consumers never see the previous workspace's flag.
  if (loadingState.workspaceId !== workspaceId) {
    setLoadingState({ workspaceId, loading: enabled && !getCachedResult(workspaceId) });
  }

  const [fallbackRelatedViewId, setFallbackRelatedViewId] = useState<string | null>(null);
  const loadViewMetaRef = useRef(loadViewMeta);
  const loadViewsRef = useRef(loadViews);
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
    if (!enabled || !fieldId) {
      setLoadingState(withLoading(workspaceId, false));
      return;
    }

    let cancelled = false;

    if (!getCachedResult(workspaceId)) setLoadingState(withLoading(workspaceId, true));

    void loadRelationDatabaseCandidates({
      workspaceId,
      loadViews: loadViewsRef.current,
    })
      .then((nextResult) => {
        if (!cancelled) setCachedResult(workspaceId, nextResult);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingState(withLoading(workspaceId, false));
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, fieldId, workspaceId]);

  useEffect(() => {
    if (!enabled || !eventEmitter) return;

    // Rebuild candidate paths from the event payload instead of refetching the
    // catalog — outline events fire on every page create/rename/move. Skip when
    // nothing is cached yet or another hook instance already processed this
    // exact payload. New databases still surface via the fetch effect, which
    // re-runs whenever a picker becomes enabled.
    const handleOutlineLoaded = (outline?: View[]) => {
      if (!Array.isArray(outline)) return;

      const cached = getCachedResult(workspaceId);

      if (!cached || cached.outline === outline) return;
      setCachedResult(workspaceId, buildRelationDatabaseCandidates(cached.databases, outline));
    };

    eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
    return () => {
      eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
    };
  }, [enabled, eventEmitter, workspaceId]);

  const relatedViewId = relatedDatabaseId ? result.relations[relatedDatabaseId] || fallbackRelatedViewId : null;

  useEffect(() => {
    if (!enabled || !relatedDatabaseId || result.relations[relatedDatabaseId] || !getViewIdFromDatabaseId) {
      setFallbackRelatedViewId(null);
      return;
    }

    let cancelled = false;

    void getViewIdFromDatabaseId(relatedDatabaseId)
      .then((viewId) => {
        if (!cancelled) setFallbackRelatedViewId(viewId);
      })
      .catch(() => {
        if (!cancelled) setFallbackRelatedViewId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, getViewIdFromDatabaseId, relatedDatabaseId, result.relations]);

  const selectedCandidate = useMemo(
    () => result.candidates.find((candidate) => candidate.databaseId === relatedDatabaseId),
    [relatedDatabaseId, result.candidates]
  );

  // selectedView is writable state, not pure derived state — consumers set it
  // optimistically when picking a candidate — so it is synced from the
  // candidate list in an effect rather than derived during render. The lazy
  // initializer still makes cache-hit mounts render the name immediately.
  const [selectedView, setSelectedView] = useState<View | undefined>(() => selectedCandidate?.displayView);

  useEffect(() => {
    if (selectedCandidate) {
      setSelectedView(selectedCandidate.displayView);
      return;
    }

    if (!relatedViewId || !loadViewMetaRef.current) {
      setSelectedView(undefined);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const view = await loadViewMetaRef.current?.(relatedViewId);

        if (!view || cancelled) return;

        if (!view.parent_view_id) {
          setSelectedView(view);
          return;
        }

        const parent = await loadViewMetaRef.current?.(view.parent_view_id);

        if (!cancelled) {
          setSelectedView(parent?.name ? { ...view, icon: parent.icon ?? view.icon, name: parent.name } : view);
        }
      } catch {
        if (!cancelled) setSelectedView(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [relatedViewId, selectedCandidate]);

  const views = useMemo(() => result.candidates.map((candidate) => candidate.displayView), [result.candidates]);

  return {
    loading: loadingState.loading,
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
