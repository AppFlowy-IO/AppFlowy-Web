import { parseRelationTypeOption, useDatabase, useDatabaseContext, useFieldSelector } from '@/application/database-yjs';
import { useUpdateRelationDatabaseId } from '@/application/database-yjs/dispatch';
import { DatabaseRelations, View, YjsDatabaseKey } from '@/application/types';
import { findView } from '@/components/_shared/outline/utils';
import { useEffect, useState } from 'react';

export function useRelationData (fieldId: string) {
  const { loadDatabaseRelations, loadViews, viewId } = useDatabaseContext();
  const database = useDatabase();
  const currentDatabaseId = database.get(YjsDatabaseKey.id);
  const { field } = useFieldSelector(fieldId);
  const [relations, setRelations] = useState<DatabaseRelations | undefined>(undefined);
  const relatedDatabaseId = field ? parseRelationTypeOption(field)?.database_id : null;
  const relatedViewId = relatedDatabaseId ? relations?.[relatedDatabaseId] : null;
  const [selectedView, setSelectedView] = useState<View | undefined>(undefined);
  const [views, setViews] = useState<View[]>([]);
  const onUpdateDatabaseId = useUpdateRelationDatabaseId(fieldId);
  const [loadingRelations, setLoadingRelations] = useState<boolean>(false);
  const [loadingViews, setLoadingViews] = useState<boolean>(false);

  useEffect(() => {
    void (async () => {
      if (!loadDatabaseRelations) return;
      setLoadingRelations(true);
      try {
        const relations = (await loadDatabaseRelations());

        if (relations) {
          delete relations[currentDatabaseId];
        }

        setRelations(relations);
      } catch (e) {
        //
      } finally {
        setLoadingRelations(false);
      }

    })();
  }, [loadDatabaseRelations, currentDatabaseId]);

  useEffect(() => {
    void (async () => {
      if (!loadViews || !relations) return;
      const viewIds = Object.values(relations);

      setLoadingViews(true);
      try {
        const allViews = await loadViews?.();

        const views = viewIds.map((viewId: string) => {
          return findView(allViews, viewId);

        }).filter((view) => !!view && view?.view_id !== viewId) as View[];

        setViews(views);
      } catch (e) {
        //
      } finally {
        setLoadingViews(false);
      }
    })();
  }, [loadViews, relations, viewId]);

  useEffect(() => {
    void (async () => {
      if (!relatedViewId) return;
      const view = findView(views, relatedViewId);

      if (view) {
        setSelectedView(view);
      }
    })();
  }, [relatedViewId, views]);

  return {
    loading: loadingRelations || loadingViews,
    relations,
    relatedViewId,
    selectedView,
    views,
    onUpdateDatabaseId,
    setSelectedView,
    relatedDatabaseId,
  };
}