import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CHART_MAX_DECIMAL_PLACES } from '@/application/database-yjs/chart-extended-settings';

import { ChartSettingsRow } from '../ChartSettingsRow';
import { OptionListPage } from '../pages/OptionListPage';

/** Default, then 0–5 decimal places shown as samples: `1`, `1.0`, `1.00`, … */
const OPTIONS: ReadonlyArray<number | null> = [null, ...Array.from({ length: CHART_MAX_DECIMAL_PLACES + 1 }, (_, i) => i)];

function sample(places: number) {
  return (1).toFixed(places);
}

export interface ChartDecimalPlacesSettingProps {
  /** `decimal_places`; null is the default. */
  value: number | null;
  icon?: ReactNode;
  onOpen: () => void;
}

/** The Decimal places row (`decimal_places`, WP10): "Default" or the number; opens its page. */
export function ChartDecimalPlacesSetting({ value, icon, onOpen }: ChartDecimalPlacesSettingProps) {
  const { t } = useTranslation();

  return (
    <ChartSettingsRow
      rowId='y_decimals'
      icon={icon}
      label={t('chart.settings.decimalPlaces', { defaultValue: 'Decimal places' })}
      value={value === null ? t('chart.settings.default', { defaultValue: 'Default' }) : String(value)}
      onClick={onOpen}
    />
  );
}

export interface ChartDecimalPlacesPageProps {
  value: number | null;
  /** Default passes `null`, which resets the key. */
  onChange: (decimalPlaces: number | null) => void;
  onBack: () => void;
}

/** The Decimal places page: Default, then 0–5 with a sample each. */
export function ChartDecimalPlacesPage({ value, onChange, onBack }: ChartDecimalPlacesPageProps) {
  const { t } = useTranslation();
  const defaultLabel = t('chart.settings.default', { defaultValue: 'Default' });

  return (
    <OptionListPage
      title={t('chart.settings.decimalPlaces', { defaultValue: 'Decimal places' })}
      page='y-decimals'
      selected={value}
      onSelect={onChange}
      onBack={onBack}
      options={OPTIONS.map((places) => ({
        value: places,
        label: places === null ? defaultLabel : sample(places),
        testValue: places === null ? 'default' : String(places),
      }))}
    />
  );
}

export default ChartDecimalPlacesSetting;
