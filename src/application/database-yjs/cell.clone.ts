import dayjs from 'dayjs';
import * as Y from 'yjs';

import { getStoredCellFieldType, setCellStoredType } from '@/application/database-yjs/cell.field-type';
import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseCell, YjsDatabaseKey } from '@/application/types';

/** Clone raw cell data without changing the format that cell.field_type describes. */
export function cloneDatabaseCell(fieldType: FieldType, referenceCell?: YDatabaseCell): YDatabaseCell {
  const cell = new Y.Map() as YDatabaseCell;

  referenceCell?.forEach((value, key) => {
    let newValue = value;

    if (typeof value === 'bigint') {
      newValue = value.toString();
    } else if (value instanceof Y.Array) {
      newValue = value.clone();
    }

    cell.set(key, newValue);
  });

  const storedType = referenceCell ? getStoredCellFieldType(referenceCell, fieldType) : fieldType;

  setCellStoredType(cell, storedType);
  cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
  cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));

  return cell;
}
