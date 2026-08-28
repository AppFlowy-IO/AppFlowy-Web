import { createContext, useContext } from 'react';

interface DatabaseConditionsContextType {
  expanded: boolean;
  toggleExpanded: () => void;
  setExpanded: (expanded: boolean) => void;
  openFilterId?: string;
  setOpenFilterId?: (id?: string) => void;

  // Advanced filter mode
  isAdvancedMode: boolean;
  setAdvancedMode: (advanced: boolean) => void;

  // Controls the "N rules" badge popover so that creating a filter from the
  // toolbar / add-filter button / field menu can auto-open the panel,
  // mirroring desktop's ToggleFilterValueListener behaviour.
  advancedPanelOpen?: boolean;
  setAdvancedPanelOpen?: (open: boolean) => void;

  // Controls the sort chip popover so adding a sort from the toolbar can
  // auto-open the sort editor (desktop parity).
  sortMenuOpen?: boolean;
  setSortMenuOpen?: (open: boolean) => void;
}

export function useConditionsContext() {
  return useContext(DatabaseConditionsContext);
}

export const DatabaseConditionsContext = createContext<DatabaseConditionsContextType | undefined>(undefined);

/**
 * Stable action setters only — the value never changes identity, so consumers
 * that just dispatch actions (e.g. every grid column header menu) don't
 * re-render when openFilterId / expanded / panel state churn.
 */
export interface DatabaseConditionsActions {
  setExpanded: (expanded: boolean) => void;
  setOpenFilterId: (id?: string) => void;
  setAdvancedMode: (advanced: boolean) => void;
  setAdvancedPanelOpen: (open: boolean) => void;
  setSortMenuOpen: (open: boolean) => void;
}

export const DatabaseConditionsActionsContext = createContext<DatabaseConditionsActions | undefined>(undefined);

export function useConditionsActions() {
  return useContext(DatabaseConditionsActionsContext);
}
