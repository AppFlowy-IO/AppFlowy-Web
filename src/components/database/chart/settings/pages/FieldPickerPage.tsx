import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { FieldDisplay } from '@/components/database/components/field';
import { normalizeDashboardText } from '@/utils/normalize-text';

import { ChartSettingsSubPage } from '../ChartSettingsSubPage';

export interface ChartFieldChoice {
  id: string;
  name: string;
}

export interface FieldPickerPageProps {
  title: string;
  /** Eligible properties in view order. */
  fields: readonly ChartFieldChoice[];
  selectedId: string | null;
  /** Y mode: a "Count all" choice first (`null`). */
  allowCountAll?: boolean;
  onSelect: (fieldId: string | null) => void;
  onBack: () => void;
}

const ITEM_CLASS =
  'flex h-7 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-left text-sm leading-5 text-text-primary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill';

/**
 * The property list of "What to show" (WP11 §1.3): a search box (matched
 * with `normalizeDashboardText`), then every eligible property with its type
 * icon, and "No results" when nothing matches.
 */
export function FieldPickerPage({ title, fields, selectedId, allowCountAll, onSelect, onBack }: FieldPickerPageProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const countAllLabel = t('chart.agg.countAll', { defaultValue: 'Count all' });
  const needle = normalizeDashboardText(query);
  const matches = useMemo(
    () => fields.filter((field) => !needle || normalizeDashboardText(field.name).includes(needle)),
    [fields, needle]
  );
  const showCountAll = allowCountAll && (!needle || normalizeDashboardText(countAllLabel).includes(needle));

  return (
    <ChartSettingsSubPage title={title} onBack={onBack} autoFocusBack={false}>
      <div className='px-0 pb-1'>
        <input
          // The search box takes focus when the page opens.
          autoFocus
          data-testid='chart-field-search'
          value={query}
          placeholder={t('chart.settings.searchProperty', { defaultValue: 'Search for a property…' })}
          aria-label={t('chart.settings.searchProperty', { defaultValue: 'Search for a property…' })}
          className='h-7 w-full rounded-[6px] border border-border-primary bg-transparent px-2 text-sm leading-5 text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-theme-thick'
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div role='menu' aria-label={title} className='flex flex-col'>
        {showCountAll ? (
          <button
            type='button'
            role='menuitemradio'
            aria-checked={selectedId === null}
            data-testid='chart-field-none'
            className={ITEM_CLASS}
            onClick={() => onSelect(null)}
          >
            <span className='min-w-0 flex-1 truncate'>{countAllLabel}</span>
            {selectedId === null ? <CheckIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-primary' /> : null}
          </button>
        ) : null}
        {matches.map((field) => (
          <button
            key={field.id}
            type='button'
            role='menuitemradio'
            aria-checked={selectedId === field.id}
            data-testid={`chart-field-${field.id}`}
            data-field-name={field.name}
            className={ITEM_CLASS}
            onClick={() => onSelect(field.id)}
          >
            <span className='flex min-w-0 flex-1 items-center gap-2 truncate'>
              <FieldDisplay fieldId={field.id} />
            </span>
            {selectedId === field.id ? (
              <CheckIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-primary' />
            ) : null}
          </button>
        ))}
        {!showCountAll && matches.length === 0 ? (
          <div data-testid='chart-field-no-results' className='flex h-7 items-center justify-center text-sm text-text-tertiary'>
            {t('chart.settings.noResults', { defaultValue: 'No results' })}
          </div>
        ) : null}
      </div>
    </ChartSettingsSubPage>
  );
}

export default FieldPickerPage;
