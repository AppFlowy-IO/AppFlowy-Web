import { useEffect, useState } from 'react';

import { useDatabase, useDatabaseViewId } from '@/application/database-yjs';
import {
  ChartAggregationType,
  ChartLayoutKeys,
  ChartLayoutSettings,
  ChartType,
  CHART_LAYOUT_SETTINGS_KEY,
} from '@/application/database-yjs/chart.type';
import { YjsDatabaseKey } from '@/application/types';

/**
 * Hook to read chart layout settings from YJS
 * Returns chart settings stored in layout_settings['3'] for the current view
 */
export function useChartSettings(): ChartLayoutSettings | null {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const [settings, setSettings] = useState<ChartLayoutSettings | null>(null);

  useEffect(() => {
    const view = database.get(YjsDatabaseKey.views)?.get(viewId);

    const observerHandler = () => {
      const layoutSettings = view?.get(YjsDatabaseKey.layout_settings)?.get(CHART_LAYOUT_SETTINGS_KEY);

      if (!layoutSettings) {
        // Return default settings if no chart settings exist
        setSettings({
          chartType: ChartType.Bar,
          xFieldId: '',
          showEmptyValues: true,
          aggregationType: ChartAggregationType.Count,
        });
        return;
      }

      const chartType = Number(layoutSettings.get(ChartLayoutKeys.chartType) ?? ChartType.Bar);
      const xFieldId = String(layoutSettings.get(ChartLayoutKeys.xFieldId) ?? '');
      const showEmptyValues = Boolean(layoutSettings.get(ChartLayoutKeys.showEmptyValues) ?? true);
      const aggregationType = Number(layoutSettings.get(ChartLayoutKeys.aggregationType) ?? ChartAggregationType.Count);
      const yFieldId = layoutSettings.get(ChartLayoutKeys.yFieldId);

      setSettings({
        chartType,
        xFieldId,
        showEmptyValues,
        aggregationType,
        yFieldId: yFieldId ? String(yFieldId) : undefined,
      });
    };

    observerHandler();
    view?.observeDeep(observerHandler);

    return () => {
      view?.unobserveDeep(observerHandler);
    };
  }, [database, viewId]);

  return settings;
}

export default useChartSettings;
