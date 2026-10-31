import { ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isChartDateFieldType } from '@/application/database-yjs/chart-config';
import { DateGroupCondition } from '@/application/database-yjs/database.type';
import { ReactComponent as BackIcon } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { FieldDisplay } from '@/components/database/components/field';
import { normalizeDashboardText } from '@/utils/normalize-text';

import { ChartSettingsRow } from './ChartSettingsRow';
import { ChartSettingsSubPage } from './ChartSettingsSubPage';
import { CHART_DATE_CONDITIONS } from './dateConditions';

/** A property the Group by page can offer (an X-axis type, in view order, without the X property). */
export interface ChartGroupByChoice {
  id: string;
  name: string;
  type: number;
}

const ITEM_CLASS =
  'flex h-7 w-full min-w-0 shrink-0 items-center gap-2 rounded-[6px] px-2 text-left text-sm leading-5 text-text-primary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill';

export interface ChartGroupByRowProps {
  label: string;
  icon?: ReactNode;
  /** The effective Group by property's name, or `null` for none. */
  fieldName: string | null;
  onOpen: () => void;
}

/**
 * The Group by row of the Y axis section (WP12 §2.11): "Group by" with the
 * property's name or "None"; it opens the Group by page.
 */
export function ChartGroupByRow({ label, icon, fieldName, onOpen }: ChartGroupByRowProps) {
  const { t } = useTranslation();

  return (
    <ChartSettingsRow
      icon={icon}
      label={label}
      onClick={onOpen}
      rowId='y_group_by'
      testId='chart-settings-group-by'
      value={fieldName ?? t('chart.settings.groupByNone', { defaultValue: 'None' })}
    />
  );
}

export interface ChartGroupByPageProps {
  title: string;
  /** The properties to offer, in view order (`groupByCandidates`). */
  fields: readonly ChartGroupByChoice[];
  /** The effective Group by property, or `null`. */
  selectedId: string | null;
  /** The stored `group_by_date_condition`. */
  dateCondition: DateGroupCondition;
  /** A property, or `''` for None. */
  onSelect: (fieldId: string) => void;
  /** A date grouping of a date property. */
  onSelectDate: (fieldId: string, condition: DateGroupCondition) => void;
  onBack: () => void;
}

/**
 * The Group by page (WP12 §2.11), pushed onto the panel like the other
 * property pages: a search box (matched with `normalizeDashboardText`),
 * "None", then every property a chart can group by except the X property,
 * each with its type icon and a check on the selected one, and "No results"
 * when nothing matches. A date property picks itself with its stored
 * grouping, and its chevron opens Relative / Day / Week / Month / Year.
 */
export function ChartGroupByPage({
  title,
  fields,
  selectedId,
  dateCondition,
  onSelect,
  onSelectDate,
  onBack,
}: ChartGroupByPageProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [dateFieldId, setDateFieldId] = useState<string | null>(null);
  const noneLabel = t('chart.settings.groupByNone', { defaultValue: 'None' });
  const searchLabel = t('chart.settings.searchProperty', { defaultValue: 'Search for a property…' });
  const needle = normalizeDashboardText(query);
  const matches = useMemo(
    () => fields.filter((field) => !needle || normalizeDashboardText(field.name).includes(needle)),
    [fields, needle]
  );
  const showNone = !needle || normalizeDashboardText(noneLabel).includes(needle);
  const dateField = dateFieldId ? fields.find((field) => field.id === dateFieldId) : undefined;

  if (dateField) {
    return (
      <ChartSettingsSubPage title={title} onBack={onBack}>
        <div role='menu' aria-label={dateField.name} className='flex flex-col'>
          <button
            type='button'
            data-testid='chart-group-by-date-back'
            className={ITEM_CLASS}
            onClick={() => setDateFieldId(null)}
          >
            <BackIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-secondary' />
            <span className='min-w-0 flex-1 truncate font-medium'>{dateField.name}</span>
          </button>
          {CHART_DATE_CONDITIONS.map((option) => {
            const checked = selectedId === dateField.id && dateCondition === option.value;

            return (
              <button
                key={option.value}
                type='button'
                role='menuitemradio'
                aria-checked={checked}
                data-testid={`chart-group-by-date-${option.value}`}
                className={ITEM_CLASS}
                onClick={() => onSelectDate(dateField.id, option.value)}
              >
                <span className='min-w-0 flex-1 truncate'>{t(option.labelKey, { defaultValue: option.fallback })}</span>
                {checked ? <CheckIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-primary' /> : null}
              </button>
            );
          })}
        </div>
      </ChartSettingsSubPage>
    );
  }

  return (
    <ChartSettingsSubPage title={title} onBack={onBack} autoFocusBack={false}>
      <div className='px-0 pb-1'>
        <input
          // The search box takes focus when the page opens.
          autoFocus
          data-testid='chart-group-by-search'
          value={query}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className='h-7 w-full rounded-[6px] border border-border-primary bg-transparent px-2 text-sm leading-5 text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-theme-thick'
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div role='menu' aria-label={title} className='flex flex-col'>
        {showNone ? (
          <button
            type='button'
            role='menuitemradio'
            aria-checked={selectedId === null}
            data-testid='chart-group-by-option-none'
            data-field-name={noneLabel}
            className={ITEM_CLASS}
            onClick={() => onSelect('')}
          >
            <span className='min-w-0 flex-1 truncate'>{noneLabel}</span>
            {selectedId === null ? (
              <CheckIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-primary' />
            ) : null}
          </button>
        ) : null}
        {matches.map((field) => {
          const isDate = isChartDateFieldType(field.type);

          return (
            <div key={field.id} className='flex min-w-0 items-center'>
              <button
                type='button'
                role='menuitemradio'
                aria-checked={selectedId === field.id}
                data-testid={`chart-group-by-option-${field.id}`}
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
              {isDate ? (
                <button
                  type='button'
                  aria-label={t('chart.settings.dateGrouping', { defaultValue: 'Date grouping' })}
                  data-testid={`chart-group-by-date-open-${field.id}`}
                  className='flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-icon-tertiary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill'
                  onClick={() => setDateFieldId(field.id)}
                >
                  <ChevronRightIcon aria-hidden='true' className='h-4 w-4' />
                </button>
              ) : null}
            </div>
          );
        })}
        {!showNone && matches.length === 0 ? (
          <div
            data-testid='chart-group-by-no-results'
            className='flex h-7 items-center justify-center text-sm text-text-tertiary'
          >
            {t('chart.settings.noResults', { defaultValue: 'No results' })}
          </div>
        ) : null}
      </div>
    </ChartSettingsSubPage>
  );
}

export default ChartGroupByRow;
