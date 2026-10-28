import LinearProgress from '@mui/material/LinearProgress';
import { ContextType, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseFields, useReadOnly } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { DetachedFilter, parseDetachedFilter } from '@/application/database-yjs/dispatch/detached-filters';
import { useAddFilter } from '@/application/database-yjs/dispatch/sort-filter';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks';
import { ReactComponent as AddFilterSvg } from '@/assets/icons/plus.svg';
import { isChartRowFilterFieldType } from '@/components/database/chart/hooks/chartCategoryFilter';
import { DatabaseConditionsContext } from '@/components/database/components/conditions/context';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { FilterChip } from '@/components/database/components/filters/Filter';
import { Button } from '@/components/ui/button';

const noop = () => undefined;

const supportsChartRowFilter = ({ type }: { type: FieldType }) => isChartRowFilterFieldType(type);

/**
 * Desktop's `ChartRowQueryBar`: the drill-down's rules as the database's own
 * filter chips, an "Add filter" picker, a progress bar while rows load and a
 * retry when some could not. It must sit under a `DetachedFilterStoreContext`,
 * so the chips' editors write to the popup instead of the view.
 */
export function ChartRowFilterBar({
  rules,
  loading,
  error,
  onRetry,
}: {
  rules: readonly DetachedFilter[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();
  const readOnly = useReadOnly();
  const addFilter = useAddFilter();
  const [openFilterId, setOpenFilterId] = useState<string>();
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const filters = useMemo(() => {
    void fieldsVersion;
    return rules.flatMap((rule) => parseDetachedFilter(rule, fields) ?? []);
  }, [rules, fields, fieldsVersion]);

  // The chips and editors read which popover is open from the conditions
  // context; this keeps the popup's open chip apart from the view's bar.
  const conditions = useMemo<NonNullable<ContextType<typeof DatabaseConditionsContext>>>(
    () => ({
      expanded: true,
      toggleExpanded: noop,
      setExpanded: noop,
      openFilterId,
      setOpenFilterId,
      isAdvancedMode: false,
      setAdvancedMode: noop,
    }),
    [openFilterId]
  );

  // Desktop parity: a new rule opens its editor straight away.
  const handleAddFilter = useCallback((fieldId: string) => setOpenFilterId(addFilter(fieldId)), [addFilter]);

  return (
    <DatabaseConditionsContext.Provider value={conditions}>
      <div data-testid='chart-row-popup-filter-bar' className='flex flex-col gap-2 border-b border-border-primary py-2'>
        <div className='flex items-center gap-2 overflow-x-auto'>
          {filters.map((filter) => (
            <FilterChip key={filter.id} filter={filter} />
          ))}
          {!readOnly && (
            <PropertiesMenu
              asChild
              searchPlaceholder={t('grid.settings.filterBy')}
              propertyFilter={supportsChartRowFilter}
              onSelect={handleAddFilter}
              open={addMenuOpen}
              onOpenChange={setAddMenuOpen}
            >
              <Button
                variant='ghost'
                size='sm'
                className='h-7 shrink-0 whitespace-nowrap rounded-full font-medium text-text-secondary'
                data-testid='chart-row-popup-add-filter'
              >
                <AddFilterSvg className='h-5 w-5 text-icon-secondary' />
                {t('grid.settings.addFilter')}
              </Button>
            </PropertiesMenu>
          )}
        </div>
        {loading && <LinearProgress data-testid='chart-row-popup-loading' className='h-0.5' />}
        {error && (
          <Button
            variant='ghost'
            size='sm'
            className='self-start'
            onClick={onRetry}
            data-testid='chart-row-popup-retry'
          >
            {t('button.retry')}
          </Button>
        )}
      </div>
    </DatabaseConditionsContext.Provider>
  );
}

export default ChartRowFilterBar;
