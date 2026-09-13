import { useCallback, useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { useDatabaseContext, useDatabaseView, useSharedRoot } from '@/application/database-yjs/context';
import { executeDatabaseOperations } from '@/application/database-yjs/history';
import { YDatabaseLayoutSettings, YDatabaseView, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { TIMELINE_SCALES, TimelineScale } from '@/components/database/timeline/timeline.geometry';

export interface TimelineSettings {
  fieldId: string;
  endFieldId: string;
  scale: TimelineScale;
  showTable: boolean;
  tableWidth: number;
  barFieldIds: string[];
  tableFieldIds: string[];
  hideEmptyGroups: boolean;
}

export function readTimelineSettings(view?: YDatabaseView): TimelineSettings {
  const setting = view?.get(YjsDatabaseKey.layout_settings)?.get('8');
  const scale = setting?.get('scale');
  const width = Number(setting?.get('table_width'));
  const barFields = setting?.get('bar_field_ids');
  const tableFields = setting?.get('table_field_ids');

  return {
    hideEmptyGroups: setting?.get('hide_empty_groups') !== false,
    fieldId: String(setting?.get('field_id') ?? ''),
    endFieldId: String(setting?.get('end_field_id') ?? ''),
    scale: TIMELINE_SCALES.includes(scale as TimelineScale) ? (scale as TimelineScale) : 'month',
    showTable: setting?.get('show_table') !== false,
    tableWidth: Number.isFinite(width) ? Math.max(180, Math.min(640, width)) : 300,
    barFieldIds: Array.isArray(barFields) ? barFields.filter((value): value is string => typeof value === 'string') : [],
    tableFieldIds: Array.isArray(tableFields)
      ? tableFields.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

export function updateTimelineSettings(view: YDatabaseView, changes: Partial<TimelineSettings>) {
  let layouts = view.get(YjsDatabaseKey.layout_settings);

  if (!layouts) {
    layouts = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layouts);
  }

  let setting = layouts.get('8');

  if (!setting) {
    setting = new Y.Map();
    layouts.set('8', setting);
  }

  const keys: Record<keyof TimelineSettings, string> = {
    fieldId: 'field_id',
    endFieldId: 'end_field_id',
    scale: 'scale',
    showTable: 'show_table',
    tableWidth: 'table_width',
    barFieldIds: 'bar_field_ids',
    tableFieldIds: 'table_field_ids',
    hideEmptyGroups: 'hide_empty_groups',
  };

  (Object.keys(changes) as (keyof TimelineSettings)[]).forEach((key) => {
    if (changes[key] !== undefined) setting?.set(keys[key], changes[key]);
  });
}

export function useTimelineSettings() {
  const { databaseDoc, activeViewId } = useDatabaseContext();
  const store = useMemo(() => {
    const root = databaseDoc.getMap(YjsEditorKey.data_section);
    const read = () =>
      readTimelineSettings(
        (root.get(YjsEditorKey.database) as import('@/application/types').YDatabase)
          ?.get(YjsDatabaseKey.views)
          ?.get(activeViewId)
      );
    let snapshot = read();
    let signature = JSON.stringify(snapshot);
    const getSnapshot = () => {
      const next = read();
      const key = JSON.stringify(next);

      if (signature !== key) {
        snapshot = next;
        signature = key;
      }

      return snapshot;
    };

    return {
      getSnapshot,
      subscribe: (notify: () => void) => {
        const observer = () => {
          const before = snapshot;

          if (getSnapshot() !== before) notify();
        };

        root.observeDeep(observer);
        observer();
        return () => root.unobserveDeep(observer);
      },
    };
  }, [activeViewId, databaseDoc]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useUpdateTimelineSettings() {
  const view = useDatabaseView();
  const root = useSharedRoot();
  const { readOnly, canWrite } = useDatabaseContext();

  return useCallback(
    (changes: Partial<TimelineSettings>) => {
      if (!view || readOnly || canWrite === false) return;
      executeDatabaseOperations(root, [() => updateTimelineSettings(view, changes)], 'updateTimelineSettings');
    },
    [canWrite, readOnly, root, view]
  );
}
