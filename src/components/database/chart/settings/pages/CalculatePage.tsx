import { useTranslation } from 'react-i18next';

import { calculateMenu } from '@/application/database-yjs/chart-config';
import { ChartType } from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { getChartAggregationLabel } from '@/components/database/chart/widgets/numberChartUtils';

import { ChartSettingsSubPage } from '../ChartSettingsSubPage';

export interface CalculatePageProps {
  title: string;
  yType: FieldType | null;
  chartType: ChartType;
  /** The effective aggregation, checked in the list. */
  selected: number;
  onSelect: (aggregation: number) => void;
  onBack: () => void;
}

const GROUPS = [
  { key: 'count', labelKey: 'chart.settings.count', fallback: 'Count' },
  { key: 'percent', labelKey: 'chart.settings.percent', fallback: 'Percent' },
  { key: 'more', labelKey: 'chart.settings.moreOptions', fallback: 'More options' },
] as const;

/** The Calculate page (WP11 §1.9): Count, Percent and More options; an empty group is left out. */
export function CalculatePage({ title, yType, chartType, selected, onSelect, onBack }: CalculatePageProps) {
  const { t } = useTranslation();
  const menu = calculateMenu(yType, chartType);

  return (
    <ChartSettingsSubPage title={title} onBack={onBack}>
      <div role='menu' aria-label={title} className='flex flex-col'>
        {GROUPS.map(({ key, labelKey, fallback }) =>
          menu[key].length === 0 ? null : (
            <div key={key} className='flex flex-col' data-testid={`chart-agg-group-${key}`}>
              <div className='px-2 pb-1 pt-2 text-xs font-medium leading-4 text-text-secondary' data-agg-group-header>
                {t(labelKey, { defaultValue: fallback })}
              </div>
              {menu[key].map((aggregation) => (
                <button
                  key={aggregation}
                  type='button'
                  role='menuitemradio'
                  aria-checked={aggregation === selected}
                  data-testid={`chart-agg-${aggregation}`}
                  className='flex h-7 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-left text-sm leading-5 text-text-primary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
                  onClick={() => onSelect(aggregation)}
                >
                  <span className='min-w-0 flex-1 truncate'>{getChartAggregationLabel(t, aggregation)}</span>
                  {aggregation === selected ? (
                    <CheckIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-primary' />
                  ) : null}
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </ChartSettingsSubPage>
  );
}

export default CalculatePage;
