import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { isStartDateCondition } from '@/application/database-yjs/fields/date/relativeDate';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import {
  applyConditionChange,
  conditionHidesContent,
  getGlobalFilterConditions,
  getGlobalFilterPillName,
  toggleDateConditionSide,
} from './global-filter.conditions';
import { getMergedGlobalFilterOptions, MergedSelection } from './global-filter.options';
import { getPrimaryTargetField, GlobalFilterSource, usesOptionContent } from './global-filter.utils';
import { GlobalFilterContent } from './GlobalFilterContent';

type FilterUpdater = (filter: DashboardGlobalFilter) => DashboardGlobalFilter;

/** The editor's quiet header controls: 12/16, secondary text, a 12px chevron. */
const headerTriggerClass =
  'h-7 min-w-0 max-w-full gap-0.5 px-1 py-0 text-xs font-normal text-text-secondary hover:bg-dash-hover-fill [&_svg]:h-3 [&_svg]:w-3';

/** "Is" → "is": Notion's condition trigger. */
function lowerFirst(text: string) {
  return text ? text.charAt(0).toLocaleLowerCase() + text.slice(1) : text;
}

export interface GlobalFilterPillEditorProps {
  filter: DashboardGlobalFilter;
  sources: GlobalFilterSource[];
  /** Writers get the `···` menu (Filter multiple sources, Delete filter). */
  canEditStructure: boolean;
  /** Condition and value changes (a viewer's are private). */
  onValueChange: (updater: FilterUpdater) => void;
  /** Select filters: ids and names together. */
  onSelectionChange: (selection: MergedSelection) => void;
  onOpenBuilder: () => void;
  onDelete: () => void;
}

/**
 * A pill's editor (WP08 §1.6): the name, the date side (Date only), the
 * condition and, for writers, `···`; then the value control, focused. There
 * is no footer: closing the popover keeps what was typed (debounced inputs
 * flush on unmount).
 */
export const GlobalFilterPillEditor = memo(function GlobalFilterPillEditor({
  filter,
  sources,
  canEditStructure,
  onValueChange,
  onSelectionChange,
  onOpenBuilder,
  onDelete,
}: GlobalFilterPillEditorProps) {
  const { t } = useTranslation();
  const conditionRef = useRef<HTMLButtonElement>(null);
  const { fieldType, condition } = filter;
  const conditions = useMemo(() => getGlobalFilterConditions(fieldType, condition, t), [condition, fieldType, t]);
  const selected = conditions.find((item) => item.value === condition);
  const showSide = fieldType === FieldType.DateTime;
  const isStart = isStartDateCondition(condition);
  const showContent = !conditionHidesContent(fieldType, condition);
  const primaryField = useMemo(() => getPrimaryTargetField(filter, sources), [filter, sources]);
  const optionEntries = useMemo(
    () => (usesOptionContent(fieldType) ? getMergedGlobalFilterOptions(filter, sources) : undefined),
    [fieldType, filter, sources]
  );
  const name = getGlobalFilterPillName(filter, primaryField?.name, '');
  const sides = [
    { start: true, text: t('dashboard.globalFilters.startDate', { defaultValue: 'Start date' }) },
    { start: false, text: t('dashboard.globalFilters.endDate', { defaultValue: 'End date' }) },
  ];
  const moreLabel = t('dashboard.globalFilters.moreActions', { defaultValue: 'More actions' });
  // Without a value control (checkbox, checklist, empty checks) the condition takes the focus.
  const focusCondition = !showContent;
  // Stable while the writer is, so the memoized value control re-renders with the filter only.
  const handleContentChange = useCallback(
    (content: string) =>
      onValueChange((current) => (current.content === content ? current : { ...current, content })),
    [onValueChange]
  );

  useEffect(() => {
    if (!focusCondition) return;
    const frame = requestAnimationFrame(() => conditionRef.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, [focusCondition]);

  return (
    <div
      className='flex flex-col gap-1.5 p-1'
      data-filter-id={filter.id}
      data-testid='dashboard-global-filter-pill-editor'
    >
      <div className='flex h-7 min-w-0 items-center gap-1'>
        {name && (
          <span className='max-w-[96px] shrink-0 truncate px-1 text-xs font-medium text-text-secondary' title={name}>
            {name}
          </span>
        )}
        {showSide && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className={headerTriggerClass} data-testid='dashboard-global-filter-date-side' variant='ghost'>
                <span className='truncate'>{sides.find((side) => side.start === isStart)?.text}</span>
                <ArrowDownSvg aria-hidden='true' className='shrink-0 text-icon-secondary' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className='min-w-fit'>
              {sides.map((side) => (
                <DropdownMenuItem
                  key={String(side.start)}
                  onSelect={() =>
                    onValueChange((current) => {
                      const next = toggleDateConditionSide(current.condition, side.start);

                      return next === current.condition ? current : { ...current, condition: next };
                    })
                  }
                >
                  {side.text}
                  {side.start === isStart && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className={headerTriggerClass}
              data-condition={condition}
              data-testid='dashboard-global-filter-condition'
              ref={conditionRef}
              variant='ghost'
            >
              <span className='truncate'>{lowerFirst(selected?.text ?? '')}</span>
              <ArrowDownSvg aria-hidden='true' className='shrink-0 text-icon-secondary' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className='max-h-[320px] min-w-fit overflow-y-auto'>
            <DropdownMenuGroup>
              {conditions.map((item) => (
                <DropdownMenuItem
                  className='min-h-7 py-1'
                  data-testid='dashboard-global-filter-condition-option'
                  data-value={item.value}
                  key={item.value}
                  onSelect={() => onValueChange((current) => applyConditionChange(current, item.value))}
                >
                  {item.text}
                  {item.value === condition && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className='flex-1' />
        {canEditStructure && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={moreLabel}
                    className='!rounded-200 text-icon-secondary [&_svg]:h-4 [&_svg]:w-4'
                    data-testid='dashboard-global-filter-more-actions'
                    size='icon-sm'
                    variant='ghost'
                  >
                    <MoreIcon aria-hidden='true' />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{moreLabel}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align='end' className='w-[220px] min-w-[220px] !rounded-[10px] p-1'>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className='min-h-7 py-1'
                  data-testid='dashboard-global-filter-open-builder'
                  onSelect={onOpenBuilder}
                >
                  <SettingsIcon aria-hidden='true' className='h-4 w-4 text-icon-secondary' />
                  {t('dashboard.globalFilters.title', { defaultValue: 'Filter multiple sources' })}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className='min-h-7 py-1'
                  data-testid='dashboard-global-filter-delete'
                  onSelect={onDelete}
                >
                  <DeleteIcon aria-hidden='true' className='h-4 w-4 text-icon-secondary' />
                  {t('dashboard.globalFilters.delete', { defaultValue: 'Delete filter' })}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {showContent && (
        <div>
          <GlobalFilterContent
            autoFocus
            filter={filter}
            onChange={handleContentChange}
            onSelectionChange={onSelectionChange}
            optionEntries={optionEntries}
          />
        </div>
      )}
    </div>
  );
});

export default GlobalFilterPillEditor;
