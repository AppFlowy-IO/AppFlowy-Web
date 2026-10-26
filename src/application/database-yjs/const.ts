import { v4 as uuidv4, v5 as uuidv5, parse as uuidParse } from 'uuid';

import { RowMetaKey } from '@/application/database-yjs/database.type';
import { RowId, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

export const DEFAULT_ROW_HEIGHT = 36;
export const MIN_COLUMN_WIDTH = 150;
export const PADDING_END = 220;
export const DEFAULT_FIELD_WRAP = false;

export const getCell = (rowId: string, fieldId: string, rowMetas: Record<RowId, YDoc>) => {
  const rowMeta = rowMetas[rowId];

  const meta = rowMeta?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

  return meta?.get(YjsDatabaseKey.cells)?.get(fieldId);
};

export const getCellData = (rowId: string, fieldId: string, rowMetas: Record<RowId, YDoc>) => {
  return getCell(rowId, fieldId, rowMetas)?.get(YjsDatabaseKey.data);
};

export const metaIdFromRowId = (rowId: string) => {
  let namespace: Uint8Array;

  try {
    namespace = uuidParse(rowId);
  } catch (e) {
    // Cloud's idempotent row API stores 16 SHA-256 bytes as a UUID. Keep
    // those namespace bytes even when uuid.parse rejects the version/variant.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rowId)) {
      const hex = rowId.replace(/-/g, '');

      namespace = Uint8Array.from({ length: 16 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
    } else {
      namespace = uuidParse(generateUUID());
    }
  }

  return (key: RowMetaKey) => uuidv5(key, namespace).toString();
};

export const generateUUID = () => uuidv4();
