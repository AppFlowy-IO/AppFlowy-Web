import { useCallback } from 'react';

import { ChartDataItem } from '@/application/database-yjs/chart.type';

import { DataLabel } from './ChartAxisParts';

/** The props Recharts passes to a `LabelList` content renderer. */
interface RechartsLabelProps {
  index?: number;
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
}

/**
 * The `LabelList` renderer of a cartesian chart: the data label the layout
 * kept for the category, on its bar (`bar`) or its line point (`point`).
 * Stable while the data and the layout's labels are, so Recharts does not
 * rebuild the label layer for an unchanged chart.
 */
export function useDataLabelRenderer(
  data: readonly ChartDataItem[],
  dataLabels: ReadonlyArray<string | null> | null,
  layout: 'vertical' | 'horizontal',
  target: 'bar' | 'point'
) {
  return useCallback(
    (props: RechartsLabelProps) => {
      const index = props.index ?? 0;
      const item = data[index];
      const text = dataLabels?.[index];

      if (!item || text === null || text === undefined) return null;
      const onBar = target === 'bar';

      return (
        <DataLabel
          layout={layout}
          target={{
            index,
            value: item.value,
            label: item.label,
            text,
            x: Number(props.x),
            y: Number(props.y),
            width: onBar ? Number(props.width) : 0,
            height: onBar ? Number(props.height) : 0,
          }}
        />
      );
    },
    [data, dataLabels, layout, target]
  );
}

export default useDataLabelRenderer;
