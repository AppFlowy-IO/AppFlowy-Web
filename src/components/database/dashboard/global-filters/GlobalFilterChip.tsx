import { memo, useCallback, useEffect, useState } from 'react';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as ArrowDown } from '@/assets/icons/alt_arrow_down.svg';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { UnsavedDot } from '../private/UnsavedDot';

import { GlobalFilterSource } from './global-filter.utils';
import { GlobalFilterPopover, globalFilterTriggerProps, wrapInTooltipTrigger } from './GlobalFilterPopover';
import { clearGlobalFilterEditorRequest, usePendingGlobalFilterEditor } from './pendingEditorStore';
import { useGlobalFilterLabel } from './useGlobalFilterLabel';

/** The source count on the type icon: 2..9, then 9+. */
export function formatSourceCount(count: number) {
  return count > 9 ? '9+' : String(count);
}

/**
 * One dashboard filter in the bar (WP08 §1.5): a borderless 28px pill, light
 * blue with blue text while it narrows rows and grey without a value. The
 * type icon carries the number of sources from 2 on, the top-right corner
 * the orange dot of an unsaved value (WP07). It opens the filter's editor,
 * also on its own after a pick in the menu (the pending-editor request); on a
 * phone in a bottom sheet titled with the pill's label.
 */
export const GlobalFilterChip = memo(function GlobalFilterChip({
  filter,
  sources,
  dirty = false,
  mobile = false,
}: {
  filter: DashboardGlobalFilter;
  sources: GlobalFilterSource[];
  /** The value is private (WP07): the pill shows the unsaved dot. */
  dirty?: boolean;
  /** A mobile context (WP14 §1.4.2): the editor opens in a bottom sheet. */
  mobile?: boolean;
}) {
  const { text, active, sourceCount, sourceLines } = useGlobalFilterLabel(filter, sources);
  const [open, setOpen] = useState(false);
  const pending = usePendingGlobalFilterEditor();
  const handleOpenChange = useCallback((next: boolean) => setOpen(next), []);

  // A pick in the menu opens this pill's editor on the next frame, once the
  // menu's popover has closed (focus return would fight a same-frame open).
  // The request is consumed inside the frame: clearing it first would change
  // `pending` and cancel the frame before it runs.
  useEffect(() => {
    if (pending !== filter.id) return;
    const frame = requestAnimationFrame(() => {
      clearGlobalFilterEditorRequest(filter.id);
      setOpen(true);
    });

    return () => cancelAnimationFrame(frame);
  }, [filter.id, pending]);

  const pill = (
    <button
      type='button'
      data-active={active}
      data-filter-id={filter.id}
      data-parity-id='dash-global-filter-pill'
      data-source-count={sourceCount}
      data-testid='dashboard-global-filter-chip'
      data-unsaved={dirty}
      {...globalFilterTriggerProps}
      className={cn(
        'relative flex h-7 max-w-[320px] items-center gap-1 rounded-[14px] px-2 text-sm font-normal outline-none',
        'hover:brightness-95 focus-visible:ring-2 focus-visible:ring-border-theme-thick',
        active ? 'bg-dash-pill-bg-active text-dash-pill-fg-active' : 'bg-dash-pill-bg text-dash-pill-fg'
      )}
    >
      <span className='relative flex shrink-0'>
        <FieldTypeIcon
          className='h-4 w-4 shrink-0'
          data-parity-id='dash-global-filter-pill__icon'
          type={filter.fieldType}
        />
        {sourceCount >= 2 && (
          <span
            className={cn(
              'absolute -bottom-[3px] -right-1 flex h-3 min-w-3 items-center justify-center rounded-full px-[2px] text-[9px] font-semibold leading-3 text-text-on-fill',
              active ? 'bg-dash-pill-fg-active' : 'bg-dash-pill-fg'
            )}
            data-parity-id='dash-global-filter-pill__badge'
            data-testid='dashboard-global-filter-chip-count'
          >
            {formatSourceCount(sourceCount)}
          </span>
        )}
      </span>
      <span
        className='min-w-0 truncate whitespace-nowrap leading-5'
        data-parity-id='dash-global-filter-pill__label'
        data-testid='dashboard-global-filter-chip-label'
      >
        {text}
      </span>
      <ArrowDown aria-hidden='true' className='h-3 w-3 shrink-0' data-parity-id='dash-global-filter-pill__chevron' />
      {dirty && <UnsavedDot placement='pill' testId='dashboard-global-filter-chip-dot' />}
    </button>
  );

  // A phone: the editor in a sheet titled like the pill; nothing hovers, so no source tooltip.
  if (mobile) {
    return (
      <GlobalFilterPopover
        align='start'
        entry='pill'
        filterId={filter.id}
        mobile
        onOpenChange={handleOpenChange}
        open={open}
        sheetTitle={text}
        trigger={pill}
      />
    );
  }

  return (
    <Tooltip delayDuration={500}>
      <GlobalFilterPopover
        align='start'
        entry='pill'
        filterId={filter.id}
        onOpenChange={handleOpenChange}
        open={open}
        sheetTitle={text}
        trigger={pill}
        wrapTrigger={wrapInTooltipTrigger}
      />
      {sourceLines.length > 0 && (
        <TooltipContent data-testid='dashboard-global-filter-chip-tooltip'>
          {sourceLines.map(({ databaseId, text: line }) => (
            <div key={databaseId}>{line}</div>
          ))}
        </TooltipContent>
      )}
    </Tooltip>
  );
});

export default GlobalFilterChip;
