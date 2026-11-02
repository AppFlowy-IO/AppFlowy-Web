import { ComponentType, SVGProps, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartType } from '@/application/database-yjs/chart.type';
import { ReactComponent as BarIcon } from '@/assets/icons/chart_type_bar.svg';
import { ReactComponent as DonutIcon } from '@/assets/icons/chart_type_donut.svg';
import { ReactComponent as HorizontalBarIcon } from '@/assets/icons/chart_type_horizontal_bar.svg';
import { ReactComponent as LineIcon } from '@/assets/icons/chart_type_line.svg';
import { ReactComponent as CrownIcon } from '@/assets/icons/crown.svg';
import { ReactComponent as NumberIcon } from '@/assets/icons/hashtag.svg';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ChartTypeOption {
  type: ChartType;
  /** `dash-chart-type-button-{slug}`, `chart-type-{slug}`. */
  slug: string;
  labelKey: string;
  fallback: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** In Notion's order: Vertical bar, Horizontal bar, Line, Donut, Number. */
export const CHART_TYPE_OPTIONS: readonly ChartTypeOption[] = [
  { type: ChartType.Bar, slug: 'bar', labelKey: 'chart.settings.verticalBar', fallback: 'Vertical bar', Icon: BarIcon },
  {
    type: ChartType.HorizontalBar,
    slug: 'horizontal-bar',
    labelKey: 'chart.settings.horizontalBar',
    fallback: 'Horizontal bar',
    Icon: HorizontalBarIcon,
  },
  { type: ChartType.Line, slug: 'line', labelKey: 'chart.settings.line', fallback: 'Line', Icon: LineIcon },
  { type: ChartType.Donut, slug: 'donut', labelKey: 'chart.settings.donut', fallback: 'Donut', Icon: DonutIcon },
  { type: ChartType.Number, slug: 'number', labelKey: 'chart.settings.number', fallback: 'Number', Icon: NumberIcon },
];

/**
 * Only the vertical bar chart is free on AppFlowy-hosted workspaces without a
 * Pro plan (desktop `ChartUtils.isPremiumChartType`); self-hosted servers get
 * every type (`useSubscriptionPlan` reports Pro for them).
 */
export function isPremiumChartType(type: ChartType): boolean {
  return type !== ChartType.Bar;
}

export interface ChartTypeRowProps {
  value: ChartType;
  isPro: boolean;
  /**
   * Whether `isPro` is the workspace's plan. False while a hosted workspace's
   * plan loads, or after its request failed: a premium type is then neither
   * locked nor free, and a click on one resolves the plan first.
   */
  planKnown: boolean;
  isHosted: boolean;
  onChange: (type: ChartType) => void;
  onUpgrade: () => void;
  /** Resolves the plan; null means the request failed or its workspace is no longer current. */
  resolvePro: () => Promise<boolean | null>;
}

/**
 * The chart type icon row (WP11 §1.1): five 48×48 buttons, radius 8, a 1px
 * border and a 20px icon; the selected one has a 2px accent border and an
 * accent icon. A premium type shows the crown and opens the upgrade prompt.
 * The selected type is the chart's, crown or not (desktop `ChartTypeGrid`):
 * a downgraded workspace sees its Line chart selected.
 */
export function ChartTypeRow({ value, isPro, planKnown, isHosted, onChange, onUpgrade, resolvePro }: ChartTypeRowProps) {
  const { t } = useTranslation();
  const choiceGeneration = useRef(0);

  useEffect(() => () => { choiceGeneration.current += 1; }, []);
  // Only a hosted workspace's plan can be unknown; elsewhere `isPro` is the policy's answer.
  const gated = planKnown || !isHosted;
  const pick = async (type: ChartType) => {
    const generation = ++choiceGeneration.current;

    if (!isPremiumChartType(type)) {
      onChange(type);
      return;
    }

    const pro = gated ? isPro : await resolvePro();

    if (generation !== choiceGeneration.current || pro === null) return;
    if (pro) onChange(type);
    else onUpgrade();
  };

  return (
    <div data-parity-id='dash-chart-type-row' data-testid='chart-type-row' className='flex items-center justify-between py-1'>
      {CHART_TYPE_OPTIONS.map(({ type, slug, labelKey, fallback, Icon }) => {
        const label = t(labelKey, { defaultValue: fallback });
        const locked = gated && !isPro && isPremiumChartType(type);
        const selected = value === type;
        const upgradeLabel = t('chart.upgradeRequired', { defaultValue: 'Upgrade Required' });

        return (
          <Tooltip key={type} delayDuration={500}>
            <TooltipTrigger asChild>
              <button
                type='button'
                aria-label={locked && isHosted ? `${label} (${upgradeLabel})` : label}
                aria-pressed={selected}
                disabled={locked && !isHosted}
                data-testid={`chart-type-${slug}`}
                data-parity-id={`dash-chart-type-button-${slug}`}
                data-selected={selected ? 'true' : 'false'}
                className={cn(
                  'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border outline-none',
                  'hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill disabled:cursor-not-allowed disabled:opacity-50',
                  selected ? 'border-2 border-dash-accent text-dash-accent' : 'border-border-primary text-dash-tool-icon'
                )}
                onClick={() => void pick(type)}
              >
                <Icon
                  aria-hidden='true'
                  className='h-5 w-5 [&_*]:stroke-current'
                  data-parity-id={`dash-chart-type-button-${slug}__icon`}
                />
                {locked && isHosted ? (
                  <CrownIcon
                    aria-hidden='true'
                    className='absolute -right-1 -top-1 h-3 w-3 text-icon-warning-thick'
                    data-testid={`chart-type-${slug}-crown`}
                  />
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent side='bottom'>{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export default ChartTypeRow;
