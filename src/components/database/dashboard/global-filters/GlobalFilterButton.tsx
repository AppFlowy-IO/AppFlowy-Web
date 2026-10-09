import {
  ComponentPropsWithoutRef,
  FocusEventHandler,
  forwardRef,
  PointerEventHandler,
  useCallback,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import { useDashboardContextOptional, useDashboardFilters } from '@/components/database/dashboard/DashboardContext';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { UnsavedDot } from '../private/UnsavedDot';

import { isGlobalFilterActive } from './global-filter.conditions';
import { GlobalFilterPopover, globalFilterTriggerProps, wrapInTooltipTrigger } from './GlobalFilterPopover';
import { useDashboardFilterSources } from './useGlobalFilterActions';

interface FilterGlyphButtonProps extends ComponentPropsWithoutRef<typeof Button> {
  /** Filters that narrow rows right now: the glyph is accent from the first. */
  activeCount: number;
  /** A value is unsaved (WP07): the orange dot. */
  dirty: boolean;
  label: string;
  open: boolean;
}

/** The toolbar button itself; the popover's (and tooltip's) trigger slot adds its handlers and ref. */
const FilterGlyphButton = forwardRef<HTMLButtonElement, FilterGlyphButtonProps>(function FilterGlyphButton(
  { activeCount, dirty, label, open, className, onFocus, onPointerEnter, ...props },
  ref
) {
  // The slots' handlers come in as props; the menu preload runs alongside them.
  const handleFocus = useCallback<FocusEventHandler<HTMLButtonElement>>(
    (event) => {
      onFocus?.(event);
      globalFilterTriggerProps.onFocus();
    },
    [onFocus]
  );
  const handlePointerEnter = useCallback<PointerEventHandler<HTMLButtonElement>>(
    (event) => {
      onPointerEnter?.(event);
      globalFilterTriggerProps.onPointerEnter();
    },
    [onPointerEnter]
  );

  return (
    <Button
      ref={ref}
      type='button'
      variant='ghost'
      size='icon'
      aria-label={label}
      // The dashboard toolbar button: 28×28, radius 6, a 16px glyph, accent while a filter narrows rows.
      className={cn(
        'relative h-7 w-7 !rounded-200 p-1.5 data-[state=open]:bg-dash-hover-fill [&_svg]:h-4 [&_svg]:w-4',
        activeCount > 0 ? 'text-dash-accent' : 'text-dash-tool-icon',
        className
      )}
      data-active={activeCount > 0}
      data-count={activeCount}
      data-parity-id='dash-toolbar-filter'
      data-testid='dashboard-global-filter-button'
      {...props}
      onFocus={handleFocus}
      onPointerEnter={handlePointerEnter}
      // Set here: the tooltip trigger around it would otherwise put its own state on the button.
      data-state={open ? 'open' : 'closed'}
    >
      <FilterIcon aria-hidden='true' data-parity-id='dash-toolbar-filter__icon' />
      {dirty && (
        <UnsavedDot
          parityId='dash-toolbar-filter__dot'
          placement='toolbar'
          testId='dashboard-global-filter-button-dot'
        />
      )}
    </Button>
  );
});

/**
 * With filters: the active count follows the loaded sources, as the pills and
 * desktop count it, so a mapping whose property was deleted or changed type
 * (which the evaluator skips) never colours the glyph. The sources are
 * observed only here, while there are filters; the pills observe the same
 * per-doc stores then, so this adds no Yjs observer.
 */
const ActiveFilterGlyphButton = forwardRef<
  HTMLButtonElement,
  Omit<FilterGlyphButtonProps, 'activeCount'> & { filters: DashboardGlobalFilter[] }
>(function ActiveFilterGlyphButton({ filters, ...props }, ref) {
  const sources = useDashboardFilterSources();
  const activeCount = useMemo(
    () => filters.filter((filter) => isGlobalFilterActive(filter, sources)).length,
    [filters, sources]
  );

  return <FilterGlyphButton ref={ref} activeCount={activeCount} {...props} />;
});

interface ToolbarFilterButtonProps {
  filters: DashboardGlobalFilter[];
  /** A value is unsaved (WP07): the orange dot. */
  dirty: boolean;
  mobile: boolean;
}

/**
 * The button in its popover: with a tooltip on desktop, a "Filter" bottom
 * sheet on a phone. The popover (and the menu screen it holds) must survive
 * the first filter being added from it ("Filter multiple sources" goes on to
 * the builder), so only the trigger changes with the filter count; the
 * popover stays mounted.
 */
function ToolbarFilterButton({ filters, dirty, mobile }: ToolbarFilterButtonProps) {
  const { t } = useTranslation();
  const label = t('dashboard.globalFilters.button', { defaultValue: 'Filter' });

  // Without filters nothing narrows rows, and no source database is observed.
  const button = (open: boolean) =>
    filters.length === 0 ? (
      <FilterGlyphButton activeCount={0} dirty={dirty} label={label} open={open} />
    ) : (
      <ActiveFilterGlyphButton dirty={dirty} filters={filters} label={label} open={open} />
    );

  // A phone opens a "Filter" bottom sheet; nothing hovers there, so no tooltip.
  if (mobile) {
    return <GlobalFilterPopover align='end' entry='toolbar' mobile sheetTitle={label} trigger={button} />;
  }

  return (
    <Tooltip>
      <GlobalFilterPopover
        align='end'
        entry='toolbar'
        sheetTitle={label}
        trigger={button}
        wrapTrigger={wrapInTooltipTrigger}
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function GlobalFilterButtonContent({ canEdit, mobile }: { canEdit: boolean; mobile: boolean }) {
  const { effectiveGlobalFilters, dirtyGlobalFilterIds } = useDashboardFilters();
  const dirty = dirtyGlobalFilterIds.size > 0;

  // A reader with nothing to adjust gets no button (an empty popover helps nobody).
  if (!canEdit && effectiveGlobalFilters.length === 0) return null;
  return <ToolbarFilterButton dirty={dirty} filters={effectiveGlobalFilters} mobile={mobile} />;
}

/**
 * The toolbar's Filter button: the property-first picker for writers, the
 * list of the dashboard's filters for readers (who can change their values
 * for themselves). No count; the orange dot marks an unsaved value. On a
 * phone it opens a bottom sheet. Renders nothing outside a `DashboardProvider`.
 */
export function GlobalFilterButton() {
  const context = useDashboardContextOptional();

  if (!context) return null;
  return <GlobalFilterButtonContent canEdit={context.canEdit} mobile={context.mobileContext} />;
}

export default GlobalFilterButton;
