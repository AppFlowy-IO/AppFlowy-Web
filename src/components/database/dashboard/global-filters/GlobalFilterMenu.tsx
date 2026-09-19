import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { ReactComponent as ArrowLeftSvg } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { useDashboardSources } from '@/components/database/dashboard/DashboardContext';
import { Button } from '@/components/ui/button';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { getFieldTypeName, Translate } from './global-filter.conditions';
import {
  countSourcesByFieldType,
  createGlobalFilter,
  getAvailableFieldTypes,
  GlobalFilterSource,
} from './global-filter.utils';
import { GlobalFilterEditor } from './GlobalFilterEditor';
import { useDashboardFilterSources, useGlobalFilterActions } from './useGlobalFilterActions';
import { useGlobalFilterLabel } from './useGlobalFilterLabel';

type MenuScreen = { type: 'list' } | { type: 'pick' } | { type: 'edit'; filterId: string };

function sourcesText(t: Translate, count: number) {
  return t('dashboard.globalFilters.sources', {
    count,
    defaultValue: '{{count}} sources',
    defaultValue_one: '{{count}} source',
    defaultValue_other: '{{count}} sources',
  });
}

function FilterListItem({
  filter,
  sources,
  onOpen,
}: {
  filter: DashboardGlobalFilter;
  sources: GlobalFilterSource[];
  onOpen: () => void;
}) {
  const { text, active, sourceLabel } = useGlobalFilterLabel(filter, sources);

  return (
    <button
      type='button'
      data-testid='dashboard-global-filter-item'
      data-filter-id={filter.id}
      data-active={active}
      className={cn(dropdownMenuItemVariants({ variant: 'default' }), 'w-full text-left')}
      onClick={onOpen}
    >
      <FieldTypeIcon type={filter.fieldType} className='text-icon-secondary' />
      <span className={cn('min-w-0 flex-1 truncate', active && 'text-text-action')}>{text}</span>
      <span className='shrink-0 text-xs text-text-tertiary'>{sourceLabel}</span>
    </button>
  );
}

function PropertyTypePicker({
  types,
  sourceCountByType,
  onSelect,
  onBack,
}: {
  types: FieldType[];
  sourceCountByType: ReadonlyMap<FieldType, number>;
  onSelect: (type: FieldType) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col gap-1' data-testid='dashboard-global-filter-property-picker'>
      <div className='flex items-center gap-1 pb-1'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={t('button.back', { defaultValue: 'Back' })}
          data-testid='dashboard-global-filter-back'
          onClick={onBack}
        >
          <ArrowLeftSvg className='h-4 w-4' />
        </Button>
        <span className='text-xs font-medium text-text-tertiary'>
          {t('dashboard.globalFilters.property', { defaultValue: 'Property' })}
        </span>
      </div>
      {types.length === 0 ? (
        <p className='px-2 py-2 text-sm text-text-tertiary'>
          {t('dashboard.globalFilters.noTargets', { defaultValue: 'No widgets have a property of this type' })}
        </p>
      ) : (
        <div className='appflowy-scroller flex max-h-[320px] flex-col overflow-y-auto'>
          {types.map((type) => (
            <button
              type='button'
              key={type}
              data-testid='dashboard-global-filter-property-option'
              data-field-type={type}
              className={cn(dropdownMenuItemVariants({ variant: 'default' }), 'w-full text-left')}
              onClick={() => onSelect(type)}
            >
              <FieldTypeIcon type={type} className='text-icon-secondary' />
              <span className='min-w-0 flex-1 truncate'>{getFieldTypeName(type, t)}</span>
              <span className='shrink-0 text-xs text-text-tertiary'>
                {sourcesText(t, sourceCountByType.get(type) ?? 0)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface GlobalFilterMenuProps {
  /** Open straight into this filter's editor (chip click); leaving closes the menu. */
  filterId?: string;
  /** Open straight into the property-type picker; leaving closes the menu. */
  startWithPicker?: boolean;
  onClose: () => void;
}

/**
 * "Filter multiple sources": the list of dashboard filters, the property-type
 * picker for a new one, and the editor of one filter. The editor's Done
 * finishes editing and closes the menu; its back arrow (shown when the editor
 * was reached from the list) returns to the list.
 */
export function GlobalFilterMenu({ filterId, startWithPicker = false, onClose }: GlobalFilterMenuProps) {
  const { t } = useTranslation();
  const { sourceNames } = useDashboardSources();
  const sources = useDashboardFilterSources();
  const { filters, persist, addFilter, updateFilter, deleteFilter } = useGlobalFilterActions();
  const [screen, setScreen] = useState<MenuScreen>(() => {
    if (filterId) return { type: 'edit', filterId };
    return startWithPicker ? { type: 'pick' } : { type: 'list' };
  });
  const closeOnLeave = Boolean(filterId) || startWithPicker;
  const editing = screen.type === 'edit' ? filters.find((filter) => filter.id === screen.filterId) : undefined;
  const missing = screen.type === 'edit' && !editing;
  const sourceCountByType = useMemo(() => countSourcesByFieldType(sources), [sources]);
  const availableTypes = useMemo(
    () => getAvailableFieldTypes(sources, sourceCountByType),
    [sources, sourceCountByType]
  );

  const leave = useCallback(() => {
    if (closeOnLeave) {
      onClose();
      return;
    }

    setScreen({ type: 'list' });
  }, [closeOnLeave, onClose]);

  // The filter was deleted (here or by a collaborator). Returning to the list
  // is decided while rendering, so no empty editor frame is painted.
  if (missing && !closeOnLeave) setScreen({ type: 'list' });

  // A menu opened on that filter closes instead (a side effect on the parent).
  useEffect(() => {
    if (missing && closeOnLeave) onClose();
  }, [closeOnLeave, missing, onClose]);

  const handleAdd = useCallback(
    (type: FieldType) => {
      const filter = createGlobalFilter(sources, type, getFieldTypeName(type, t));

      addFilter(filter);
      setScreen({ type: 'edit', filterId: filter.id });
    },
    [addFilter, sources, t]
  );

  const handleChange = useCallback(
    (updater: (filter: DashboardGlobalFilter) => DashboardGlobalFilter) => {
      if (screen.type !== 'edit') return;
      updateFilter(screen.filterId, updater);
    },
    [screen, updateFilter]
  );

  const handleDelete = useCallback(() => {
    if (screen.type !== 'edit') return;
    deleteFilter(screen.filterId);
    leave();
  }, [deleteFilter, leave, screen]);

  let body: ReactNode;

  if (screen.type === 'pick') {
    body = (
      <PropertyTypePicker
        types={availableTypes}
        sourceCountByType={sourceCountByType}
        onSelect={handleAdd}
        onBack={leave}
      />
    );
  } else if (screen.type === 'edit') {
    body = editing ? (
      <GlobalFilterEditor
        key={editing.id}
        filter={editing}
        sources={sources}
        sourceNames={sourceNames}
        onChange={handleChange}
        onDelete={handleDelete}
        onDone={onClose}
        onBack={closeOnLeave ? undefined : leave}
      />
    ) : null;
  } else {
    body = (
      <div className='flex flex-col gap-1'>
        <div className='px-1 pb-1'>
          <div className='text-sm font-medium text-text-primary'>
            {t('dashboard.globalFilters.title', { defaultValue: 'Filter multiple sources' })}
          </div>
          {!persist && (
            <div className='text-xs text-text-tertiary' data-testid='dashboard-global-filter-menu-local-hint'>
              {t('dashboard.globalFilters.localChanges', { defaultValue: 'Only you see these filter changes' })}
            </div>
          )}
        </div>
        {filters.map((filter) => (
          <FilterListItem
            key={filter.id}
            filter={filter}
            sources={sources}
            onOpen={() => setScreen({ type: 'edit', filterId: filter.id })}
          />
        ))}
        <button
          type='button'
          data-testid='dashboard-global-filter-add'
          disabled={availableTypes.length === 0}
          className={cn(
            dropdownMenuItemVariants({ variant: 'default' }),
            'w-full text-left text-text-secondary disabled:cursor-not-allowed disabled:text-text-tertiary'
          )}
          onClick={() => setScreen({ type: 'pick' })}
        >
          <PlusIcon className='text-icon-secondary' />
          {t('dashboard.globalFilters.add', { defaultValue: 'Add global filter' })}
        </button>
      </div>
    );
  }

  return (
    <div
      className='flex flex-col p-2'
      data-testid='dashboard-global-filter-menu'
      data-screen={screen.type}
      data-persist={persist}
    >
      {body}
    </div>
  );
}

export default GlobalFilterMenu;
