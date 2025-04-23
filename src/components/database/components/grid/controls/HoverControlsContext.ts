import { createContext, useContext } from 'react';

export const HoverControlsContext = createContext<{
  showPreventDialog: (continueCallback: () => void) => void;
}>({
  showPreventDialog: (_continue: () => void) => {
    //
  },
});

export const HoverControlsProvider = HoverControlsContext.Provider;

export function useHoverControlsContext () {
  const context = useContext(HoverControlsContext);

  if (!context) {
    throw new Error('useHoverControlsContext must be used within a HoverControlsProvider');
  }

  return context;
}