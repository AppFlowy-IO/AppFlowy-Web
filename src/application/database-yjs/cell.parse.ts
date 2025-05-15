import { YDatabaseCell, YjsDatabaseKey } from '@/application/types';
import { FieldType } from '@/application/database-yjs/database.type';
import { YArray } from 'yjs/dist/src/types/YArray';
import { Cell, DateTimeCell, FileMediaCell, FileMediaCellData } from './cell.type';

export function parseYDatabaseCommonCellToCell (cell: YDatabaseCell): Cell {
  return {
    createdAt: Number(cell.get(YjsDatabaseKey.created_at)),
    lastModified: Number(cell.get(YjsDatabaseKey.last_modified)),
    fieldType: parseInt(cell.get(YjsDatabaseKey.field_type)) as FieldType,
    data: cell.get(YjsDatabaseKey.data),
  };
}

export function parseYDatabaseCellToCell (cell: YDatabaseCell, fieldType?: FieldType): Cell {
  const cellType = parseInt(cell.get(YjsDatabaseKey.field_type));

  let value = parseYDatabaseCommonCellToCell(cell);

  if (cellType === FieldType.DateTime) {
    value = parseYDatabaseDateTimeCellToCell(cell);
  }

  if (cellType === FieldType.FileMedia) {
    value = parseYDatabaseFileMediaCellToCell(cell);
  }

  if (fieldType !== undefined && cellType !== fieldType) {
    // If the field type does not match, deal with it here
  }

  return value;
}

export function parseYDatabaseDateTimeCellToCell (cell: YDatabaseCell): DateTimeCell {
  return {
    ...parseYDatabaseCommonCellToCell(cell),
    data: cell.get(YjsDatabaseKey.data) as string,
    fieldType: FieldType.DateTime,
    endTimestamp: cell.get(YjsDatabaseKey.end_timestamp),
    includeTime: cell.get(YjsDatabaseKey.include_time),
    isRange: cell.get(YjsDatabaseKey.is_range),
    reminderId: cell.get(YjsDatabaseKey.reminder_id),
  };
}

export function parseYDatabaseFileMediaCellToCell (cell: YDatabaseCell): FileMediaCell {
  const data = cell.get(YjsDatabaseKey.data) as YArray<string>;
  const dataJson = data.toJSON().map((item: string) => JSON.parse(item)) as FileMediaCellData;

  return {
    ...parseYDatabaseCommonCellToCell(cell),
    data: dataJson,
    fieldType: FieldType.FileMedia,
  };
}
