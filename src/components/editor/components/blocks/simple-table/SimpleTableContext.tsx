import { createContext, useContext } from 'react';

import { SimpleTableNode } from '@/components/editor/editor.type';

export interface SimpleTableContextValue {
  tableNode: SimpleTableNode;
  isHoveringTable: boolean;
  hoveringCell: { row: number; col: number } | null;
  readOnly: boolean;
  setHoveringCell: (cell: { row: number; col: number } | null) => void;
}

export const SimpleTableContext = createContext<SimpleTableContextValue | null>(null);

export function useSimpleTableContext() {
  return useContext(SimpleTableContext);
}
