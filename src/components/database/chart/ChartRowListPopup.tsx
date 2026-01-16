import { Dialog, DialogContent, DialogTitle } from '@mui/material';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseFields, usePrimaryFieldId, useRowDocMap } from '@/application/database-yjs';
import { ChartDataItem } from '@/application/database-yjs/chart.type';
import { getCellData } from '@/application/database-yjs/const';
import { YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { AFScroller } from '@/components/_shared/scroller';
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
 * Drill-down popup showing rows in a chart category
 */
export function ChartRowListPopup({ open, onClose, item }: ChartRowListPopupProps) {
  const { t } = useTranslation();
  const fields = useDatabaseFields();
  const rowMetas = useRowDocMap();
  const primaryFieldId = usePrimaryFieldId();

  // State for row detail modal
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  // Get row data with primary field value
  const rows = useMemo<RowItem[]>(() => {
    if (!rowMetas || !primaryFieldId) {
      return item.rowIds.map(id => ({ id, primaryValue: id }));
    }

    return item.rowIds.map(rowId => {
      const data = getCellData(rowId, primaryFieldId, rowMetas);
      const primaryValue = typeof data === 'string' ? data : String(data || rowId);
      return { id: rowId, primaryValue };
    });
  }, [item.rowIds, rowMetas, primaryFieldId]);

  const handleRowClick = (rowId: string) => {
    setSelectedRowId(rowId);
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth={true}
        keepMounted={false}
        maxWidth="sm"
        PaperProps={{
          className: 'max-w-[500px] w-full max-h-[60vh] overflow-hidden flex flex-col',
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
        <DialogContent className="flex-1 overflow-hidden p-0">
          <AFScroller overflowXHidden className="h-full max-h-[calc(60vh-60px)]">
            <div className="flex flex-col">
              {rows.map((row) => (
                <div
                  key={row.id}
                  onClick={() => handleRowClick(row.id)}
                  className="flex cursor-pointer items-center gap-3 border-b border-border-primary px-4 py-3 transition-colors hover:bg-fill-content-hover"
                >
                  <span className="flex-1 truncate text-sm text-text-primary">
                    {row.primaryValue || t('grid.title.placeholder')}
                  </span>
                </div>
              ))}
              {rows.length === 0 && (
                <div className="flex items-center justify-center py-8 text-sm text-text-secondary">
                  {t('chart.drilldown.noRows', 'No rows in this category')}
                </div>
              )}
            </div>
          </AFScroller>
        </DialogContent>
      </Dialog>

      {/* Row detail modal */}
      {selectedRowId && (
        <DatabaseRowModal
          open={!!selectedRowId}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedRowId(null);
            }
          }}
          rowId={selectedRowId}
        />
      )}
    </>
  );
}

export default ChartRowListPopup;
