import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CHART_LEGEND_POSITIONS, ChartLegendPosition } from '@/application/database-yjs/chart-extended-settings';

import { ChartSettingsRow } from '../ChartSettingsRow';
import { OptionListPage } from '../pages/OptionListPage';

const POSITION_FALLBACKS: Record<ChartLegendPosition, string> = { auto: 'Auto', off: 'Off', bottom: 'Bottom' };

function useLegendLabel() {
  const { t } = useTranslation();

  return (position: ChartLegendPosition) => t(`chart.legend.${position}`, { defaultValue: POSITION_FALLBACKS[position] });
}

export interface ChartLegendSettingProps {
  value: ChartLegendPosition;
  icon?: ReactNode;
  onOpen: () => void;
}

/** The Legend row of the chart style section (`legend_position`, WP10): Auto, Off or Bottom; opens its page. */
export function ChartLegendSetting({ value, icon, onOpen }: ChartLegendSettingProps) {
  const { t } = useTranslation();
  const label = useLegendLabel();

  return (
    <ChartSettingsRow
      rowId='style_legend'
      icon={icon}
      label={t('chart.settings.legend', { defaultValue: 'Legend' })}
      value={label(value)}
      onClick={onOpen}
    />
  );
}

export interface ChartLegendPageProps {
  value: ChartLegendPosition;
  onChange: (position: ChartLegendPosition) => void;
  onBack: () => void;
}

export function ChartLegendPage({ value, onChange, onBack }: ChartLegendPageProps) {
  const { t } = useTranslation();
  const label = useLegendLabel();

  return (
    <OptionListPage
      title={t('chart.settings.legend', { defaultValue: 'Legend' })}
      page='style-legend'
      selected={value}
      onSelect={onChange}
      onBack={onBack}
      options={CHART_LEGEND_POSITIONS.map((position) => ({ value: position, label: label(position), testValue: position }))}
    />
  );
}

export default ChartLegendSetting;
