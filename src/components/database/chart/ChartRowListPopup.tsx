import { Dialog, DialogContent, DialogTitle } from '@mui/material';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useFieldSelector,
  usePrimaryFieldId,
  useRowMap,
} from '@/application/database-yjs';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { ChartDataItem } from '@/application/database-yjs/chart.type';
import { getCell } from '@/application/database-yjs/const';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
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
 * Web shows the primary-field text per row (using `parseYDatabaseCellToCell`
 * so RichText deltas are decoded). Clicking a row opens the row detail modal.
 */
export function ChartRowListPopup({ open, onClose, item }: ChartRowListPopupProps) {
  const { t } = useTranslation();
  const rowMetas = useRowMap();
  const primaryFieldId = usePrimaryFieldId();
  const { field: primaryField } = useFieldSelector(primaryFieldId ?? '');
  const { xAxisField } = useChartContext();

  const xAxisName = xAxisField ? String(xAxisField.get(YjsDatabaseKey.name) || '') : '';

  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const rows = useMemo<RowItem[]>(() => {
    return item.rowIds.map((rowId) => {
      if (!rowMetas || !primaryFieldId || !primaryField) {
        return { id: rowId, primaryValue: '' };
      }

      const cell = getCell(rowId, primaryFieldId, rowMetas);

      if (!cell) return { id: rowId, primaryValue: '' };
      const parsed = parseYDatabaseCellToCell(cell, primaryField);
      const text = typeof parsed?.data === 'string' ? parsed.data : '';

      return { id: rowId, primaryValue: text };
    });
  }, [item.rowIds, rowMetas, primaryFieldId, primaryField]);

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
        maxWidth="sm"
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
        <DialogTitle className="flex items-center justify-between border-b border-border-primary px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className="h-4 w-4 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-base font-medium text-text-primary">
              {item.label}
            </span>
            <span className="text-sm text-text-secondary">
              ({t('chart.drilldown.rowCount', { count: item.rowIds.length })})
            </span>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
          >
            <CloseIcon className="h-4 w-4" />
          </Button>
        </DialogTitle>

        {/* Filter chip — mirrors desktop's `ChartFilterChip` */}
        {xAxisName && !item.isEmptyCategory && (
          <div className="flex items-center gap-2 border-b border-border-primary px-4 py-2 text-xs text-text-secondary">
            <span className="rounded bg-fill-list-hover px-2 py-1 text-text-primary">
              {xAxisName}
            </span>
            <span>:</span>
            <span
              className="rounded px-2 py-1 text-text-primary"
              style={{ backgroundColor: item.color }}
            >
              {item.label}
            </span>
          </div>
        )}

        <DialogContent
          className="flex-1 overflow-y-auto p-0"
          sx={{ padding: 0, '&.MuiDialogContent-root': { padding: 0 } }}
        >
          <div className="flex flex-col">
            {rows.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-text-secondary">
                {t('chart.drilldown.noRows', 'No rows in this category')}
              </div>
            ) : (
              rows.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => setSelectedRowId(row.id)}
                  className="flex w-full cursor-pointer items-center gap-3 border-b border-border-primary px-4 py-3 text-left transition-colors hover:bg-fill-content-hover"
                >
                  <span className="flex-1 truncate text-sm text-text-primary">
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
