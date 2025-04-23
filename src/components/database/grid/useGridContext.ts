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
}>({
  showStickyHeader: false,
  rows: [],
  setRows: () => undefined,
  setHoverRowId: (_hoverRowId?: string) => undefined,
  setActivePropertyId: (_activePropertyId?: string) => undefined,
  setShowStickyHeader: (_show: boolean) => undefined,
});

export function useGridContext () {
  const context = useContext(GridContext);

  if (!context) {
    throw new Error('useGridContext must be used within the context');
  }

  return context;
}