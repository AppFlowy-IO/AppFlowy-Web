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
  onTextChange,
}: {
  rowDoc: YDoc;
  fieldId?: FieldId;
  field?: YDatabaseField;
  onTextChange?: (text: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const data = rowDoc.getMap(YjsEditorKey.data_section);

    const observeHandler = () => {
      const row = data.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
      const cells = row?.get(YjsDatabaseKey.cells);
      let primaryCell: YDatabaseCell | undefined;

      if (fieldId) {
        primaryCell = cells?.get(fieldId);
      } else {
        const richTextFieldId = Array.from(cells?.keys() ?? []).find((key) => {
          const fieldType = cells?.get(key)?.get(YjsDatabaseKey.field_type);

          if (fieldType === undefined || fieldType === null) return false;
          return Number(fieldType) === FieldType.RichText;
        });

        if (richTextFieldId) {
          primaryCell = cells?.get(richTextFieldId);
        }
      }

      if (!primaryCell) {
        setText('');
        return;
      }

      setText(field ? decodeCellToText(primaryCell, field) : String(parseYDatabaseCellToCell(primaryCell).data ?? ''));
    };

    observeHandler();

    const observerCleanups: Array<() => void> = [subscribeSharedYjsDeep(data, observeHandler)];

    if (field) observerCleanups.push(subscribeSharedYjsDeep(field, observeHandler));

    return () => {
      observerCleanups.forEach((cleanup) => cleanup());
    };
  }, [field, fieldId, rowDoc]);

  useEffect(() => {
    onTextChange?.(text ?? '');
  }, [onTextChange, text]);

  return <div>{text}</div>;
}
