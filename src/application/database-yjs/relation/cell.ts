import * as Y from 'yjs';

import { getStoredCellFieldType } from '@/application/database-yjs/cell.field-type';
import { FieldType } from '@/application/database-yjs/database.type';
import { RowId, YDatabaseCell, YjsDatabaseKey } from '@/application/types';

function uniq(ids: RowId[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

/**
 * Decode only cells whose raw payload is actually relation data.
 *
 * Several cell types use arrays. Checking the payload shape alone can turn a
 * lazily converted Media/Person cell into relation row IDs and make rollups or
 * reciprocal updates operate on unrelated data.
 */
export function getRelationRowIdsFromCell(cell?: YDatabaseCell): RowId[] {
  if (!cell || getStoredCellFieldType(cell, FieldType.Relation) !== FieldType.Relation) {
    return [];
  }

  const data = cell.get(YjsDatabaseKey.data);

  if (!data) return [];

  if (data instanceof Y.Array) {
    return uniq(data.toArray().map(String));
  }

  if (typeof data === 'object' && 'toJSON' in data) {
    const ids = (data as { toJSON: () => unknown }).toJSON();

    return Array.isArray(ids) ? uniq(ids.map(String)) : [];
  }

  if (Array.isArray(data)) {
    return uniq(data.map(String));
  }

  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed)) {
        return uniq(parsed.map(String));
      }
    } catch {
      return uniq(data.split(',').map((id) => id.trim()));
    }
  }

  return [];
}
