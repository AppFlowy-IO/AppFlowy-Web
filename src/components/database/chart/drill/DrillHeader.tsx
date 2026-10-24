import { KeyboardEvent, ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { cn } from '@/lib/utils';

import {
  DRILL,
  DRILL_COUNT_STYLE,
  DRILL_DISMISS_STYLE,
  DRILL_HEADER_STYLE,
  DRILL_TITLE_STYLE,
  DRILL_TOOL_STYLE,
} from './drillStyles';

export interface DrillSearchState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The raw input; the rows follow it 300ms later. */
  value: string;
  setValue: (value: string) => void;
}

const toolClassName = cn(
  'flex shrink-0 items-center justify-center rounded-200 text-icon-secondary',
  'hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick',
  '[&_svg]:h-4 [&_svg]:w-4'
);

/** The Search button and, while open, its 200px input to the left (WP13 §3.6). */
export function DrillSearch({ search }: { search: DrillSearchState }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = t('chart.drilldown.search', { defaultValue: 'Search' });
  const { open, setOpen, value, setValue } = search;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Esc clears a query, then collapses the input; the dialog stays open.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (value) {
      setValue('');
      return;
    }

    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className='flex items-center gap-1'>
      {open ? (
        <input
          aria-label={label}
          className={cn(
            'h-7 rounded-200 border border-border-primary bg-fill-content px-2 text-sm text-text-primary outline-none',
            'placeholder:text-text-tertiary focus:border-border-theme-thick'
          )}
          data-testid='chart-drilldown-search-input'
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={label}
          ref={inputRef}
          style={{ width: DRILL.searchWidth, height: DRILL.toolButton }}
          value={value}
        />
      ) : null}
      <button
        aria-expanded={open}
        aria-label={label}
        className={toolClassName}
        data-parity-id='dash-drilldown-search'
        data-testid='chart-drilldown-search'
        onClick={() => {
          if (open) {
            setValue('');
            setOpen(false);
            return;
          }

          setOpen(true);
        }}
        ref={buttonRef}
        style={DRILL_TOOL_STYLE}
        title={label}
        type='button'
      >
        <SearchIcon aria-hidden='true' data-parity-id='dash-drilldown-search__icon' />
      </button>
    </div>
  );
}

/** The round Dismiss button (24px, hover fill, 14px close glyph). */
export function DrillDismiss({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const label = t('chart.drilldown.dismiss', { defaultValue: 'Dismiss' });

  return (
    <button
      aria-label={label}
      autoFocus
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-dash-hover-fill text-icon-secondary',
        'hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick',
        '[&_svg]:h-3.5 [&_svg]:w-3.5'
      )}
      data-parity-id='dash-drilldown-dismiss'
      data-testid='chart-drilldown-dismiss'
      onClick={onClose}
      style={DRILL_DISMISS_STYLE}
      title={label}
      type='button'
    >
      <CloseIcon aria-hidden='true' data-parity-id='dash-drilldown-dismiss__icon' />
    </button>
  );
}

/**
 * The drill-down header (WP13 §3.10): the title (the clicked category) and
 * "N rows", then from the right Dismiss, `···` and Search. A phone sheet
 * draws its own title and close: it shows the count and the tools only.
 */
export function DrillHeader({
  title,
  rowCount,
  search,
  more,
  onClose,
  variant,
}: {
  title: string;
  /** `undefined` while the rows load. */
  rowCount: number | undefined;
  search: DrillSearchState;
  /** The `···` menu; `null` when it has no entry (published pages). */
  more: ReactNode;
  onClose: () => void;
  variant: 'dialog' | 'sheet';
}) {
  const { t } = useTranslation();
  const count =
    rowCount === undefined ? null : (
      <span
        className='shrink-0 whitespace-nowrap text-text-tertiary'
        data-testid='chart-drilldown-count'
        style={DRILL_COUNT_STYLE}
      >
        {t('chart.drilldown.rowCount', { count: rowCount, defaultValue: '{{count}} rows' })}
      </span>
    );

  if (variant === 'sheet') {
    return (
      <div className='flex min-h-7 items-center gap-2 pb-2'>
        {count}
        <div className='ml-auto flex items-center gap-1'>
          <DrillSearch search={search} />
          {more}
        </div>
      </div>
    );
  }

  return (
    <div className='flex shrink-0 items-center gap-2' style={DRILL_HEADER_STYLE}>
      <h2
        className='min-w-0 truncate text-text-primary'
        data-parity-id='dash-drilldown__title'
        data-testid='chart-drilldown-title'
        style={DRILL_TITLE_STYLE}
        title={title}
      >
        {title}
      </h2>
      {count}
      <div className='ml-auto flex shrink-0 items-center gap-1'>
        <DrillSearch search={search} />
        {more}
        <DrillDismiss onClose={onClose} />
      </div>
    </div>
  );
}
