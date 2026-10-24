import { Drawer } from '@mui/material';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCellSelector, useDatabaseContextOptional, usePrimaryFieldId } from '@/application/database-yjs';
import { DASHBOARD_GEOMETRY, DASHBOARD_MOTION } from '@/application/database-yjs/dashboard-geometry';
import { AFScroller } from '@/components/_shared/scroller';
import { useDatabaseRestoreNotice } from '@/components/app/DatabaseRestoreNotice';
import { DatabaseRow } from '@/components/database/DatabaseRow';
import { cn } from '@/lib/utils';

import { SidePeekHeader } from './RowPeekHeader';
import { useSidePeekWidth } from './useSidePeekWidth';

const SIDE_PEEK = DASHBOARD_GEOMETRY.sidePeek;

function useRowTitle(rowId: string) {
  const primaryFieldId = usePrimaryFieldId();
  const cell = useCellSelector({ rowId, fieldId: primaryFieldId ?? '' });
  const data = cell?.data;

  return typeof data === 'string' ? data : '';
}

/** The record itself: it does not re-render with the panel's width, title or drag state. */
const SidePeekBody = memo(function SidePeekBody({ rowId }: { rowId: string }) {
  return (
    <AFScroller overflowXHidden className={'appflowy-scroll-container min-h-0 w-full flex-1'}>
      <DatabaseRow rowId={rowId} />
    </AFScroller>
  );
});

export interface DatabaseRowSidePeekProps {
  open: boolean;
  rowId: string;
  onOpenChange: (open: boolean) => void;
  /** Open the record as a full page (Expand). */
  openPage?: (rowId: string) => void;
  /** Close the peek and open the centre peek for the same record. */
  onSwitchToCenter?: () => void;
  /** A mobile context: full width, no resizer. */
  fullWidth?: boolean;
}

/**
 * The record side peek (WP13 §3.9): a right panel from under the app header
 * to the bottom, over a transparent barrier (a pointer-down outside closes
 * it, and the click is consumed), Esc and Close close it too. Expand opens
 * the full page, "Open in center peek" switches to the centre modal. The
 * width is resizable from the left edge and remembered per device. It stacks
 * above the drill-down dialog (mounted after it, so above it; Radix layers it
 * opens stay above it).
 */
export function DatabaseRowSidePeek({
  open,
  rowId,
  onOpenChange,
  openPage,
  onSwitchToCenter,
  fullWidth = false,
}: DatabaseRowSidePeekProps) {
  const { t } = useTranslation();
  const context = useDatabaseContextOptional();
  const title = useRowTitle(rowId);
  const { width, dragging, bounds, panelRef, resizerProps } = useSidePeekWidth();
  const close = () => onOpenChange(false);

  useDatabaseRestoreNotice(context?.workspaceId || '', open ? context?.databaseDoc?.guid : undefined);

  return (
    <Drawer
      anchor='right'
      ModalProps={{
        disableScrollLock: true,
        disableRestoreFocus: true,
        keepMounted: false,
        BackdropProps: { invisible: true },
      }}
      onClose={close}
      open={open}
      PaperProps={
        {
          ref: panelRef,
          role: 'dialog',
          'aria-modal': false,
          'aria-label': title || t('grid.row.titlePlaceholder', { defaultValue: 'Untitled' }),
          'data-testid': 'row-side-peek',
          'data-parity-id': 'dash-side-peek',
          className: '!bg-surface-primary !shadow-dash-side-peek flex flex-col border-l border-border-primary',
          style: fullWidth
            ? { width: '100vw', top: 0, height: '100%' }
            : { width, top: SIDE_PEEK.webTop, height: `calc(100% - ${SIDE_PEEK.webTop}px)` },
        } as React.ComponentProps<typeof Drawer>['PaperProps']
      }
      transitionDuration={DASHBOARD_MOTION.reflowMs}
      variant='temporary'
    >
      {fullWidth ? null : (
        <div
          aria-label={t('grid.rowPage.resizeSidePeek', { defaultValue: 'Resize side peek' })}
          aria-orientation='vertical'
          aria-valuemax={bounds.max}
          aria-valuemin={bounds.min}
          aria-valuenow={width}
          className='group/resizer absolute bottom-0 left-0 top-0 z-[1] cursor-col-resize focus-visible:outline-none'
          data-dragging={dragging || undefined}
          data-testid='row-side-peek-resizer'
          role='separator'
          style={{ width: SIDE_PEEK.resizeHit }}
          tabIndex={0}
          {...resizerProps}
        >
          <span
            className={cn(
              'pointer-events-none absolute bottom-0 left-0 top-0 w-0.5 bg-dash-accent opacity-0',
              'group-hover/resizer:opacity-100 group-focus-visible/resizer:opacity-100',
              dragging && 'opacity-100'
            )}
          />
        </div>
      )}
      <div
        className='flex shrink-0 items-center gap-1 px-3'
        data-testid='row-side-peek-header'
        style={{ height: SIDE_PEEK.headerHeight }}
      >
        <SidePeekHeader onClose={close} onSwitchToCenter={onSwitchToCenter} openPage={openPage} rowId={rowId} />
      </div>
      <SidePeekBody rowId={rowId} />
    </Drawer>
  );
}

export default DatabaseRowSidePeek;
