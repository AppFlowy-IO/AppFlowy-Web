import { useCallback } from 'react';
import * as Y from 'yjs';

import { getCell, useFieldSelector } from '@/application/database-yjs';
import { FieldType } from '@/application/database-yjs/database.type';
import { NumberFormat } from '@/application/database-yjs/fields/number/number.type';
import { parseNumberTypeOptions } from '@/application/database-yjs/fields/number/parse';
import { useTimelineRowValues } from '@/application/database-yjs/hooks/useTimelineRowValues';
import { YDatabaseCell, YDatabaseField, YDoc, YjsDatabaseKey } from '@/application/types';

/** One parsed value per row, including detached offscreen seed documents. */
export function useTimelineFieldValues<T>(
  fieldId: string,
  parse: (cell: YDatabaseCell, field: YDatabaseField) => T | undefined
): Map<string, T> {
  const { field, clock } = useFieldSelector(fieldId);
  const parseRow = useCallback(
    (rowId: string, doc: YDoc) => {
      // Y.Map identity stays stable when the property format changes.
      void clock;
      if (!field || !fieldId) return undefined;
      const cell = getCell(rowId, fieldId, { [rowId]: doc });

      return cell ? parse(cell, field) : undefined;
    },
    [field, clock, fieldId, parse]
  );

  return useTimelineRowValues(parseRow);
}

/** Row ids linked through a Relation cell. */
export function parseRelationRowIds(cell: YDatabaseCell): string[] | undefined {
  const data = cell.get(YjsDatabaseKey.data);

  if (data instanceof Y.Array) return (data.toArray() as unknown[]).filter((id): id is string => typeof id === 'string');
  if (Array.isArray(data)) return data.filter((id): id is string => typeof id === 'string');
  return undefined;
}

/** Progress always uses display percent; Percentage cells store fractions. */
export function parseProgressPercent(cell: YDatabaseCell, field: YDatabaseField): number | undefined {
  if (Number(field.get(YjsDatabaseKey.type)) !== FieldType.Number) return undefined;
  const raw = cell.get(YjsDatabaseKey.data);
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(/[^0-9.-]/g, '')) : NaN;

  if (!Number.isFinite(value)) return undefined;
  const percent = parseNumberTypeOptions(field).format === NumberFormat.Percent ? value * 100 : value;

  return Math.min(100, Math.max(0, percent));
}

export function serializeTimelineProgressPercent(percent: number, field: YDatabaseField): string | undefined {
  if (Number(field.get(YjsDatabaseKey.type)) !== FieldType.Number) return undefined;
  return String(parseNumberTypeOptions(field).format === NumberFormat.Percent ? percent / 100 : percent);
}
