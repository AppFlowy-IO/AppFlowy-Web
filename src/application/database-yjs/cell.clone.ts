import dayjs from 'dayjs';
import * as Y from 'yjs';

import { getStoredCellFieldType, isTextWrittenCell, setCellStoredType } from '@/application/database-yjs/cell.field-type';
import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseCell, YjsDatabaseKey } from '@/application/types';

/**
 * Clone raw cell data without changing the format that cell.field_type describes.
 *
 * Every shared Yjs value is deep-copied: an integrated type cannot be
 * inserted again. A Text-written cell (rich text spec section 0) keeps its
 * stored types verbatim, so the copy stays Text-written exactly when the
 * original is, and its `rich_text` is copied byte for byte (R47).
 */
export function cloneDatabaseCell(fieldType: FieldType, referenceCell?: YDatabaseCell): YDatabaseCell {
  const cell = new Y.Map() as YDatabaseCell;

  referenceCell?.forEach((value, key) => {
    let newValue = value;

    if (typeof value === 'bigint') {
      newValue = value.toString();
    } else if (value instanceof Y.AbstractType) {
      newValue = value.clone();
    }

    cell.set(key, newValue);
  });

  if (!referenceCell) {
    setCellStoredType(cell, fieldType);
  } else if (!isTextWrittenCell(referenceCell)) {
    setCellStoredType(cell, getStoredCellFieldType(referenceCell, fieldType));
  }

  cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
  cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));

  return cell;
}
