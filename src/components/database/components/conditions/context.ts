import { createContext, useContext } from 'react';

interface DatabaseConditionsContextType {
  expanded: boolean;
  toggleExpanded: () => void;
  setExpanded: (expanded: boolean) => void;
  openFilterId?: string;
  setOpenFilterId?: (id?: string) => void;
}

export function useConditionsContext() {
  return useContext(DatabaseConditionsContext);
}

export const DatabaseConditionsContext = createContext<DatabaseConditionsContextType | undefined>(undefined);
