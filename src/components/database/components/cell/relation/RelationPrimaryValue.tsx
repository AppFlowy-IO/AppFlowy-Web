import { useEffect, useState } from 'react';

import { FieldType } from '@/application/database-yjs';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';
import {
  FieldId,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

export function RelationPrimaryValue({
  rowDoc,
  fieldId,
  field,
}: {
  rowDoc: YDoc;
  fieldId?: FieldId;
  field?: YDatabaseField;
}) {
  const [text, setText] = useState<string | null>(null);
  const [row, setRow] = useState<YDatabaseRow | null>(null);

  useEffect(() => {
    const data = rowDoc.getMap(YjsEditorKey.data_section);

    const onRowChange = () => {
      setRow(data?.get(YjsEditorKey.database_row) as YDatabaseRow);
    };

    onRowChange();
    return subscribeSharedYjsDeep(data, onRowChange);
  }, [rowDoc]);

  useEffect(() => {
    if (!row) {
      setText('');
      return;
    }

    const cells = row.get(YjsDatabaseKey.cells);

    let primaryCell: YDatabaseCell | undefined;

    if (fieldId) {
      primaryCell = cells?.get(fieldId);
    } else {
      const fieldId = Array.from(cells?.keys() ?? []).find((key) => {
        const fieldType = cells.get(key)?.get(YjsDatabaseKey.field_type);

        if (fieldType === undefined || fieldType === null) return false;
        return Number(fieldType) === FieldType.RichText;
      });

      if (fieldId) {
        primaryCell = cells?.get(fieldId);
      }
    }

    const observeHandler = () => {
      if (!primaryCell) {
        setText('');
        return;
      }

      setText(field ? decodeCellToText(primaryCell, field) : String(parseYDatabaseCellToCell(primaryCell).data ?? ''));
    };

    observeHandler();

    const observerCleanups: Array<() => void> = [];

    if (primaryCell) observerCleanups.push(subscribeSharedYjsDeep(primaryCell, observeHandler));
    if (field) observerCleanups.push(subscribeSharedYjsDeep(field, observeHandler));

    return () => {
      observerCleanups.forEach((cleanup) => cleanup());
    };
  }, [row, fieldId, field]);

  return <div>{text}</div>;
}
