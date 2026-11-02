import { useCallback, useEffect, useRef, useState } from 'react';

import { useDashboardUi } from '../DashboardUiContext';

type WidgetLayer = 'menu' | 'settings';

/**
 * The widget menu and the settings host of one widget: at most one is open.
 * Opening either selects the widget (an outline in Edit mode); closing it
 * clears the selection unless the other one took over. The settings host only
 * exists in Edit mode, so leaving Edit mode closes it.
 */
export function useWidgetLayers(widgetId: string, editing: boolean) {
  const { selectWidget } = useDashboardUi();
  const [layer, setLayerState] = useState<WidgetLayer | null>(null);
  // Read by the setters at call time, so they keep their identity.
  const layerRef = useRef<WidgetLayer | null>(null);

  const setLayer = useCallback(
    (kind: WidgetLayer, open: boolean) => {
      // Closing a layer that is not the open one leaves the other alone.
      const next = open ? kind : layerRef.current === kind ? null : layerRef.current;

      layerRef.current = next;
      setLayerState(next);
      if (open) selectWidget(widgetId);
      else if (next === null) selectWidget(null, { onlyIf: widgetId });
    },
    [selectWidget, widgetId]
  );
  const setMenuOpen = useCallback((open: boolean) => setLayer('menu', open), [setLayer]);
  const setSettingsOpen = useCallback((open: boolean) => setLayer('settings', open), [setLayer]);

  useEffect(() => {
    if (!editing && layerRef.current === 'settings') setSettingsOpen(false);
  }, [editing, setSettingsOpen]);

  return { menuOpen: layer === 'menu', settingsOpen: layer === 'settings', setMenuOpen, setSettingsOpen };
}
