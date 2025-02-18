import { DEFAULT_ROW_HEIGHT, useDatabaseContext } from '@/application/database-yjs';
import { useCallback, useRef } from 'react';

export function useMeasureHeight ({
  forceUpdate,
  rows,
}: {
  forceUpdate: (index: number) => void;
  rows: {
    rowId?: string;
  }[];
}) {
  const isDocumentBlock = useDatabaseContext().isDocumentBlock;
  const heightRef = useRef<{ [rowId: string]: number }>({});
  const rowHeight = useCallback(
    (index: number) => {
      const row = rows[index];

      if (!row || !row.rowId) return DEFAULT_ROW_HEIGHT;

      return heightRef.current[row.rowId] || DEFAULT_ROW_HEIGHT;
    },
    [rows],
  );

  const setRowHeight = useCallback(
    (index: number, height: number) => {
      const row = rows[index];
      const isLastRow = index === rows.length - 1;

      let newHeight = height;

      if (isLastRow && !isDocumentBlock) {
        newHeight += 144;
      }

      const rowId = row.rowId;

      if (!row || !rowId) return;
      const oldHeight = heightRef.current[rowId];

      heightRef.current[rowId] = Math.max(oldHeight || DEFAULT_ROW_HEIGHT, newHeight);

      if (oldHeight !== newHeight) {
        forceUpdate(index);
      }
    },
    [forceUpdate, rows, isDocumentBlock],
  );

  const onResize = useCallback(
    (rowIndex: number, columnIndex: number, size: { width: number; height: number }) => {
      setRowHeight(rowIndex, size.height);
    },
    [setRowHeight],
  );

  return {
    rowHeight,
    onResize,
  };
}
