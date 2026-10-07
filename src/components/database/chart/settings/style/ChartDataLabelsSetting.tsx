import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartSettingsRow } from '../ChartSettingsRow';

export interface ChartDataLabelsSettingProps {
  value: boolean;
  icon?: ReactNode;
  onChange: (showDataLabels: boolean) => void;
}

/** The Data labels toggle of the chart style section (`show_data_labels`, WP10); it also hides donut outside labels. */
export function ChartDataLabelsSetting({ value, icon, onChange }: ChartDataLabelsSettingProps) {
  const { t } = useTranslation();

  return (
    <ChartSettingsRow
      rowId='style_data_labels'
      icon={icon}
      label={t('chart.settings.dataLabels', { defaultValue: 'Data labels' })}
      toggle={{ checked: value, onChange }}
    />
  );
}

export default ChartDataLabelsSetting;
