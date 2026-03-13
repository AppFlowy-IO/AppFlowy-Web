import { createContext, useContext } from 'react';

type HoverControlsContextType = {
  showPreventDialog: (continueCallback: () => void) => void;
};

export const HoverControlsContext = createContext<HoverControlsContextType | undefined>(undefined);

export const HoverControlsProvider = HoverControlsContext.Provider;

export function useHoverControlsContext () {
  const context = useContext(HoverControlsContext);

  if (!context) {
    throw new Error('useHoverControlsContext must be used within a HoverControlsProvider');
  }

  return context;
}
