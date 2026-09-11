import { decodeCellToText } from '@/application/database-yjs/decode';
import { YDatabase, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

/** Resolve only titles captured in this database snapshot; external targets retain their IDs. */
export function readHistoricalRelationText(
  database: YDatabase,
  relatedDatabaseId: string,
  rowIds: readonly string[],
  rows: Record<string, YDoc>
): string {
  if (relatedDatabaseId !== database.get(YjsDatabaseKey.id)) return rowIds.join(', ');
  const fields = database.get(YjsDatabaseKey.fields);
  const primary = Array.from(fields?.values() ?? []).find((field) => field.get(YjsDatabaseKey.is_primary));

  return rowIds.map((id) => {
    const row = rows[id]?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
    const cell = primary && row?.get(YjsDatabaseKey.cells)?.get(primary.get(YjsDatabaseKey.id));

    return cell && primary ? decodeCellToText(cell, primary) : id;
  }).join(', ');
}
