import { useTranslation } from 'react-i18next';

import { CHART_LEGEND_POSITIONS, ChartLegendPosition } from '@/application/database-yjs/chart-extended-settings';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

const POSITION_FALLBACKS: Record<ChartLegendPosition, string> = { auto: 'Auto', off: 'Off', bottom: 'Bottom' };

export interface ChartLegendSettingProps {
  value: ChartLegendPosition;
  onChange: (position: ChartLegendPosition) => void;
}

/** The Legend row of the chart style settings (`legend_position`): Auto, Off or Bottom. */
export function ChartLegendSetting({ value, onChange }: ChartLegendSettingProps) {
  const { t } = useTranslation();
  const label = (position: ChartLegendPosition) =>
    t(`chart.legend.${position}`, { defaultValue: POSITION_FALLBACKS[position] });

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid='chart-style-legend'>
        <span>{t('chart.style.legend', { defaultValue: 'Legend' })}</span>
        <span className='ml-auto text-text-secondary'>{label(value)}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          {CHART_LEGEND_POSITIONS.map((position) => (
            <DropdownMenuItem
              className='w-full'
              data-testid={`chart-style-legend-option-${position}`}
              key={position}
              onSelect={(event) => {
                event.preventDefault();
                onChange(position);
              }}
            >
              <span>{label(position)}</span>
              {value === position ? <DropdownMenuItemTick /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default ChartLegendSetting;
