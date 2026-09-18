import { Dialog, DialogContent, DialogTitle } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseContext, useFieldSelector, usePrimaryFieldId, useRowMap } from '@/application/database-yjs';
import { ChartDataItem, ChartType } from '@/application/database-yjs/chart.type';
import { getCell } from '@/application/database-yjs/const';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ensureRowsWithConcurrency } from '@/components/database/chart/hooks/useChartData';
import { useChartContext } from '@/components/database/chart/useChartContext';
import DatabaseRowModal from '@/components/database/DatabaseRowModal';
import { Button } from '@/components/ui/button';

interface ChartRowListPopupProps {
  open: boolean;
  onClose: () => void;
  item: ChartDataItem;
}

interface RowItem {
  id: string;
  primaryValue: string;
}

/**
 * Drill-down popup showing rows in a chart category. Mirrors desktop's
 * `ChartRowListPopup`: header (label + count), filter chip
 * "<x-axis field>: <category>", and a scrollable list of rows.
 *
 * Web shows the primary-field text per row using the current field schema.
 * Clicking a row opens the row detail modal.
 */
export function ChartRowListPopup({ open, onClose, item }: ChartRowListPopupProps) {
  const { t } = useTranslation();
  const rowMetas = useRowMap();
  const { ensureRow } = useDatabaseContext();
  const primaryFieldId = usePrimaryFieldId();
  const { field: primaryField, clock: primaryFieldClock } = useFieldSelector(primaryFieldId ?? '');
  const { xAxisField, chartType } = useChartContext();

  // The Number chart has no x-axis grouping, so there is no category chip.
  const xAxisName =
    xAxisField && chartType !== ChartType.Number ? String(xAxisField.get(YjsDatabaseKey.name) || '') : '';

  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  // A Number chart that only counts rows never hydrates them, so load the
  // listed rows that are not open yet (a no-op for grouped charts). The list
  // is rebuilt once when the pool finishes, not for every row that arrives:
  // each arrival replaces the row map, and decoding every listed row again
  // per arrival is quadratic in the category size.
  const [loadedRevision, setLoadedRevision] = useState(0);
  const rowMetasRef = useRef(rowMetas);

  rowMetasRef.current = rowMetas;

  useEffect(() => {
    if (!ensureRow) return;
    const missing = item.rowIds.filter((rowId) => !rowMetasRef.current?.[rowId]);

    if (missing.length === 0) return;
    let cancelled = false;

    void ensureRowsWithConcurrency(missing, ensureRow, { isCancelled: () => cancelled }).then(() => {
      if (!cancelled) setLoadedRevision((revision) => revision + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [ensureRow, item.rowIds]);

  const rows = useMemo<RowItem[]>(() => {
    void primaryFieldClock;
    void loadedRevision;
    const currentRowMetas = rowMetasRef.current;

    return item.rowIds.map((rowId) => {
      if (!currentRowMetas || !primaryFieldId || !primaryField) {
        return { id: rowId, primaryValue: '' };
      }

      const cell = getCell(rowId, primaryFieldId, currentRowMetas);

      if (!cell) return { id: rowId, primaryValue: '' };
      return { id: rowId, primaryValue: decodeCellToText(cell, primaryField) };
    });
  }, [item.rowIds, loadedRevision, primaryFieldId, primaryField, primaryFieldClock]);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        keepMounted={false}
        // Prevent restoring focus to the previously-focused element (the slate
        // editor host) on close — that element has `scroll-mt-[300px]`, which
        // causes the browser to scroll the document to put it in view.
        disableRestoreFocus
        maxWidth='sm'
        PaperProps={{
          sx: {
            maxWidth: 560,
            width: '100%',
            // A fixed-ish height keeps the body visible even when there are
            // few rows; without this the DialogContent inherits a 0-height
            // flex container and the row list collapses.
            maxHeight: '70vh',
            minHeight: 280,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle className='flex items-center justify-between border-b border-border-primary px-4 py-3'>
          <div className='flex items-center gap-3'>
            <div className='h-4 w-4 rounded-sm' style={{ backgroundColor: item.color }} />
            <span className='text-base font-medium text-text-primary'>{item.label}</span>
            <span className='text-sm text-text-secondary'>
              ({t('chart.drilldown.rowCount', { count: item.rowIds.length })})
            </span>
          </div>
          <Button size='icon-sm' variant='ghost' onClick={onClose}>
            <CloseIcon className='h-4 w-4' />
          </Button>
        </DialogTitle>

        {/* Filter chip — mirrors desktop's `ChartFilterChip` */}
        {xAxisName && !item.isEmptyCategory && (
          <div className='flex items-center gap-2 border-b border-border-primary px-4 py-2 text-xs text-text-secondary'>
            <span className='rounded bg-fill-list-hover px-2 py-1 text-text-primary'>{xAxisName}</span>
            <span>:</span>
            <span className='rounded px-2 py-1 text-text-primary' style={{ backgroundColor: item.color }}>
              {item.label}
            </span>
          </div>
        )}

        <DialogContent
          className='flex-1 overflow-y-auto p-0'
          sx={{ padding: 0, '&.MuiDialogContent-root': { padding: 0 } }}
        >
          <div className='flex flex-col'>
            {rows.length === 0 ? (
              <div className='flex items-center justify-center py-8 text-sm text-text-secondary'>
                {t('chart.drilldown.noRows', 'No rows in this category')}
              </div>
            ) : (
              rows.map((row) => (
                <button
                  type='button'
                  key={row.id}
                  onClick={() => setSelectedRowId(row.id)}
                  className='flex w-full cursor-pointer items-center gap-3 border-b border-border-primary px-4 py-3 text-left transition-colors hover:bg-fill-content-hover'
                >
                  <span className='flex-1 truncate text-sm text-text-primary'>
                    {row.primaryValue || t('grid.title.placeholder')}
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Row detail modal */}
      {selectedRowId && (
        <DatabaseRowModal
          open={!!selectedRowId}
          onOpenChange={(opened) => {
            if (!opened) setSelectedRowId(null);
          }}
          rowId={selectedRowId}
        />
      )}
    </>
  );
}

export default ChartRowListPopup;
