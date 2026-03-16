import { useContext } from 'react';

import { PanelContext } from '@/components/editor/components/panels/PanelsContext';

export function usePanelContext () {
  const panel = useContext(PanelContext);

  if (!panel) {
    throw new Error('usePanelContext must be used within a PanelProvider');
  }

  return panel;
}
