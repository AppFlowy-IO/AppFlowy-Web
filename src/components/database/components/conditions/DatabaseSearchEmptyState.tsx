import { useTranslation } from 'react-i18next';

import { useDatabaseContext } from '@/application/database-yjs';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import { cn } from '@/lib/utils';

/**
 * "No results" in place of a view's body when its search matches no row
 * (WP09 §1.2). The toolbar or widget header stays. "Clear search" clears the
 * query, collapses the search field and gives the Search button the focus.
 * Centred in a dashboard widget's card; a 160px block 48px from the top elsewhere.
 */
export function DatabaseSearchEmptyState() {
  const { t } = useTranslation();
  const { clearSearch } = useDatabaseSearch();
  const { isDashboardWidget } = useDatabaseContext();

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center gap-2',
        isDashboardWidget ? 'h-full min-h-0 flex-1 justify-center' : 'min-h-[160px] pt-12'
      )}
      data-testid='database-search-empty-state'
      role='status'
    >
      {/* The parity id marks the label (as on desktop), so its text check reads only "No results". */}
      <span className='text-sm font-normal leading-5 text-text-secondary' data-parity-id='dash-widget-search-empty'>
        {t('databaseSearch.noResults')}
      </span>
      <button
        className='inline-flex h-7 items-center rounded-200 border border-border-primary bg-transparent px-2 text-sm leading-5 text-text-primary hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-theme-thick'
        data-parity-id='dash-widget-search-clear'
        data-testid='database-search-clear-search'
        onClick={() => clearSearch({ focusSearch: true })}
        type='button'
      >
        {t('databaseSearch.clearSearch')}
      </button>
    </div>
  );
}

export default DatabaseSearchEmptyState;
