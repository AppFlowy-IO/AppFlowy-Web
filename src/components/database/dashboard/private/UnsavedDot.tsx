import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { DASHBOARD_MOTION_FAST_CLASS } from '../constants';

export type UnsavedDotPlacement = 'pill' | 'toolbar' | 'tool';

/**
 * Where the 6px dot sits on its host (WP07 §3.5): the pill's top-right
 * corner, the top-right of a toolbar button's 16px glyph (28×28 button) or of
 * a widget tool's glyph (24×24 button).
 */
const PLACEMENT_CLASS: Record<UnsavedDotPlacement, string> = {
  pill: '-right-0.5 -top-0.5',
  toolbar: 'right-[5px] top-[5px]',
  tool: 'right-[3px] top-[3px]',
};

export interface UnsavedDotProps {
  placement: UnsavedDotPlacement;
  testId: string;
  parityId?: string;
  className?: string;
}

/**
 * The orange "unsaved changes" dot: something here differs from the saved
 * dashboard. The host must be `relative`. Screen readers hear "Unsaved
 * changes" as part of the host control's content.
 */
export function UnsavedDot({ placement, testId, parityId, className }: UnsavedDotProps) {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        'pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-dash-unsaved-dot',
        'animate-in fade-in-0 motion-reduce:animate-none',
        DASHBOARD_MOTION_FAST_CLASS,
        PLACEMENT_CLASS[placement],
        className
      )}
      data-parity-id={parityId}
      data-slot='unsaved-dot'
      data-testid={testId}
    >
      <span className='sr-only'>{t('dashboard.private.unsaved', { defaultValue: 'Unsaved changes' })}</span>
    </span>
  );
}

export default UnsavedDot;
