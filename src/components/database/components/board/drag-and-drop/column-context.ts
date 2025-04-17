import { createContext, useContext } from 'react';

export type ColumnContextProps = {
  columnId: string;
  getCardIndex: (userId: string) => number;
  getNumCards: () => number;
};

export const ColumnContext = createContext<ColumnContextProps | null>(null);

export function useColumnContext (): ColumnContextProps {
  const value = useContext(ColumnContext);

  if (!value) {
    throw new Error('useColumnContext must be used within a ColumnProvider');
  }

  return value;
}
