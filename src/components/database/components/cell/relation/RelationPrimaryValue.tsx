import { useEffect, useState } from 'react';

import { FieldType } from '@/application/database-yjs';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { decodeCellToText } from '@/application/database-yjs/decode';
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
    data?.observeDeep(onRowChange);
    return () => {
      data?.unobserveDeep(onRowChange);
    };
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

    primaryCell?.observeDeep(observeHandler);
    field?.observeDeep(observeHandler);
    return () => {
      primaryCell?.unobserveDeep(observeHandler);
      field?.unobserveDeep(observeHandler);
    };
  }, [row, fieldId, field]);

  return <div>{text}</div>;
}
