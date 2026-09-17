import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { isStartDateCondition } from '@/application/database-yjs/fields/date/relativeDate';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as ArrowLeftSvg } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { useDebouncedFilterInput } from '@/components/database/components/filters/hooks/useDebouncedFilterInput';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import {
  applyConditionChange,
  conditionHidesContent,
  getFieldTypeName,
  getGlobalFilterConditions,
  toggleDateConditionSide,
} from './global-filter.conditions';
import {
  addGlobalFilterSource,
  getAddableSources,
  getMappedSources,
  getPrimaryTargetField,
  getTargetCandidates,
  GlobalFilterSource,
  removeGlobalFilterTarget,
  setGlobalFilterTarget,
} from './global-filter.utils';
import { GlobalFilterContent } from './GlobalFilterContent';

type FilterUpdater = (filter: DashboardGlobalFilter) => DashboardGlobalFilter;

const triggerClassName = 'h-7 min-w-0 max-w-full justify-between gap-1 px-2 text-xs font-medium text-text-primary';

function withPatch(filter: DashboardGlobalFilter, patch: Partial<DashboardGlobalFilter>): DashboardGlobalFilter {
  const changed = (Object.keys(patch) as (keyof DashboardGlobalFilter)[]).some((key) => patch[key] !== filter[key]);

  return changed ? { ...filter, ...patch } : filter;
}

function TargetRow({
  filter,
  source,
  sources,
  onChange,
}: {
  filter: DashboardGlobalFilter;
  source: GlobalFilterSource;
  sources: GlobalFilterSource[];
  onChange: (updater: FilterUpdater) => void;
}) {
  const { t } = useTranslation();
  const { databaseId } = source;
  const fieldId = filter.targets[databaseId];
  // A property that changed type no longer fits the filter; show the mapping as unset so it gets re-picked.
  const mappedField = fieldId
    ? source.fields.find((field) => field.id === fieldId && field.type === filter.fieldType)
    : undefined;
  const candidates = getTargetCandidates(filter, sources, databaseId);
  const untitled = t('untitled', { defaultValue: 'Untitled' });
  const removeLabel = t('dashboard.globalFilters.remove', { defaultValue: 'Remove' });

  return (
    <div
      data-testid='dashboard-global-filter-target'
      data-database-id={databaseId}
      data-field-id={fieldId ?? ''}
      className='flex min-h-[32px] items-center gap-2'
    >
      <span className='min-w-0 flex-1 truncate text-sm text-text-primary' title={source.name}>
        {source.name}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='outline'
            size='sm'
            disabled={candidates.length === 0}
            className={cn(triggerClassName, 'w-[150px]')}
            data-testid='dashboard-global-filter-target-select'
          >
            <span className='flex min-w-0 items-center gap-1'>
              {mappedField ? (
                <>
                  <FieldTypeIcon type={mappedField.type} className='h-4 w-4 shrink-0 text-icon-secondary' />
                  <span className='truncate'>{mappedField.name || untitled}</span>
                </>
              ) : (
                <span className='truncate text-text-tertiary'>
                  {t('dashboard.globalFilters.property', { defaultValue: 'Property' })}
                </span>
              )}
            </span>
            <ArrowDownSvg className='h-4 w-4 shrink-0 text-icon-secondary' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='min-w-[180px]'>
          <DropdownMenuGroup>
            {candidates.map((field) => (
              <DropdownMenuItem
                key={field.id}
                data-testid='dashboard-global-filter-target-option'
                data-field-id={field.id}
                onSelect={() => onChange((current) => setGlobalFilterTarget(current, sources, databaseId, field.id))}
              >
                <FieldTypeIcon type={field.type} className='text-icon-secondary' />
                <span className='truncate'>{field.name || untitled}</span>
                {field.id === fieldId && <DropdownMenuItemTick />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={removeLabel}
            data-testid='dashboard-global-filter-target-remove'
            onClick={() => onChange((current) => removeGlobalFilterTarget(current, sources, databaseId))}
          >
            <CloseIcon className='h-4 w-4' />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{removeLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Maps one more source database (to its first compatible property). */
function AddSourceButton({
  addable,
  sources,
  onChange,
}: {
  addable: GlobalFilterSource[];
  sources: GlobalFilterSource[];
  onChange: (updater: FilterUpdater) => void;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          className='h-7 self-start px-2 text-xs font-medium text-text-secondary'
          data-testid='dashboard-global-filter-add-source'
        >
          <PlusIcon className='h-4 w-4 text-icon-secondary' />
          {t('dashboard.globalFilters.addSource', { defaultValue: 'Add source' })}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-[200px]'>
        <DropdownMenuGroup>
          {addable.map((source) => (
            <DropdownMenuItem
              key={source.databaseId}
              data-testid='dashboard-global-filter-add-source-option'
              data-database-id={source.databaseId}
              onSelect={() => onChange((current) => addGlobalFilterSource(current, sources, source.databaseId))}
            >
              <span className='truncate'>{source.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConditionSelect({
  filter,
  onChange,
}: {
  filter: DashboardGlobalFilter;
  onChange: (updater: FilterUpdater) => void;
}) {
  const { t } = useTranslation();
  const conditions = useMemo(
    () => getGlobalFilterConditions(filter.fieldType, filter.condition, t),
    [filter.condition, filter.fieldType, t]
  );
  const selected = conditions.find((condition) => condition.value === filter.condition);
  const showSide = filter.fieldType === FieldType.DateTime;
  const isStart = isStartDateCondition(filter.condition);
  const sides = [
    { start: true, text: t('grid.dateFilter.startDate') },
    { start: false, text: t('grid.dateFilter.endDate') },
  ];

  return (
    <div className='flex min-w-0 items-center gap-1'>
      {showSide && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              className={triggerClassName}
              data-testid='dashboard-global-filter-date-side'
            >
              {sides.find((side) => side.start === isStart)?.text}
              <ArrowDownSvg className='h-4 w-4 text-icon-secondary' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className='min-w-fit'>
            {sides.map((side) => (
              <DropdownMenuItem
                key={String(side.start)}
                onSelect={() =>
                  onChange((current) =>
                    withPatch(current, { condition: toggleDateConditionSide(current.condition, side.start) })
                  )
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
            variant='ghost'
            size='sm'
            className={triggerClassName}
            data-testid='dashboard-global-filter-condition'
            data-condition={filter.condition}
          >
            <span className='truncate'>{selected?.text ?? ''}</span>
            <ArrowDownSvg className='h-4 w-4 shrink-0 text-icon-secondary' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='min-w-fit'>
          <DropdownMenuGroup>
            {conditions.map((condition) => (
              <DropdownMenuItem
                key={condition.value}
                data-testid='dashboard-global-filter-condition-option'
                data-value={condition.value}
                onSelect={() => onChange((current) => applyConditionChange(current, condition.value))}
              >
                {condition.text}
                {condition.value === filter.condition && <DropdownMenuItemTick />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export interface GlobalFilterEditorProps {
  filter: DashboardGlobalFilter;
  sources: GlobalFilterSource[];
  /** Names of databases that are mapped but not loaded, keyed by database id. */
  sourceNames?: Record<string, string>;
  onChange: (updater: FilterUpdater) => void;
  onDelete: () => void;
  /** Finishes editing (closes the menu). */
  onDone: () => void;
  /** Shown as a back arrow when the editor was reached from the filter list. */
  onBack?: () => void;
}

const NO_NAMES: Record<string, string> = {};

/** Name, per-source property mapping, condition and value of one global filter. */
export function GlobalFilterEditor({
  filter,
  sources,
  sourceNames = NO_NAMES,
  onChange,
  onDelete,
  onDone,
  onBack,
}: GlobalFilterEditorProps) {
  const { t } = useTranslation();
  const typeName = getFieldTypeName(filter.fieldType, t);
  const untitled = t('untitled', { defaultValue: 'Untitled' });
  const mapped = getMappedSources(filter, sources, (databaseId) => sourceNames[databaseId] || untitled);
  const addable = getAddableSources(filter, sources);
  const primaryField = getPrimaryTargetField(filter, sources);
  // Like the view filter updater, a flush without a pending value (no content) is ignored.
  const updateName = useCallback(
    ({ content }: { content?: string }) => {
      if (typeof content !== 'string') return;
      onChange((current) => withPatch(current, { name: content }));
    },
    [onChange]
  );
  const updateContent = useCallback(
    (content: string) => onChange((current) => withPatch(current, { content })),
    [onChange]
  );
  const { value: name, updateValue: setName } = useDebouncedFilterInput({
    content: filter.name,
    filterId: filter.id,
    fieldId: 'name',
    updateFilter: updateName,
  });
  const showContent = !conditionHidesContent(filter.fieldType, filter.condition);

  return (
    <div className='flex flex-col gap-3' data-testid='dashboard-global-filter-editor' data-filter-id={filter.id}>
      <div className='flex items-center gap-1'>
        {onBack && (
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('button.back', { defaultValue: 'Back' })}
            data-testid='dashboard-global-filter-back'
            onClick={onBack}
          >
            <ArrowLeftSvg className='h-4 w-4' />
          </Button>
        )}
        <FieldTypeIcon type={filter.fieldType} className='h-4 w-4 shrink-0 text-icon-secondary' />
        <span className='truncate text-xs font-medium text-text-tertiary'>{typeName}</span>
      </div>

      <Input
        data-testid='dashboard-global-filter-name'
        size='sm'
        value={name}
        spellCheck={false}
        placeholder={primaryField?.name || typeName}
        aria-label={t('dashboard.globalFilters.name', { defaultValue: 'Filter name' })}
        onChange={(event) => setName(event.target.value)}
      />

      <div className='flex flex-col gap-1'>
        <p className='text-xs text-text-secondary'>
          {t('dashboard.globalFilters.appliesTo', {
            type: typeName,
            defaultValue: 'This filter will apply across {{type}} properties selected below',
          })}
        </p>
        {mapped.length === 0 && addable.length === 0 && (
          <p className='py-1 text-sm text-text-tertiary' data-testid='dashboard-global-filter-no-targets'>
            {t('dashboard.globalFilters.noTargets', { defaultValue: 'No widgets have a property of this type' })}
          </p>
        )}
        {mapped.map((source) => (
          <TargetRow key={source.databaseId} filter={filter} source={source} sources={sources} onChange={onChange} />
        ))}
        {addable.length > 0 && <AddSourceButton addable={addable} sources={sources} onChange={onChange} />}
      </div>

      <div className='flex flex-col gap-1 border-t border-border-primary pt-2'>
        <ConditionSelect filter={filter} onChange={onChange} />
        {showContent && <GlobalFilterContent filter={filter} primaryField={primaryField} onChange={updateContent} />}
      </div>

      <div className='flex items-center justify-between gap-2 border-t border-border-primary pt-2'>
        <Button variant='ghost' size='sm' danger data-testid='dashboard-global-filter-delete' onClick={onDelete}>
          <DeleteIcon className='h-4 w-4' />
          {t('dashboard.globalFilters.delete', { defaultValue: 'Delete filter' })}
        </Button>
        <Button size='sm' data-testid='dashboard-global-filter-done' onClick={onDone}>
          {t('dashboard.globalFilters.done', { defaultValue: 'Done' })}
        </Button>
      </div>
    </div>
  );
}

export default GlobalFilterEditor;
