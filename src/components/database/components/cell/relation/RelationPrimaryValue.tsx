import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';
import {
  FieldId,
  YDatabaseCell,
  YDatabaseCells,
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
    let observedRow: YDatabaseRow | undefined;
    let observedCells: YDatabaseCells | undefined;
    let observedPrimaryCell: YDatabaseCell | undefined;
    let cleanupPrimaryCell: (() => void) | undefined;
    let cleanupStructuralHydration: (() => void) | undefined;

    const decodePrimaryCell = () => {
      if (!observedPrimaryCell) {
        setText('');
        return;
      }

      const nextText = field
        ? decodeCellToText(observedPrimaryCell, field)
        : String(parseYDatabaseCellToCell(observedPrimaryCell).data ?? '');

      setText((current) => (current === nextText ? current : nextText));
    };

    const resolvePrimaryCell = (): YDatabaseCell | undefined => {
      if (fieldId) return observedCells?.get(fieldId);

      const richTextFieldId = Array.from(observedCells?.keys() ?? []).find((key) => {
        const fieldType = observedCells?.get(key)?.get(YjsDatabaseKey.field_type);

        if (fieldType === undefined || fieldType === null) return false;
        return Number(fieldType) === FieldType.RichText;
      });

      return richTextFieldId ? observedCells?.get(richTextFieldId) : undefined;
    };

    const syncPrimaryCell = () => {
      const nextPrimaryCell = resolvePrimaryCell();

      if (nextPrimaryCell !== observedPrimaryCell) {
        cleanupPrimaryCell?.();
        cleanupPrimaryCell = undefined;
        observedPrimaryCell = nextPrimaryCell;

        if (observedPrimaryCell) {
          cleanupPrimaryCell = subscribeSharedYjsDeep(observedPrimaryCell, decodePrimaryCell);
        }
      }

      // Keep the broad observer only while the row structure is incomplete.
      // Once the primary cell exists, shallow map observers detect structural
      // replacement and the cell observer handles value changes.
      if (observedPrimaryCell) {
        cleanupStructuralHydration?.();
        cleanupStructuralHydration = undefined;
      } else if (!cleanupStructuralHydration) {
        cleanupStructuralHydration = subscribeSharedYjsDeep(data, syncStructure);
      }

      decodePrimaryCell();
    };

    const handleCellsChange = (event: Y.YMapEvent<unknown>) => {
      if (!fieldId || event.keysChanged.has(fieldId)) syncPrimaryCell();
    };

    const handleRowChange = (event: Y.YMapEvent<unknown>) => {
      if (event.keysChanged.has(YjsDatabaseKey.cells)) syncStructure();
    };

    function syncStructure() {
      const nextRow = data.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
      const nextCells = nextRow?.get(YjsDatabaseKey.cells);

      if (nextRow !== observedRow) {
        observedRow?.unobserve(handleRowChange);
        observedRow = nextRow;
        observedRow?.observe(handleRowChange);
      }

      if (nextCells !== observedCells) {
        observedCells?.unobserve(handleCellsChange);
        observedCells = nextCells;
        observedCells?.observe(handleCellsChange);
      }

      syncPrimaryCell();
    }

    const handleDataChange = (event: Y.YMapEvent<unknown>) => {
      if (event.keysChanged.has(YjsEditorKey.database_row)) syncStructure();
    };

    data.observe(handleDataChange);
    syncStructure();

    const cleanupField = field ? subscribeSharedYjsDeep(field, decodePrimaryCell) : undefined;

    return () => {
      cleanupStructuralHydration?.();
      cleanupPrimaryCell?.();
      cleanupField?.();
      observedCells?.unobserve(handleCellsChange);
      observedRow?.unobserve(handleRowChange);
      data.unobserve(handleDataChange);
    };
  }, [field, fieldId, rowDoc]);

  useEffect(() => {
    onTextChange?.(text ?? '');
  }, [onTextChange, text]);

  return <div>{text}</div>;
}
