import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as ArrowLeftSvg } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as DatabaseIcon } from '@/assets/icons/database.svg';
import { ReactComponent as GridIcon } from '@/assets/icons/grid.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { getFieldTypeName } from '@/components/database/components/field/FieldLabel';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import {
  GLOBAL_FILTER_INPUT_DEBOUNCE_MS,
  useDebouncedFilterInput,
} from '@/components/database/components/filters/hooks/useDebouncedFilterInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { getAddableSources, getMappedSources, getPrimaryTargetField, GlobalFilterSource } from './global-filter.utils';

type FilterUpdater = (filter: DashboardGlobalFilter) => DashboardGlobalFilter;

const ROUND_CLOSE_CLASS = '!rounded-full text-icon-secondary hover:bg-dash-hover-fill [&_svg]:h-4 [&_svg]:w-4';

/**
 * "Filter multiple sources": what it does, and the way in (WP08 §1.4, screen
 * 1). In a phone sheet the sheet's header closes it (`showClose` false).
 */
export function GlobalFilterMultiIntro({
  onAdd,
  onClose,
  showClose = true,
}: {
  onAdd: () => void;
  onClose: () => void;
  showClose?: boolean;
}) {
  const { t } = useTranslation();
  const closeLabel = t('dashboard.widget.close', { defaultValue: 'Close' });

  return (
    <div className='flex flex-col p-2' data-testid='dashboard-global-filter-multi-intro'>
      <div className='flex items-center gap-2'>
        <span className='flex-1 truncate text-sm font-semibold text-text-primary'>
          {t('dashboard.globalFilters.title', { defaultValue: 'Filter multiple sources' })}
        </span>
        {showClose ? (
          <Button aria-label={closeLabel} className={ROUND_CLOSE_CLASS} onClick={onClose} size='icon-sm' variant='ghost'>
            <CloseIcon aria-hidden='true' />
          </Button>
        ) : null}
      </div>
      {/* Composed from widgets, no asset: a neutral pill above three grid icons. */}
      <div
        aria-hidden='true'
        className='mt-2 flex h-28 flex-col items-center justify-center gap-3 rounded-300 border border-border-primary'
      >
        <span className='flex h-7 items-center gap-1 rounded-[14px] border border-border-primary px-2 text-sm text-text-secondary'>
          <span className='h-3 w-3 rounded-full border-2 border-icon-tertiary border-t-transparent' />
          Status: In progress
        </span>
        <span className='flex items-center gap-4'>
          {['bg-dash-accent', 'bg-[#E97366]', 'bg-[#EAC26B]'].map((dot) => (
            <span className='relative' key={dot}>
              <GridIcon className='h-5 w-5 text-icon-secondary' />
              <span className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${dot}`} />
            </span>
          ))}
        </span>
      </div>
      <p className='my-3 text-sm text-text-secondary'>
        {t('dashboard.globalFilters.multipleSourcesIntro', {
          defaultValue: 'Create a filter that applies across properties from multiple sources',
        })}
      </p>
      <Button className='h-8 w-full !rounded-200' data-testid='dashboard-global-filter-add-to-filter' onClick={onAdd}>
        <PlusIcon aria-hidden='true' className='h-4 w-4' />
        {t('dashboard.globalFilters.addToFilter', { defaultValue: 'Add to filter' })}
      </Button>
    </div>
  );
}

/** The filter's name, with its own debounced draft (typing re-renders only the input). */
const GlobalFilterNameInput = memo(function GlobalFilterNameInput({
  filterId,
  name,
  placeholder,
  onChange,
}: {
  filterId: string;
  name: string;
  placeholder: string;
  onChange: (updater: FilterUpdater) => void;
}) {
  const { t } = useTranslation();
  // Like the view filter updater, a flush without a pending value is ignored.
  const updateName = useCallback(
    ({ content }: { content?: string }) => {
      if (typeof content !== 'string') return;
      onChange((current) => (current.name === content ? current : { ...current, name: content }));
    },
    [onChange]
  );
  const { value, updateValue } = useDebouncedFilterInput({
    content: name,
    filterId,
    fieldId: 'name',
    updateFilter: updateName,
    debounceMs: GLOBAL_FILTER_INPUT_DEBOUNCE_MS,
  });

  return (
    <Input
      aria-label={t('dashboard.globalFilters.name', { defaultValue: 'Filter name' })}
      className='h-7 min-w-0 flex-1'
      data-testid='dashboard-global-filter-name'
      onChange={(event) => updateValue(event.target.value)}
      placeholder={placeholder}
      size='sm'
      spellCheck={false}
      value={value}
    />
  );
});

const TargetRow = memo(function TargetRow({
  filter,
  source,
  onRemove,
}: {
  filter: Pick<DashboardGlobalFilter, 'fieldType' | 'targets'>;
  source: GlobalFilterSource;
  onRemove: (databaseId: string) => void;
}) {
  const { t } = useTranslation();
  const { databaseId } = source;
  const fieldId = filter.targets[databaseId];
  const field = source.fields.find((item) => item.id === fieldId && item.type === filter.fieldType);
  const untitled = t('untitled', { defaultValue: 'Untitled' });
  const removeLabel = t('dashboard.globalFilters.remove', { defaultValue: 'Remove' });

  return (
    <div
      className='flex h-10 items-center gap-2'
      data-database-id={databaseId}
      data-field-id={fieldId ?? ''}
      data-testid='dashboard-global-filter-target'
    >
      <FieldTypeIcon className='h-4 w-4 shrink-0 text-icon-secondary' type={filter.fieldType} />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-sm text-text-primary'>{field?.name || untitled}</span>
        <span className='flex min-w-0 items-center gap-1 text-xs text-text-secondary'>
          <DatabaseIcon aria-hidden='true' className='h-3 w-3 shrink-0' />
          <span className='truncate'>{source.name || untitled}</span>
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={removeLabel}
            className='!rounded-200 text-icon-secondary [&_svg]:h-4 [&_svg]:w-4'
            data-testid='dashboard-global-filter-target-remove'
            onClick={() => onRemove(databaseId)}
            size='icon-sm'
            variant='ghost'
          >
            <CloseIcon aria-hidden='true' />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{removeLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
});

export interface GlobalFilterBuilderProps {
  filter: DashboardGlobalFilter;
  sources: GlobalFilterSource[];
  /** Names of databases that are mapped but not loaded. */
  sourceNames?: Record<string, string>;
  onRename: (updater: FilterUpdater) => void;
  onRemoveTarget: (databaseId: string) => void;
  onAddAnother: () => void;
  onDone: () => void;
  /** A back arrow (the builder was reached from the pill's editor). */
  onBack?: () => void;
}

const NO_NAMES: Record<string, string> = {};

/**
 * One filter across same-type properties (WP08 §1.4, screen 3): its name,
 * one row per mapped property and source, "Add another" while a source has a
 * property of the type, and Done (disabled without a source).
 */
export function GlobalFilterBuilder({
  filter,
  sources,
  sourceNames = NO_NAMES,
  onRename,
  onRemoveTarget,
  onAddAnother,
  onDone,
  onBack,
}: GlobalFilterBuilderProps) {
  const { t } = useTranslation();
  const typeName = getFieldTypeName(filter.fieldType, t);
  const untitled = t('untitled', { defaultValue: 'Untitled' });
  const mapped = useMemo(
    () => getMappedSources(filter, sources, (databaseId) => sourceNames[databaseId] || untitled),
    [filter, sources, sourceNames, untitled]
  );
  const addable = useMemo(() => getAddableSources(filter, sources), [filter, sources]);
  const primaryField = useMemo(() => getPrimaryTargetField(filter, sources), [filter, sources]);
  const targetCount = Object.keys(filter.targets).length;

  return (
    <div className='flex flex-col gap-2 p-2' data-filter-id={filter.id} data-testid='dashboard-global-filter-builder'>
      <div className='flex items-center gap-2'>
        {onBack && (
          <Button
            aria-label={t('button.back', { defaultValue: 'Back' })}
            className='!rounded-200 text-icon-secondary [&_svg]:h-4 [&_svg]:w-4'
            data-parity-id='dash-global-filter-back'
            data-testid='dashboard-global-filter-back'
            onClick={onBack}
            size='icon-sm'
            variant='ghost'
          >
            <ArrowLeftSvg aria-hidden='true' data-parity-id='dash-global-filter-back__icon' />
          </Button>
        )}
        <FieldTypeIcon className='h-4 w-4 shrink-0 text-icon-secondary' type={filter.fieldType} />
        <GlobalFilterNameInput
          filterId={filter.id}
          name={filter.name}
          onChange={onRename}
          placeholder={primaryField?.name || typeName}
        />
      </div>
      <p className='text-xs text-text-secondary'>
        {t('dashboard.globalFilters.appliesTo', {
          type: typeName,
          defaultValue: 'This filter will apply across {{type}} properties selected below',
        })}
      </p>
      <div className='flex flex-col'>
        {mapped.map((source) => (
          <TargetRow filter={filter} key={source.databaseId} onRemove={onRemoveTarget} source={source} />
        ))}
      </div>
      {addable.length > 0 && (
        <Button
          className='h-7 self-start !rounded-200 px-2 text-sm font-normal'
          data-testid='dashboard-global-filter-add-another'
          onClick={onAddAnother}
          size='sm'
          variant='outline'
        >
          <PlusIcon aria-hidden='true' className='h-4 w-4 text-icon-secondary' />
          {t('dashboard.globalFilters.addAnother', { defaultValue: 'Add another' })}
        </Button>
      )}
      <Button
        className='h-8 w-full !rounded-200'
        data-testid='dashboard-global-filter-done'
        disabled={targetCount === 0}
        onClick={onDone}
      >
        {t('dashboard.globalFilters.done', { defaultValue: 'Done' })}
      </Button>
    </div>
  );
}
