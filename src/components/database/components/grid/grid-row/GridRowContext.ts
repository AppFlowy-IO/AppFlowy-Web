import { createContext, useContext } from 'react';

type GridRowContextType = {
  isSticky?: boolean;
};

export const GridRowContext = createContext<GridRowContextType | undefined>(undefined);

export function useGridRowContext() {
  const context = useContext(GridRowContext);

  if (!context) {
    throw new Error('useGridRowContext must be used within a GridRowProvider');
  }

  return context;
}

export const GridRowProvider = GridRowContext.Provider;
