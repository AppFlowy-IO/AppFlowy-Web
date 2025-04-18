import { createContext, useContext } from 'react';

export const GridContext = createContext<{
  hoverRowId?: string;
  setHoverRowId: (hoverRowId?: string) => void;
}>({
  setHoverRowId: (_hoverRowId?: string) => undefined,
});

export function useGridContext () {
  const context = useContext(GridContext);

  if (!context) {
    throw new Error('useGridContext must be used within the context');
  }

  return context;
}