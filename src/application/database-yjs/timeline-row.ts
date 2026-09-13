import * as Y from 'yjs';

import { AttributionUid, touchRowAttribution } from '@/application/database-yjs/attribution';
import { setCellStoredType } from '@/application/database-yjs/cell.field-type';
import { FieldType } from '@/application/database-yjs/database.type';
import { runDatabaseRowAction } from '@/application/database-yjs/history';
import {
  YDatabaseCell,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { parseTimestamp, TimelineRange } from '@/components/database/timeline/timeline.geometry';

export function readTimelineRange(
  row: YDatabaseRow | undefined,
  fields: YDatabaseFields,
  fieldId: string,
  endFieldId: string
): { range?: TimelineRange; invalid: boolean } {
  const cells = row?.get(YjsDatabaseKey.cells);
  const readDate = (id: string) => {
    const type = Number(fields.get(id)?.get(YjsDatabaseKey.type));

    if (type === FieldType.CreatedTime) return parseTimestamp(row?.get(YjsDatabaseKey.created_at));
    if (type === FieldType.LastEditedTime) return parseTimestamp(row?.get(YjsDatabaseKey.last_modified));
    return type === FieldType.DateTime ? parseTimestamp(cells?.get(id)?.get(YjsDatabaseKey.data)) : undefined;
  };

  const cell = cells?.get(fieldId);
  const start = readDate(fieldId);
  const end = endFieldId
    ? readDate(endFieldId)
    : cell?.get(YjsDatabaseKey.is_range)
    ? parseTimestamp(cell.get(YjsDatabaseKey.end_timestamp))
    : undefined;

  if (start === undefined) return { invalid: false };
  if (end !== undefined && end < start) return { invalid: true };
  return {
    range: {
      start,
      end,
      includeTime:
        Number(fields.get(fieldId)?.get(YjsDatabaseKey.type)) !== FieldType.DateTime ||
        Boolean(cell?.get(YjsDatabaseKey.include_time)),
    },
    invalid: false,
  };
}

/** Commit both endpoints in one row transaction and one history action. Reject a stale
 * gesture if a collaborator changed its dates while the pointer was held down.
 */
export function commitTimelineRange(
  rowDoc: YDoc,
  fields: YDatabaseFields,
  fieldId: string,
  endFieldId: string,
  before: TimelineRange | undefined,
  next: TimelineRange,
  actorUid?: AttributionUid
) {
  const row = (rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot).get(YjsEditorKey.database_row);
  const cells = row?.get(YjsDatabaseKey.cells);

  if (!row || !cells) throw new Error('The row is still loading. Please try again.');
  if (
    [fieldId, endFieldId]
      .filter(Boolean)
      .some((id) => Number(fields.get(id)?.get(YjsDatabaseKey.type)) !== FieldType.DateTime)
  )
    throw new Error('This date property cannot be edited.');
  const current = readTimelineRange(row, fields, fieldId, endFieldId);

  if (
    current.invalid ||
    current.range?.start !== before?.start ||
    current.range?.end !== before?.end ||
    current.range?.includeTime !== before?.includeTime
  )
    throw new Error('These dates changed while you were editing. Please try again.');
  if (!Number.isFinite(next.start) || (next.end !== undefined && (!Number.isFinite(next.end) || next.end < next.start)))
    throw new Error('The end date must be on or after the start date.');

  runDatabaseRowAction(
    rowDoc,
    { type: 'cell.update', rowId: String(row.get(YjsDatabaseKey.id)), fieldId, fieldType: FieldType.DateTime },
    () => {
      const write = (id: string, start: number, end: number | undefined, includeTime: boolean) => {
        let cell = cells.get(id);

        if (!cell) {
          cell = new Y.Map() as YDatabaseCell;
          cell.set(YjsDatabaseKey.created_at, String(Math.floor(Date.now() / 1000)));
          cells.set(id, cell);
        }

        setCellStoredType(cell, FieldType.DateTime);
        cell.set(YjsDatabaseKey.data, String(Math.floor(start / 1000)));
        cell.set(YjsDatabaseKey.end_timestamp, end === undefined ? '' : String(Math.floor(end / 1000)));
        cell.set(YjsDatabaseKey.is_range, end !== undefined);
        cell.set(YjsDatabaseKey.include_time, includeTime);
        cell.set(YjsDatabaseKey.last_modified, String(Math.floor(Date.now() / 1000)));
      };

      write(fieldId, next.start, endFieldId ? undefined : next.end, next.includeTime);
      if (endFieldId && next.end !== undefined) {
        const endCell = cells.get(endFieldId);
        const endIncludesTime = endCell?.has(YjsDatabaseKey.include_time)
          ? Boolean(endCell.get(YjsDatabaseKey.include_time))
          : next.includeTime;

        write(endFieldId, next.end, undefined, endIncludesTime);
      }

      touchRowAttribution(row, actorUid);
    }
  );
}
