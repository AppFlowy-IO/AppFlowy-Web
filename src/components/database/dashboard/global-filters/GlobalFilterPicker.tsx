import { KeyboardEvent, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { useDashboardContext, useDashboardLayout } from '@/components/database/dashboard/DashboardContext';
import { cn } from '@/lib/utils';

import { buildGlobalFilterPickerModel, GlobalFilterPickerMode } from './global-filter.picker';
import { GlobalFilterSourceField } from './global-filter.utils';
import { useFilterMenuSourceDocs } from './useFilterMenuSourceDocs';
import { useDashboardFilterSources } from './useGlobalFilterActions';

/** A 28px row of the global filter menus (radius 6, padding 0 8, gap 8, 14/20). */
export const GLOBAL_FILTER_ROW_CLASS =
  'flex h-7 w-full min-w-0 items-center gap-2 rounded-200 px-2 text-left text-sm text-text-primary outline-none hover:bg-dash-hover-fill data-[active=true]:bg-dash-hover-fill';

export interface GlobalFilterPickerProps {
  mode: GlobalFilterPickerMode;
  /** Add another: only properties of this type. */
  fieldType?: FieldType;
  /** Add another: the sources the filter maps already. */
  excludeDatabaseIds?: readonly string[];
  onPick: (databaseId: string, field: GlobalFilterSourceField) => void;
  /** The footer ("Filter multiple sources"), shown for writers with 2+ sources in the toolbar mode. */
  onMultipleSources?: () => void;
}

type PickerItem =
  | { kind: 'field'; databaseId: string; field: GlobalFilterSourceField }
  | { kind: 'more'; databaseId: string; count: number };

/**
 * "Filter by…": a search box and the dashboard's properties, flat for one
 * source or grouped by source in widget order with a "N more" row (WP08
 * §1.2). Arrow keys move the highlight over properties and more rows, Enter
 * picks, Escape is the popover's.
 */
export function GlobalFilterPicker({
  mode,
  fieldType,
  excludeDatabaseIds,
  onPick,
  onMultipleSources,
}: GlobalFilterPickerProps) {
  const { t } = useTranslation();
  const { canEdit } = useDashboardContext();
  const { rows } = useDashboardLayout();

  // The sources whose widgets have not started yet are listed too (fix B6).
  useFilterMenuSourceDocs();
  const sources = useDashboardFilterSources();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const model = useMemo(
    () =>
      buildGlobalFilterPickerModel({
        sources,
        rows,
        query,
        expanded,
        mode,
        fieldType,
        excludeDatabaseIds,
        canEdit,
      }),
    [canEdit, excludeDatabaseIds, expanded, fieldType, mode, query, rows, sources]
  );
  const items = useMemo<PickerItem[]>(
    () =>
      model.groups.flatMap((group) => [
        ...group.fields.map((field) => ({ kind: 'field' as const, databaseId: group.databaseId, field })),
        ...(group.moreCount > 0
          ? [{ kind: 'more' as const, databaseId: group.databaseId, count: group.moreCount }]
          : []),
      ]),
    [model]
  );
  const active = Math.min(activeIndex, Math.max(0, items.length - 1));
  const untitled = t('untitled', { defaultValue: 'Untitled' });

  const activate = useCallback(
    (item: PickerItem | undefined) => {
      if (!item) return;
      if (item.kind === 'field') {
        onPick(item.databaseId, item.field);
        return;
      }

      setExpanded((current) => new Set([...current, item.databaseId]));
    },
    [onPick]
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;

      setActiveIndex((active + step + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(items[active]);
    }
  };

  let index = -1;

  return (
    <div className='flex flex-col' data-testid='dashboard-global-filter-picker' data-mode={mode}>
      <input
        aria-label={t('dashboard.globalFilters.filterBy', { defaultValue: 'Filter by…' })}
        autoFocus
        className='mx-1 mb-1.5 mt-1 h-7 rounded-200 border border-border-primary bg-transparent px-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-theme-thick'
        data-testid='dashboard-global-filter-search'
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder={t('dashboard.globalFilters.filterBy', { defaultValue: 'Filter by…' })}
        value={query}
      />
      <div className='appflowy-scroller flex max-h-[400px] flex-col gap-1 overflow-y-auto' role='listbox'>
        {model.empty ? (
          <div className='py-1 text-center text-sm text-text-tertiary' data-testid='dashboard-global-filter-no-results'>
            {t('dashboard.globalFilters.noResults', { defaultValue: 'No results' })}
          </div>
        ) : (
          model.groups.map((group) => (
            <div className='flex flex-col' key={group.databaseId}>
              {model.flat ? null : (
                <div
                  className='flex h-7 items-center gap-1.5 px-2 text-xs'
                  data-database-id={group.databaseId}
                  data-testid='dashboard-global-filter-source-group'
                  data-view-count={group.viewCount}
                >
                  <span className='min-w-0 truncate font-medium text-text-secondary'>{group.name}</span>
                  <span className='shrink-0 text-text-tertiary'>
                    {t('dashboard.globalFilters.viewCount', {
                      count: group.viewCount,
                      defaultValue: '{{count}} views',
                      defaultValue_one: '{{count}} view',
                      defaultValue_other: '{{count}} views',
                    })}
                  </span>
                </div>
              )}
              {group.fields.map((field) => {
                index += 1;
                const itemIndex = index;

                return (
                  <button
                    aria-selected={itemIndex === active}
                    className={GLOBAL_FILTER_ROW_CLASS}
                    data-active={itemIndex === active}
                    data-database-id={group.databaseId}
                    data-field-id={field.id}
                    data-testid='dashboard-global-filter-field-option'
                    key={field.id}
                    onClick={() => onPick(group.databaseId, field)}
                    onMouseEnter={() => setActiveIndex(itemIndex)}
                    role='option'
                    type='button'
                  >
                    <FieldTypeIcon className='h-4 w-4 shrink-0 text-icon-secondary' type={field.type} />
                    <span className='min-w-0 flex-1 truncate'>{field.name || untitled}</span>
                  </button>
                );
              })}
              {group.moreCount > 0 &&
                (() => {
                  index += 1;
                  const itemIndex = index;

                  return (
                    <button
                      className={cn(GLOBAL_FILTER_ROW_CLASS, 'text-text-secondary')}
                      data-active={itemIndex === active}
                      data-count={group.moreCount}
                      data-database-id={group.databaseId}
                      data-testid='dashboard-global-filter-more'
                      onClick={() => setExpanded((current) => new Set([...current, group.databaseId]))}
                      onMouseEnter={() => setActiveIndex(itemIndex)}
                      type='button'
                    >
                      <MoreIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-tertiary' />
                      <span>
                        {t('dashboard.globalFilters.more', {
                          count: group.moreCount,
                          defaultValue: '{{count}} more',
                        })}
                      </span>
                    </button>
                  );
                })()}
            </div>
          ))
        )}
      </div>
      {model.showFooter && onMultipleSources ? (
        <>
          <div className='my-1 h-px bg-border-primary' />
          <button
            className={GLOBAL_FILTER_ROW_CLASS}
            data-testid='dashboard-global-filter-multiple-sources'
            onClick={onMultipleSources}
            type='button'
          >
            <SettingsIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-secondary' />
            <span>{t('dashboard.globalFilters.title', { defaultValue: 'Filter multiple sources' })}</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

export default GlobalFilterPicker;
