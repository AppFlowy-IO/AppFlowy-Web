import { ComponentType, ReactNode, SVGProps } from 'react';

import { ReactComponent as WhatToShowIcon } from '@/assets/icons/alt_arrow_up.svg';
import { ReactComponent as CalendarIcon } from '@/assets/icons/calendar.svg';
import { ReactComponent as ChartIcon } from '@/assets/icons/chart.svg';
import { ReactComponent as ListIcon } from '@/assets/icons/list.svg';
import { ReactComponent as NumberIcon } from '@/assets/icons/number.svg';
import { ReactComponent as PaletteIcon } from '@/assets/icons/palette.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import { ReactComponent as SortIcon } from '@/assets/icons/sort.svg';
import { ReactComponent as TextIcon } from '@/assets/icons/text.svg';

type PanelIconName = 'alt_arrow_up' | 'calendar' | 'chart' | 'list' | 'number' | 'palette' | 'show' | 'sort' | 'text';

const PANEL_ICONS: Readonly<Record<PanelIconName, ComponentType<SVGProps<SVGSVGElement>>>> = {
  alt_arrow_up: WhatToShowIcon,
  calendar: CalendarIcon,
  chart: ChartIcon,
  list: ListIcon,
  number: NumberIcon,
  palette: PaletteIcon,
  show: ShowIcon,
  sort: SortIcon,
  text: TextIcon,
};

/**
 * The logical icon of each panel row, the same on both clients and pinned by
 * `chart-panel.json#rowIcons` (the asset name, without `.svg`).
 */
export const CHART_PANEL_ROW_ICONS: Readonly<Record<string, PanelIconName>> = {
  x_what: 'alt_arrow_up',
  y_what: 'alt_arrow_up',
  x_date_grouping: 'calendar',
  x_text_grouping: 'text',
  x_buckets: 'number',
  x_sort: 'sort',
  x_groups: 'show',
  x_show_empty: 'show',
  y_calculate: 'number',
  y_decimals: 'number',
  y_group_by: 'list',
  y_group_style: 'chart',
  y_cumulative: 'chart',
  style_color: 'palette',
  style_data_labels: 'number',
  style_legend: 'list',
  number_title: 'text',
  number_format: 'number',
  number_color: 'palette',
};

/** The 16px icon of a panel row, or nothing for rows without one. */
export function chartPanelIconOf(rowId: string): ReactNode {
  const name = CHART_PANEL_ROW_ICONS[rowId];
  const Icon = name ? PANEL_ICONS[name] : undefined;

  return Icon ? <Icon aria-hidden='true' /> : null;
}
