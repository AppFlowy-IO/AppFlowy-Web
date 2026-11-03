import { ReactNode } from 'react';

import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';

import { ChartSettingsSubPage } from '../ChartSettingsSubPage';

export interface ChartOption<V> {
  value: V;
  label: string;
  /** The value part of the test id `chart-option-{page}-{testValue}`. */
  testValue: string;
  /** Shown before the check (a sample, swatches). */
  trailing?: ReactNode;
  /** A divider follows this option. */
  dividerAfter?: boolean;
}

/** One single-choice row: label, optional trailing content and a 16px check on the selected one. */
export function ChartOptionRow({
  page,
  testValue,
  label,
  trailing,
  selected,
  onSelect,
}: {
  page: string;
  testValue: string;
  label: ReactNode;
  trailing?: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type='button'
      role='menuitemradio'
      aria-checked={selected}
      data-testid={`chart-option-${page}-${testValue}`}
      className='flex h-7 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-left text-sm leading-5 text-text-primary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
      onClick={onSelect}
    >
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {trailing}
      <span className='flex h-4 w-4 shrink-0 items-center justify-center'>
        {selected ? <CheckIcon aria-hidden='true' className='h-4 w-4 text-icon-primary' /> : null}
      </span>
    </button>
  );
}

export interface OptionListPageProps<V> {
  title: string;
  /** The page part of the option test ids (`x-sort`, `style-legend`). */
  page: string;
  options: readonly ChartOption<V>[];
  selected: V;
  onSelect: (value: V) => void;
  onBack: () => void;
}

/** A generic single-choice page: sort, date grouping, text grouping, legend, decimals, format. */
export function OptionListPage<V>({ title, page, options, selected, onSelect, onBack }: OptionListPageProps<V>) {
  return (
    <ChartSettingsSubPage title={title} onBack={onBack}>
      <div role='menu' aria-label={title} className='flex flex-col'>
        {options.map((option) => (
          <div key={option.testValue} className='flex flex-col'>
            <ChartOptionRow
              page={page}
              testValue={option.testValue}
              label={option.label}
              trailing={option.trailing}
              selected={option.value === selected}
              onSelect={() => onSelect(option.value)}
            />
            {option.dividerAfter ? <div className='my-1 h-px shrink-0 bg-border-primary' role='separator' /> : null}
          </div>
        ))}
      </div>
    </ChartSettingsSubPage>
  );
}

export default OptionListPage;
