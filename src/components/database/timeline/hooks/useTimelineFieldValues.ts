import debounce from 'lodash-es/debounce';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { getCell, useFieldSelector, useRowMap, useRowOrdersSelector } from '@/application/database-yjs';
import { YDatabaseCell, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

const EMPTY = new Map<string, never>();

/**
 * One parsed cell value per row for `fieldId`, refreshed when any row doc
 * changes. Rows without a cell (or not yet loaded) are absent from the map.
 */
export function useTimelineFieldValues<T>(
  fieldId: string,
  parse: (cell: YDatabaseCell) => T | undefined
): Map<string, T> {
  const { field, clock } = useFieldSelector(fieldId);
  const rowOrders = useRowOrdersSelector();
  const rows = useRowMap();
  const [values, setValues] = useState<Map<string, T>>(EMPTY);

  useEffect(() => {
    if (!field || !fieldId || !rowOrders || !rows) {
      setValues(EMPTY);
      return;
    }

    const read = () => {
      const next = new Map<string, T>();

      rowOrders.forEach((row) => {
        const cell = getCell(row.id, fieldId, rows);

        if (!cell) return;
        const value = parse(cell);

        if (value !== undefined) next.set(row.id, value);
      });
      setValues(next);
    };

    read();
    const debounced = debounce(read, 150);
    const docs = rowOrders.map((row) => rows[row.id]).filter(Boolean);

    docs.forEach((doc) => doc.getMap(YjsEditorKey.data_section).observeDeep(debounced));
    return () => {
      debounced.cancel();
      docs.forEach((doc) => doc.getMap(YjsEditorKey.data_section).unobserveDeep(debounced));
    };
  }, [field, clock, fieldId, parse, rowOrders, rows]);

  return values;
}

/** Row ids linked through a Relation cell. */
export function parseRelationRowIds(cell: YDatabaseCell): string[] | undefined {
  const data = cell.get(YjsDatabaseKey.data);

  if (data instanceof Y.Array) return (data.toArray() as unknown[]).filter((id): id is string => typeof id === 'string');
  if (Array.isArray(data)) return data.filter((id): id is string => typeof id === 'string');
  return undefined;
}

/** A Number cell clamped to 0–100, the way frappe-gantt reads task progress. */
export function parseProgressPercent(cell: YDatabaseCell): number | undefined {
  const raw = cell.get(YjsDatabaseKey.data);
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(/[^0-9.-]/g, '')) : NaN;

  if (!Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}
