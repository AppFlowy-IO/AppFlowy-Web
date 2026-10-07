import { forwardRef, KeyboardEvent, ReactNode } from 'react';

import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** The test id of a panel row: `chart-settings-row-x-sort` for `x_sort`. */
export function chartRowTestId(rowId: string) {
  return `chart-settings-row-${rowId.replace(/_/g, '-')}`;
}

const ROW_CLASS =
  'flex h-7 w-full min-w-0 shrink-0 items-center gap-2 rounded-[6px] px-2 text-left text-sm leading-5 text-text-primary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill';
const DISABLED_CLASS = 'cursor-default text-text-tertiary hover:bg-transparent focus-visible:bg-transparent';

export interface ChartSettingsRowProps {
  rowId: string;
  label: string;
  /** 16px leading icon in the tool icon color. */
  icon?: ReactNode;
  /** Trailing value (14/20 secondary, at most half the row). */
  value?: ReactNode;
  disabled?: boolean;
  /** A navigation row opens a page and shows a chevron. */
  onClick?: () => void;
  /** A toggle row shows a switch instead of a value and chevron. */
  toggle?: { checked: boolean; onChange: (checked: boolean) => void };
  /** The parity id of the row; "What to show" rows have their own. */
  parityId?: 'dash-chart-panel-row' | 'dash-chart-panel-row-what-to-show';
  /** Overrides `chart-settings-row-{rowId}`. */
  testId?: string;
}

/**
 * One 28px row of the chart settings panel (WP11 §1.2): icon, label, value
 * and chevron, or a switch. Hover and keyboard focus fill `dash.hoverFill`.
 */
export const ChartSettingsRow = forwardRef<HTMLElement, ChartSettingsRowProps>(function ChartSettingsRow(
  { rowId, label, icon, value, disabled, onClick, toggle, parityId = 'dash-chart-panel-row', testId },
  ref
) {
  const content = (
    <>
      {icon ? (
        <span
          aria-hidden='true'
          className='flex h-4 w-4 shrink-0 items-center justify-center text-dash-tool-icon [&_svg]:h-4 [&_svg]:w-4'
          data-parity-id={`${parityId}__icon`}
        >
          {icon}
        </span>
      ) : null}
      <span className='min-w-0 flex-1 truncate' data-parity-id={`${parityId}__label`}>
        {label}
      </span>
      {toggle ? (
        <Switch
          checked={toggle.checked}
          aria-hidden='true'
          tabIndex={-1}
          className='pointer-events-none ml-auto'
          data-parity-id={`${parityId}__toggle`}
        />
      ) : (
        <>
          {value !== undefined && value !== null && value !== '' ? (
            <span
              className='ml-auto max-w-[50%] truncate text-text-secondary'
              data-parity-id={`${parityId}__value`}
              data-row-value
            >
              {value}
            </span>
          ) : null}
          {onClick ? (
            <ChevronRightIcon
              aria-hidden='true'
              className='h-4 w-4 shrink-0 text-icon-tertiary'
              data-parity-id={`${parityId}__chevron`}
            />
          ) : null}
        </>
      )}
    </>
  );

  if (toggle) {
    const flip = () => {
      if (!disabled) toggle.onChange(!toggle.checked);
    };

    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        role='switch'
        aria-checked={toggle.checked}
        aria-disabled={disabled || undefined}
        aria-label={label}
        tabIndex={disabled ? -1 : 0}
        data-testid={testId ?? chartRowTestId(rowId)}
        data-row-id={rowId}
        data-parity-id={parityId}
        className={cn(ROW_CLASS, 'cursor-pointer', disabled && DISABLED_CLASS)}
        onClick={flip}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            flip();
          }
        }}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type='button'
      disabled={disabled}
      data-testid={testId ?? chartRowTestId(rowId)}
      data-row-id={rowId}
      data-parity-id={parityId}
      className={cn(ROW_CLASS, disabled && DISABLED_CLASS)}
      onClick={disabled ? undefined : onClick}
    >
      {content}
    </button>
  );
});

export default ChartSettingsRow;
