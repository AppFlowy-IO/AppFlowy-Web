import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseFields, useNavigateToRow } from '@/application/database-yjs';
import { DEFAULT_CHART_LAYOUT_SETTINGS } from '@/application/database-yjs/chart-layout-setting';
import { ChartClickItem } from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  createDetachedFilter,
  DetachedFilter,
  DetachedFilterStore,
  DetachedFilterStoreContext,
  isDetachedFilterCurrent,
  updateDetachedFilters,
} from '@/application/database-yjs/dispatch/detached-filters';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks';
import { RowId, YjsDatabaseKey } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { chartCategoryFilter, isChartRowFilterFieldType } from '@/components/database/chart/hooks/chartCategoryFilter';
import { useChartRowQuery } from '@/components/database/chart/hooks/useChartRowQuery';
import { useChartContext } from '@/components/database/chart/useChartContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

import { ChartRowFilterBar } from './ChartRowFilterBar';
import { ChartRowGrid } from './ChartRowGrid';

interface ChartRowListPopupProps {
  open: boolean;
  onClose: () => void;
  item: ChartClickItem;
}

/**
 * Drill-down popup of a chart category, desktop's `ChartRowListPopup`: the
 * category as an editable filter chip over every row of the database, more
 * rules from "Add filter", and the matches as a grid with a column per
 * visible field. The rules belong to the popup and never reach the view.
 *
 * When the category cannot be written as a rule, the popup lists the bucket's
 * own rows and filters within them. Desktop falls back to the whole database
 * there, listing rows the category does not hold.
 */
export function ChartRowListPopup({ open, onClose, item }: ChartRowListPopupProps) {
  const { t } = useTranslation();
  const { xAxisField, settings } = useChartContext();
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();
  const navigateToRow = useNavigateToRow();

  // Built once per opening, like desktop's popup state.
  const [initial] = useState(() => {
    const category = chartCategoryFilter({
      item,
      field: xAxisField,
      dateCondition: settings?.dateCondition ?? DEFAULT_CHART_LAYOUT_SETTINGS.dateCondition,
    });

    return { rules: category ? [category] : [], baseRowIds: category ? null : item.rowIds };
  });
  const [rules, setRules] = useState<DetachedFilter[]>(initial.rules);
  // Desktop drops a rule once its field is deleted or changes type.
  const currentRules = useMemo(() => {
    void fieldsVersion;
    return rules.filter((rule) => isDetachedFilterCurrent(rule, fields));
  }, [rules, fields, fieldsVersion]);

  const store = useMemo<DetachedFilterStore>(
    () => ({
      addFilter: (fieldId) => {
        const field = fields.get(fieldId);

        if (!field || !isChartRowFilterFieldType(Number(field.get(YjsDatabaseKey.type)) as FieldType)) return;
        const rule = createDetachedFilter(fieldId, fields);

        if (!rule) return;
        setRules((previous) => [...previous, rule]);
        return String(rule[YjsDatabaseKey.id]);
      },
      updateFilter: (params) => setRules((previous) => updateDetachedFilters(previous, fields, params)),
      removeFilter: (filterId) =>
        setRules((previous) => previous.filter((rule) => rule[YjsDatabaseKey.id] !== filterId)),
    }),
    [fields]
  );

  const query = useChartRowQuery({ rules: currentRules, baseRowIds: initial.baseRowIds, initialRowIds: item.rowIds });

  const handleOpenRow = useCallback(
    (rowId: RowId) => {
      onClose();
      void navigateToRow?.(rowId);
    },
    [navigateToRow, onClose]
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-testid='chart-row-popup'
        aria-describedby={undefined}
        showCloseButton={false}
        // Restoring focus to the slate editor host scrolls the document to it.
        onCloseAutoFocus={(event) => event.preventDefault()}
        className='flex max-h-[min(600px,85vh)] min-h-[min(400px,85vh)] w-[700px] max-w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-[calc(100%-2rem)]'
      >
        <div className='flex items-center gap-2 pl-4 pr-5 pt-4 sm:pl-[70px]'>
          <DialogTitle
            data-testid='chart-row-popup-title'
            className='min-w-0 flex-1 truncate text-base font-semibold leading-[22px] text-text-primary'
          >
            {item.label}
          </DialogTitle>
          <Button
            variant='ghost'
            size='icon-lg'
            className='p-1.5'
            aria-label={t('button.close')}
            data-testid='chart-row-popup-close'
            onClick={onClose}
          >
            <CloseIcon className='h-5 w-5' />
          </Button>
        </div>
        <DetachedFilterStoreContext.Provider value={store}>
          <div className='mt-2 px-4 sm:px-[70px]'>
            <ChartRowFilterBar rules={currentRules} loading={query.loading} error={query.error} onRetry={query.retry} />
          </div>
        </DetachedFilterStoreContext.Provider>
        <ChartRowGrid className='mx-4 flex-1 sm:mx-[70px]' rowIds={query.rowIds} onOpenRow={handleOpenRow} />
      </DialogContent>
    </Dialog>
  );
}

export default ChartRowListPopup;
