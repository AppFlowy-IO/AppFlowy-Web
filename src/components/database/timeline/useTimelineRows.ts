import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveUserAttributionUid } from '@/application/database-yjs/attribution';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { useDatabase, useDatabaseContext } from '@/application/database-yjs/context';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { useBackgroundRowDocLoader } from '@/application/database-yjs/hooks';
import { Row } from '@/application/database-yjs/selector';
import { TimelineSettings } from '@/application/database-yjs/timeline-layout';
import { commitTimelineRange, readTimelineRange } from '@/application/database-yjs/timeline-row';
import { YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

import { TimelineRange } from './timeline.geometry';

export interface TimelineRecord {
  id: string;
  title: string;
  range?: TimelineRange;
  invalid: boolean;
  loaded: boolean;
  searchText?: string;
}

export function useTimelineRows(rowOrders: Row[] | undefined, primaryId: string, settings: TimelineSettings) {
  const { rowMap } = useDatabaseContext();
  const database = useDatabase();
  const fields = database.get(YjsDatabaseKey.fields);
  const { cachedRowDocs } = useBackgroundRowDocLoader(true, 'timeline');
  const [revision, setRevision] = useState(0);
  const frame = useRef<number>();
  const docs = useMemo(() => {
    const result = { ...cachedRowDocs };

    Object.entries(rowMap ?? {}).forEach(([id, doc]) => {
      if (hasRowConditionData(doc) || !result[id]) result[id] = doc;
    });
    return result;
  }, [cachedRowDocs, rowMap]);

  useEffect(() => {
    const changed = () => {
      if (frame.current !== undefined) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        setRevision((value) => value + 1);
      });
    };

    Object.values(docs).forEach((doc) => doc.getMap(YjsEditorKey.data_section).observeDeep(changed));
    fields.observeDeep(changed);
    // Close the render/subscription gap, including after seed hydration.
    changed();
    return () => {
      Object.values(docs).forEach((doc) => doc.getMap(YjsEditorKey.data_section).unobserveDeep(changed));
      fields.unobserveDeep(changed);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [docs, fields]);

  return useMemo(() => {
    void revision;
    const primary = fields.get(primaryId);

    return new Map(
      (rowOrders ?? []).map(({ id }) => {
        const row = (docs[id]?.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined)?.get(
          YjsEditorKey.database_row
        );
        const cell = row?.get(YjsDatabaseKey.cells)?.get(primaryId);
        const searchFields = new Set([primaryId, ...settings.tableFieldIds, ...settings.barFieldIds]);
        const searchText = Array.from(searchFields, (id) => {
          const field = fields.get(id);
          const value = row?.get(YjsDatabaseKey.cells)?.get(id);

          return field && value ? decodeCellToText(value, field) : '';
        })
          .join(' ')
          .toLocaleLowerCase();

        return [
          id,
          {
            id,
            title: primary && cell ? decodeCellToText(cell, primary) : '',
            loaded: Boolean(row),
            searchText,
            ...readTimelineRange(row, fields, settings.fieldId, settings.endFieldId),
          } satisfies TimelineRecord,
        ];
      })
    );
  }, [
    docs,
    fields,
    primaryId,
    revision,
    rowOrders,
    settings.fieldId,
    settings.endFieldId,
    settings.tableFieldIds,
    settings.barFieldIds,
  ]);
}

export function useCommitTimelineRange(settings: TimelineSettings) {
  const { databaseDoc, readOnly, canWrite, ensureRow, rowMap, markCellLocalMutation } = useDatabaseContext();
  const database = useDatabase();
  const actorUid = resolveUserAttributionUid(useCurrentUserOptional());

  return useCallback(
    async (rowId: string, before: TimelineRange | undefined, next: TimelineRange) => {
      if (readOnly || canWrite === false) throw new Error('This database is read-only.');
      const doc = rowMap?.[rowId] ?? (await ensureRow?.(rowId));

      if (!doc) throw new Error('The row is still loading. Please try again.');
      getOrCreateDatabaseHistoryManager(databaseDoc).registerRowDoc(rowId, doc);
      commitTimelineRange(
        doc,
        database.get(YjsDatabaseKey.fields),
        settings.fieldId,
        settings.endFieldId,
        before,
        next,
        actorUid
      );
      markCellLocalMutation?.(rowId, settings.fieldId);
      if (settings.endFieldId) markCellLocalMutation?.(rowId, settings.endFieldId);
    },
    [
      actorUid,
      canWrite,
      database,
      databaseDoc,
      ensureRow,
      markCellLocalMutation,
      readOnly,
      rowMap,
      settings.fieldId,
      settings.endFieldId,
    ]
  );
}
