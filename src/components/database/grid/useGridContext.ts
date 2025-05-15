import { RenderRow } from '@/components/database/components/grid/grid-row';
import { createContext, useContext } from 'react';

export const GridContext = createContext<{
  hoverRowId?: string;
  setHoverRowId: (hoverRowId?: string) => void;
  rows: RenderRow[];
  setRows: (rows: RenderRow[]) => void;
  showStickyHeader: boolean;
  activePropertyId?: string;
  setActivePropertyId: (activePropertyId?: string) => void;
  setShowStickyHeader: (show: boolean) => void;
  needResizeRowId?: string;
  setNeedResizeRowId: (needResizeRowId?: string) => void;
  activeCell?: {
    rowId: string;
    fieldId: string;
  };
  setActiveCell: (activeCell?: { rowId: string; fieldId: string }) => void;
}>({
  showStickyHeader: false,
  rows: [],
  setRows: (_rows: RenderRow[]) => undefined,
  setHoverRowId: (_hoverRowId?: string) => undefined,
  setActivePropertyId: (_activePropertyId?: string) => undefined,
  setShowStickyHeader: (_show: boolean) => undefined,
  setNeedResizeRowId: (_needResizeRowId?: string) => undefined,
  setActiveCell: (_activeCell?: { rowId: string; fieldId: string }) => undefined,
});

export function useGridContext () {
  const context = useContext(GridContext);

  if (!context) {
    throw new Error('useGridContext must be used within the context');
  }

  return context;
}