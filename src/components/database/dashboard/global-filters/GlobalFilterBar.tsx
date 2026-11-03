import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import {
  useDashboardContextOptional,
  useDashboardPrivateSummary,
} from '@/components/database/dashboard/DashboardContext';
import { cn } from '@/lib/utils';

import { DashboardSaveControls } from '../private/DashboardSaveControls';

import { GlobalFilterChip } from './GlobalFilterChip';
import { GlobalFilterPopover, globalFilterTriggerProps } from './GlobalFilterPopover';
import { useDashboardFilterSources, useGlobalFilterActions } from './useGlobalFilterActions';

/** The pills; only mounted while there are filters, so an empty bar observes no source database. */
function GlobalFilterChipList({
  filters,
  dirtyIds,
  mobile,
}: {
  filters: DashboardGlobalFilter[];
  dirtyIds: ReadonlySet<string>;
  mobile: boolean;
}) {
  const sources = useDashboardFilterSources();

  return (
    <>
      {filters.map((filter) => (
        <GlobalFilterChip
          dirty={dirtyIds.has(filter.id)}
          filter={filter}
          key={filter.id}
          mobile={mobile}
          sources={sources}
        />
      ))}
    </>
  );
}

function GlobalFilterBarContent({ className, mobile }: { className?: string; mobile: boolean }) {
  const { t } = useTranslation();
  const { filters, dirtyIds, canEdit } = useGlobalFilterActions();
  // Anything unsaved on the dashboard (global values or widgets): the bar is the one place that reads it.
  const { hasChanges } = useDashboardPrivateSummary();
  const addLabel = t('dashboard.globalFilters.button', { defaultValue: 'Filter' });

  // Only with filters, or unsaved changes to reset or save; Edit mode alone adds no row.
  if (filters.length === 0 && !hasChanges) return null;

  return (
    <div
      className={cn('flex min-h-7 w-full flex-wrap items-center justify-start gap-2', className)}
      data-parity-id='dash-global-filter-bar'
      data-testid='dashboard-global-filter-bar'
    >
      {filters.length > 0 && <GlobalFilterChipList dirtyIds={dirtyIds} filters={filters} mobile={mobile} />}

      {canEdit && (
        <GlobalFilterPopover
          align='start'
          entry='bar-add'
          mobile={mobile}
          sheetTitle={addLabel}
          trigger={
            <button
              type='button'
              className='flex h-7 items-center gap-1 rounded-200 px-1.5 text-sm text-text-secondary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill data-[state=open]:bg-dash-hover-fill'
              data-parity-id='dash-global-filter-add'
              data-testid='dashboard-global-filter-bar-add'
              {...globalFilterTriggerProps}
            >
              <PlusIcon
                aria-hidden='true'
                className='h-4 w-4 text-dash-tool-icon'
                data-parity-id='dash-global-filter-add__icon'
              />
              <span data-parity-id='dash-global-filter-add__label'>{addLabel}</span>
            </button>
          }
        />
      )}

      <DashboardSaveControls className='ml-auto' />
    </div>
  );
}

/**
 * The dashboard's global filter bar: the pills, `+ Filter` for writers, and
 * at the right end Reset and "Save for everyone" while something is unsaved.
 * Left-aligned and wrapping; rendered only while there are filters or
 * unsaved changes. On a phone the pills and `+ Filter` open bottom sheets.
 * Renders nothing outside a `DashboardProvider`.
 */
export const GlobalFilterBar = memo(function GlobalFilterBar({ className }: { className?: string }) {
  const context = useDashboardContextOptional();

  if (!context) return null;
  return <GlobalFilterBarContent className={className} mobile={context.mobileContext} />;
});

export default GlobalFilterBar;
