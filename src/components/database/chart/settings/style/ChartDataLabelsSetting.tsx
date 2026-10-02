import { useTranslation } from 'react-i18next';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

export interface ChartDataLabelsSettingProps {
  value: boolean;
  onChange: (showDataLabels: boolean) => void;
}

/** The Data labels toggle of the chart style settings (`show_data_labels`); it also hides donut outside labels. */
export function ChartDataLabelsSetting({ value, onChange }: ChartDataLabelsSettingProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenuItem
      className='w-full'
      data-testid='chart-style-data-labels'
      onSelect={(event) => {
        event.preventDefault();
        onChange(!value);
      }}
    >
      {t('chart.style.dataLabels', { defaultValue: 'Data labels' })}
      <Switch checked={value} className='ml-auto' />
    </DropdownMenuItem>
  );
}

export default ChartDataLabelsSetting;
