import { Dialog } from '@mui/material';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_MOTION } from '@/application/database-yjs/dashboard-geometry';
import type { ChartDrillTarget } from '@/application/database-yjs/drill-query';
import { MobileSheet } from '@/components/_shared/mobile-drawer/MobileSheet';

import { ChartDrillContent, useDrillMobileContext } from './ChartDrillContent';
import { DRILL } from './drillStyles';

export interface ChartDrillDialogProps {
  target: ChartDrillTarget;
  title: string;
  onClose(): void;
}

/** The record side peek (WP13 §3.9) stacks above the drill-down and owns Esc while open. */
const SIDE_PEEK_SELECTOR = '[data-testid="row-side-peek"]';

/**
 * Esc closes the innermost layer (WP13 §3.12): chip editors, menus and the
 * save prompt (portaled, so focus sits outside the dialog), the search input
 * (it handles its own Esc), the side peek, then the dialog. MUI's own Esc is
 * off so a popover's Esc never closes the dialog under it.
 */
function useDialogEscape(paperRef: React.RefObject<HTMLElement>, onClose: () => void) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const active = document.activeElement;
      const focusElsewhere = active && active !== document.body && !paperRef.current?.contains(active);

      if (focusElsewhere || document.querySelector(SIDE_PEEK_SELECTOR)) return;
      onCloseRef.current();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [paperRef]);
}

function DesktopDrillDialog({ target, title, onClose }: ChartDrillDialogProps) {
  const { t } = useTranslation();
  const paperRef = useRef<HTMLDivElement>(null);

  useDialogEscape(paperRef, onClose);

  return (
    <Dialog
      // Chip editors and menus are Radix layers portaled outside the dialog.
      disableEnforceFocus
      disableEscapeKeyDown
      // The previously focused element can be the editor host, which scrolls the page when focused.
      disableRestoreFocus
      keepMounted={false}
      maxWidth={false}
      onClose={(_event, reason) => {
        if (reason === 'backdropClick') onClose();
      }}
      open
      PaperProps={
        {
          ref: paperRef,
          elevation: 0,
          role: 'dialog',
          'aria-modal': true,
          'aria-label': t('chart.drilldown.ariaLabel', { defaultValue: 'Table data preview' }),
          className: '!border-0 !bg-surface-primary !shadow-dash-drilldown flex flex-col overflow-hidden',
          'data-testid': 'chart-drilldown',
          'data-parity-id': 'dash-drilldown',
          // min(800, vw − 32) × min(496, vh − 32).
          style: {
            width: DRILL.width,
            height: DRILL.height,
            maxWidth: `calc(100vw - ${DRILL.viewportMargin * 2}px)`,
            maxHeight: `calc(100vh - ${DRILL.viewportMargin * 2}px)`,
            margin: 0,
            borderRadius: DRILL.radius,
          },
        } as React.ComponentProps<typeof Dialog>['PaperProps']
      }
      transitionDuration={DASHBOARD_MOTION.fastMs}
    >
      <ChartDrillContent onClose={onClose} target={target} title={title} variant='dialog' />
    </Dialog>
  );
}

/**
 * The chart drill-down (WP13): a live table of the clicked mark's rows. A
 * dialog on desktop and wide web; in a mobile context the same content fills
 * a full-height bottom sheet (`data-sheet="drilldown"`, WP14). Rendered inside
 * `ChartProvider`, within the widget's (or chart page's) database context; it
 * reads the chart settings itself.
 */
export function ChartDrillDialog({ target, title, onClose }: ChartDrillDialogProps) {
  const { t } = useTranslation();
  const mobile = useDrillMobileContext();

  if (mobile) {
    return (
      <MobileSheet
        ariaLabel={t('chart.drilldown.ariaLabel', { defaultValue: 'Table data preview' })}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        open
        sheet='drilldown'
        size='full'
        title={title}
      >
        <ChartDrillContent onClose={onClose} target={target} title={title} variant='sheet' />
      </MobileSheet>
    );
  }

  return <DesktopDrillDialog onClose={onClose} target={target} title={title} />;
}

export default ChartDrillDialog;
