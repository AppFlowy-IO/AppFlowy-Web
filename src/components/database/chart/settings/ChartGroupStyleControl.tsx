import { KeyboardEvent, ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { CHART_GROUP_STYLES, ChartGroupStyle } from '@/application/database-yjs/chart-extended-settings';
import { cn } from '@/lib/utils';

const STYLE_LABELS: Record<ChartGroupStyle, [string, string]> = {
  stacked: ['chart.settings.groupStyleStacked', 'Stacked'],
  grouped: ['chart.settings.groupStyleGrouped', 'Grouped'],
  percent: ['chart.settings.groupStylePercent', 'Percent'],
};

export interface ChartGroupStyleControlProps {
  label: string;
  icon?: ReactNode;
  value: ChartGroupStyle;
  onChange: (value: ChartGroupStyle) => void;
}

/**
 * The Group style row of a bar chart with a Group by (WP12 §2.11): the label
 * above a full-width 3-segment control, Stacked | Grouped | Percent. The
 * selected segment has the theme selection fill and the action text; the
 * arrow keys move the selection, and each change writes `group_style`.
 */
export function ChartGroupStyleControl({ label, icon, value, onChange }: ChartGroupStyleControlProps) {
  const { t } = useTranslation();
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const count = CHART_GROUP_STYLES.length;
    const next = CHART_GROUP_STYLES[(index + count) % count];

    buttonsRef.current[(index + count) % count]?.focus();
    if (next !== value) onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      select(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(index - 1);
    }
  };

  // The label line's icon and text are direct children of the row (like every panel row), the control wraps below them.
  return (
    <div
      className='flex w-full min-w-0 flex-wrap items-center gap-x-2 px-2 pb-1 text-sm leading-5 text-text-primary'
      data-row-id='y_group_style'
      data-testid='chart-settings-group-style'
    >
      {icon ? (
        <span
          aria-hidden='true'
          className='flex h-7 w-4 shrink-0 items-center justify-center text-dash-tool-icon [&_svg]:h-4 [&_svg]:w-4'
        >
          {icon}
        </span>
      ) : null}
      <span className='flex h-7 min-w-0 flex-1 items-center truncate'>{label}</span>
      <div
        role='radiogroup'
        aria-label={label}
        data-testid='chart-group-style'
        className='flex h-7 w-full basis-full items-stretch gap-0.5 rounded-[8px] p-0.5 ring-1 ring-inset ring-border-primary'
      >
        {CHART_GROUP_STYLES.map((style, index) => {
          const selected = style === value;

          return (
            <button
              key={style}
              ref={(element) => {
                buttonsRef.current[index] = element;
              }}
              type='button'
              aria-pressed={selected}
              tabIndex={selected ? 0 : -1}
              data-testid={`chart-group-style-${style}`}
              className={cn(
                'flex min-w-0 flex-1 items-center justify-center truncate rounded-[6px] px-1 text-sm leading-5 outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick',
                selected ? 'bg-fill-theme-select text-text-action' : 'text-text-secondary hover:bg-fill-content-hover'
              )}
              onClick={() => {
                if (!selected) onChange(style);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {t(STYLE_LABELS[style][0], { defaultValue: STYLE_LABELS[style][1] })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ChartGroupStyleControl;
