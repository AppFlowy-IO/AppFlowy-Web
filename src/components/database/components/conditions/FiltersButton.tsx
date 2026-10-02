import { FocusEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFiltersSelector, useConditionsReadOnly } from '@/application/database-yjs';
import { useAddFilter } from '@/application/database-yjs/dispatch';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { FILTER_EXCLUDED_FIELD_TYPES } from '@/components/database/components/filters/filter-field-types';
import { WidgetConditionsPopover } from '@/components/database/dashboard/WidgetConditionsPopover';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useConditionsContext } from './context';

/** A dashboard widget's tool: 24×24, radius 6, a 16px glyph; accent when active or in Edit mode. */
export const WIDGET_TOOL_BUTTON_CLASS =
  '!rounded-200 text-dash-tool-icon data-[active=true]:text-dash-edit-icon [&_svg]:h-4 [&_svg]:w-4';

/**
 * A widget tool's tooltip is hover-only, like the title's breadcrumb and the
 * desktop tooltips: the focus a closing popover hands back must not open it
 * over the global filter bar just above the header, where it would sit on the
 * Save button. Radix skips its open-on-focus when the focus event is
 * prevented; pair this with `disableHoverableContent` on the `Tooltip`.
 */
export function preventWidgetToolFocusTooltip(event: FocusEvent) {
  event.preventDefault();
}

function FiltersButton({
  compact = false,
  toggleExpanded,
  expanded,
  presentation = 'bar',
  variant = 'toolbar',
  editing = false,
}: {
  compact?: boolean;
  toggleExpanded?: () => void;
  expanded?: boolean;
  /** `bar` reveals the conditions bar; `popover` (dashboard widgets) opens the "Filters" popover instead. */
  presentation?: 'bar' | 'popover';
  /** `widget`: the dashboard widget tool style. */
  variant?: 'toolbar' | 'widget';
  /** The dashboard is in Edit mode (widget tools turn accent). */
  editing?: boolean;
}) {
  const filters = useFiltersSelector();
  const readOnly = useConditionsReadOnly();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const addFilter = useAddFilter();
  const conditionsContext = useConditionsContext();
  const setOpenFilterId = conditionsContext?.setOpenFilterId;
  const setExpanded = conditionsContext?.setExpanded;
  const prevFiltersLengthRef = useRef(filters.length);
  const popover = presentation === 'popover';
  const active = filters.length > 0;

  // Auto-expand conditions panel when first filter is added. A popover never
  // opens by itself (a collaborator's first filter must not pop it up).
  useEffect(() => {
    const prevLength = prevFiltersLengthRef.current;
    const currentLength = filters.length;

    // If filters went from 0 to 1+, expand the panel
    if (!popover && prevLength === 0 && currentLength > 0) {
      setExpanded?.(true);
    }

    prevFiltersLengthRef.current = currentLength;
  }, [filters.length, popover, setExpanded]);

  const menu = (
    <PropertiesMenu
      open={open}
      onOpenChange={setOpen}
      searchPlaceholder={t('grid.settings.filterBy')}
      excludedTypes={FILTER_EXCLUDED_FIELD_TYPES}
      onSelect={(fieldId) => {
        const filterId = addFilter(fieldId);

        setOpenFilterId?.(filterId);
        // The new rule's editor opens inside the Filters popover.
        if (popover) setExpanded?.(true);
      }}
      asChild
    >
      <div>
        <Tooltip disableHoverableContent={variant === 'widget'}>
          <TooltipTrigger asChild onFocus={variant === 'widget' ? preventWidgetToolFocusTooltip : undefined}>
            <Button
              aria-label={t('grid.settings.filter')}
              variant={'ghost'}
              size={compact || variant === 'widget' ? 'icon-sm' : 'icon'}
              className={cn(
                'relative',
                variant === 'widget' && WIDGET_TOOL_BUTTON_CLASS,
                variant === 'widget' && editing && 'text-dash-edit-icon'
              )}
              data-active={variant === 'widget' ? String(active) : undefined}
              data-parity-id={variant === 'widget' ? 'dash-widget-tool-filter' : undefined}
              data-testid={'database-actions-filter'}
              onClick={(e) => {
                e.stopPropagation();
                if (popover) {
                  // No filters: pick a property first. Otherwise toggle the popover.
                  if (!readOnly && filters.length === 0) setOpen(true);
                  else toggleExpanded?.();
                  return;
                }

                // Desktop parity: an open bar always collapses first; otherwise
                // no filters → open the field picker, filters → reveal the bar.
                if (expanded) {
                  toggleExpanded?.();
                  return;
                }

                if (readOnly || filters.length > 0) {
                  toggleExpanded?.();
                } else {
                  setOpen(true);
                }
              }}
              style={{
                color: variant === 'toolbar' && active ? 'var(--icon-info-thick)' : undefined,
              }}
              type='button'
            >
              <FilterIcon
                aria-hidden='true'
                className={'h-5 w-5'}
                data-parity-id={variant === 'widget' ? 'dash-widget-tool-filter__icon' : undefined}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('grid.settings.filter')}</TooltipContent>
        </Tooltip>
      </div>
    </PropertiesMenu>
  );

  if (!popover) return menu;

  return (
    <WidgetConditionsPopover
      kind='filters'
      onOpenChange={(next) => {
        setExpanded?.(next);
        if (!next) conditionsContext?.setAdvancedPanelOpen?.(false);
      }}
      open={Boolean(expanded)}
    >
      {menu}
    </WidgetConditionsPopover>
  );
}

export default FiltersButton;
