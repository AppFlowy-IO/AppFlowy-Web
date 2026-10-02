import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useConditionsReadOnly, useSortsSelector } from '@/application/database-yjs';
import { useAddSort } from '@/application/database-yjs/dispatch';
import { ReactComponent as SortIcon } from '@/assets/icons/sort.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { WidgetConditionsPopover } from '@/components/database/dashboard/WidgetConditionsPopover';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useConditionsContext } from './context';
import { preventWidgetToolFocusTooltip, WIDGET_TOOL_BUTTON_CLASS } from './FiltersButton';
import { useRollupSortableIds } from '../sorts/utils';

function SortsButton({
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
  /** `bar` reveals the conditions bar; `popover` (dashboard widgets) opens the "Sorts" popover instead. */
  presentation?: 'bar' | 'popover';
  /** `widget`: the dashboard widget tool style. */
  variant?: 'toolbar' | 'widget';
  /** The dashboard is in Edit mode (widget tools turn accent). */
  editing?: boolean;
}) {
  const sorts = useSortsSelector();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const readOnly = useConditionsReadOnly();
  const addSort = useAddSort();
  const conditionsContext = useConditionsContext();
  const setExpanded = conditionsContext?.setExpanded;
  const setSortMenuOpen = conditionsContext?.setSortMenuOpen;
  const prevSortsLengthRef = useRef(sorts.length);
  const popover = presentation === 'popover';
  const active = sorts.length > 0;

  // Auto-expand conditions panel when first sort is added (e.g. synced from
  // desktop). A popover never opens by itself.
  useEffect(() => {
    const prevLength = prevSortsLengthRef.current;
    const currentLength = sorts.length;

    if (!popover && prevLength === 0 && currentLength > 0) {
      setExpanded?.(true);
    }

    prevSortsLengthRef.current = currentLength;
  }, [popover, sorts.length, setExpanded]);

  const rollupSortableIds = useRollupSortableIds();
  const propertyFilter = useCallback(
    (property: { id: string; type: FieldType }) => {
      if (property.type !== FieldType.Rollup) return true;
      return rollupSortableIds.has(property.id);
    },
    [rollupSortableIds]
  );
  const excludedTypes = useMemo(() => [FieldType.Person], []);

  const menu = (
    <PropertiesMenu
      open={open}
      onOpenChange={setOpen}
      searchPlaceholder={t('grid.settings.sortBy')}
      onSelect={(fieldId) => {
        addSort(fieldId);
        if (!popover && !expanded) {
          toggleExpanded?.();
        }

        // Desktop parity: adding a sort from the toolbar opens the sort editor
        // (in a widget, the Sorts popover).
        setSortMenuOpen?.(true);
      }}
      excludedTypes={excludedTypes}
      propertyFilter={propertyFilter}
      asChild
    >
      <div>
        <Tooltip disableHoverableContent={variant === 'widget'}>
          <TooltipTrigger asChild onFocus={variant === 'widget' ? preventWidgetToolFocusTooltip : undefined}>
            <Button
              aria-label={t('grid.settings.sort')}
              variant={'ghost'}
              size={compact || variant === 'widget' ? 'icon-sm' : 'icon'}
              data-active={variant === 'widget' ? String(active) : undefined}
              data-parity-id={variant === 'widget' ? 'dash-widget-tool-sort' : undefined}
              data-testid={'database-actions-sort'}
              className={cn(
                'relative',
                variant === 'widget' && WIDGET_TOOL_BUTTON_CLASS,
                variant === 'widget' && editing && 'text-dash-edit-icon'
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (popover) {
                  // No sorts: pick a property first. Otherwise toggle the popover.
                  if (!readOnly && sorts.length === 0) setOpen(true);
                  else setSortMenuOpen?.(!conditionsContext?.sortMenuOpen);
                  return;
                }

                if (readOnly || sorts.length > 0) {
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
              <SortIcon
                aria-hidden='true'
                className={'h-5 w-5'}
                data-parity-id={variant === 'widget' ? 'dash-widget-tool-sort__icon' : undefined}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('grid.settings.sort')}</TooltipContent>
        </Tooltip>
      </div>
    </PropertiesMenu>
  );

  if (!popover) return menu;

  return (
    <WidgetConditionsPopover
      kind='sorts'
      onOpenChange={(next) => setSortMenuOpen?.(next)}
      open={Boolean(conditionsContext?.sortMenuOpen)}
    >
      {menu}
    </WidgetConditionsPopover>
  );
}

export default SortsButton;
