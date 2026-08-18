import { useEffect, useMemo, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { parseRelationTypeOption, useDatabaseContext, useFieldSelector } from '@/application/database-yjs';
import { useUpdateRelationTypeOption } from '@/application/database-yjs/dispatch/relation';
import { RelationTypeOption } from '@/application/database-yjs/fields/relation/relation.type';
import { View } from '@/application/types';

import { loadRelationDatabaseCandidates, RelationDatabaseCandidatesResult } from './relationDatabaseCandidates';

let cachedWorkspaceId: string | null = null;
let cachedResult: RelationDatabaseCandidatesResult | null = null;
const EMPTY_RESULT: RelationDatabaseCandidatesResult = { candidates: [], relations: {}, outline: [] };

function getCachedResult(workspaceId: string): RelationDatabaseCandidatesResult | null {
  return cachedWorkspaceId === workspaceId ? cachedResult : null;
}

function setCachedResult(workspaceId: string, result: RelationDatabaseCandidatesResult) {
  cachedWorkspaceId = workspaceId;
  cachedResult = result;
}

export function clearRelationViewsCache(): void {
  cachedWorkspaceId = null;
  cachedResult = null;
}

export interface UseRelationDataOptions {
  enabled?: boolean;
}

export function useRelationData(fieldId: string, options: UseRelationDataOptions = {}) {
  const { enabled = true } = options;
  const { eventEmitter, getViewIdFromDatabaseId, loadDatabaseRelations, loadViewMeta, loadViews, workspaceId } =
    useDatabaseContext();
  const { field } = useFieldSelector(fieldId);
  const relationOption: RelationTypeOption | null = field ? parseRelationTypeOption(field) : null;
  const relatedDatabaseId = relationOption?.database_id || null;
  const initialResult = getCachedResult(workspaceId);
  const [resultState, setResultState] = useState(() => ({
    workspaceId,
    result: initialResult ?? EMPTY_RESULT,
  }));
  const result =
    resultState.workspaceId === workspaceId ? resultState.result : getCachedResult(workspaceId) ?? EMPTY_RESULT;
  const [loading, setLoading] = useState(enabled && !initialResult);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [fallbackRelatedViewId, setFallbackRelatedViewId] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<View | undefined>(undefined);
  const loadDatabaseRelationsRef = useRef(loadDatabaseRelations);
  const loadViewMetaRef = useRef(loadViewMeta);
  const loadViewsRef = useRef(loadViews);
  const onUpdateTypeOption = useUpdateRelationTypeOption(fieldId);
  const onUpdateDatabaseId = (databaseId: string) => onUpdateTypeOption({ database_id: databaseId });

  useEffect(() => {
    loadDatabaseRelationsRef.current = loadDatabaseRelations;
  }, [loadDatabaseRelations]);

  useEffect(() => {
    loadViewMetaRef.current = loadViewMeta;
  }, [loadViewMeta]);

  useEffect(() => {
    loadViewsRef.current = loadViews;
  }, [loadViews]);

  useEffect(() => {
    if (!enabled || !fieldId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const hasCachedResult = Boolean(getCachedResult(workspaceId));

    if (!hasCachedResult) setLoading(true);

    void loadRelationDatabaseCandidates({
      workspaceId,
      loadDatabaseRelations: loadDatabaseRelationsRef.current,
      loadViewMeta: loadViewMetaRef.current,
      loadViews: loadViewsRef.current,
    })
      .then((nextResult) => {
        if (cancelled) return;

        setCachedResult(workspaceId, nextResult);
        setResultState({ workspaceId, result: nextResult });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, fieldId, refreshRevision, workspaceId]);

  useEffect(() => {
    if (!enabled || !eventEmitter) return;

    const refresh = () => setRefreshRevision((revision) => revision + 1);

    eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, refresh);
    return () => {
      eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, refresh);
    };
  }, [enabled, eventEmitter]);

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

  return {
    loading: loading || Boolean(enabled && resultState.workspaceId !== workspaceId && !getCachedResult(workspaceId)),
    relations: result.relations,
    relatedViewId,
    selectedView,
    views: result.candidates.map((candidate) => candidate.displayView),
    databaseCandidates: result.candidates,
    onUpdateDatabaseId,
    onUpdateTypeOption,
    setSelectedView,
    relatedDatabaseId,
    relationOption,
  };
}
