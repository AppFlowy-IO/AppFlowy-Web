import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChartLayoutSetting, usePropertiesSelector } from '@/application/database-yjs';
import { useUpdateChartSetting } from '@/application/database-yjs/dispatch';
import { ChartType, isGroupableFieldType } from '@/application/database-yjs/chart.type';
import { ReactComponent as ChartIcon } from '@/assets/icons/chart.svg';
import { FieldDisplay } from '@/components/database/components/field';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

const CHART_TYPES = [
  { type: ChartType.Bar, label: 'Bar' },
  { type: ChartType.HorizontalBar, label: 'Horizontal Bar' },
  { type: ChartType.Line, label: 'Line' },
  { type: ChartType.Donut, label: 'Donut' },
];

function ChartLayoutSettings() {
  const { t } = useTranslation();
  const chartSetting = useChartLayoutSetting();
  const updateChartSetting = useUpdateChartSetting();

  const { properties: allProperties } = usePropertiesSelector(false);

  // Filter to only groupable fields (SingleSelect, MultiSelect, Checkbox)
  const groupableFields = useMemo(() => {
    return allProperties.filter((property) => isGroupableFieldType(property.type));
  }, [allProperties]);

  const handleChartTypeChange = (chartType: ChartType) => {
    updateChartSetting({ chartType });
  };

  const handleXFieldChange = (fieldId: string) => {
    updateChartSetting({ xFieldId: fieldId });
  };

  const currentChartType = chartSetting?.chartType ?? ChartType.Bar;
  const currentXFieldId = chartSetting?.xFieldId || '';

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ChartIcon className="h-4 w-4" />
        {t('grid.settings.chartSettings', 'Chart settings')}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={'appflowy-scroller max-w-[260px] overflow-y-auto'}>
          {/* Chart Type Section */}
          <DropdownMenuLabel>{t('chart.chartType', 'Chart type')}</DropdownMenuLabel>
          {CHART_TYPES.map(({ type, label }) => (
            <DropdownMenuItem
              key={type}
              className={'w-full'}
              onSelect={(e) => {
                e.preventDefault();
                handleChartTypeChange(type);
              }}
            >
              <span>{label}</span>
              {currentChartType === type && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          {/* X-Axis Field Section */}
          <DropdownMenuLabel>{t('chart.xAxis', 'X-Axis')}</DropdownMenuLabel>
          {groupableFields.length === 0 ? (
            <div className="px-2 py-2 text-xs text-text-secondary">
              {t('chart.noGroupableFields', 'No groupable fields available')}
            </div>
          ) : (
            groupableFields.map((property) => (
              <DropdownMenuItem
                key={property.id}
                className={'w-full'}
                onSelect={(e) => {
                  e.preventDefault();
                  handleXFieldChange(property.id);
                }}
              >
                <FieldDisplay fieldId={property.id} />
                {currentXFieldId === property.id && <DropdownMenuItemTick />}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default ChartLayoutSettings;
