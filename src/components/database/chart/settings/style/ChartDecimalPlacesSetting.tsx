import { useTranslation } from 'react-i18next';

import { CHART_MAX_DECIMAL_PLACES } from '@/application/database-yjs/chart-extended-settings';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

/** Auto, then 0–5 decimal places shown as samples: `1`, `1.0`, `1.00`, … */
const OPTIONS: ReadonlyArray<number | null> = [null, ...Array.from({ length: CHART_MAX_DECIMAL_PLACES + 1 }, (_, i) => i)];

function sample(places: number) {
  return (1).toFixed(places);
}

export interface ChartDecimalPlacesSettingProps {
  /** `decimal_places`; null is auto. */
  value: number | null;
  /** Auto passes `null`, which resets the key. */
  onChange: (decimalPlaces: number | null) => void;
}

/** The Decimal places row of the chart style settings (`decimal_places`). */
export function ChartDecimalPlacesSetting({ value, onChange }: ChartDecimalPlacesSettingProps) {
  const { t } = useTranslation();
  const auto = t('chart.decimalPlaces.auto', { defaultValue: 'Auto' });

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid='chart-style-decimal-places'>
        <span>{t('chart.style.decimalPlaces', { defaultValue: 'Decimal places' })}</span>
        <span className='ml-auto text-text-secondary'>{value === null ? auto : sample(value)}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          {OPTIONS.map((places) => (
            <DropdownMenuItem
              className='w-full'
              data-testid={`chart-style-decimal-places-option-${places === null ? 'auto' : places}`}
              key={places ?? 'auto'}
              onSelect={(event) => {
                event.preventDefault();
                onChange(places);
              }}
            >
              <span className={places === null ? undefined : 'tabular-nums'}>{places === null ? auto : sample(places)}</span>
              {value === places ? <DropdownMenuItemTick /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default ChartDecimalPlacesSetting;
