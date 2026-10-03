import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { ReactComponent as ArrowLeftSvg } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { getFieldTypeName } from '@/components/database/components/field/FieldLabel';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { filterValueItemClassName as itemClassName } from '@/components/database/components/filters/value-controls/filter-value-item';
import { useDashboardSources } from '@/components/database/dashboard/DashboardContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  countSourcesByFieldType,
  createGlobalFilter,
  getAvailableFieldTypes,
  GlobalFilterSource,
} from './global-filter.utils';
import { GlobalFilterEditor } from './GlobalFilterEditor';
import { useDashboardFilterSources, useGlobalFilterActions } from './useGlobalFilterActions';
import { globalFilterSourcesText, useGlobalFilterLabel } from './useGlobalFilterLabel';

/** A screen of the menu: the filter list, the property-type picker for a new filter, or one filter's editor. */
export type GlobalFilterMenuScreen = { type: 'list' } | { type: 'pick' } | { type: 'edit'; filterId: string };

const LIST_SCREEN: GlobalFilterMenuScreen = { type: 'list' };
const addItemClassName = cn(
  itemClassName,
  'text-text-secondary disabled:cursor-not-allowed disabled:text-text-tertiary'
);

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
      className={itemClassName}
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
          data-parity-id='dash-global-filter-back'
          data-testid='dashboard-global-filter-back'
          onClick={onBack}
        >
          <ArrowLeftSvg className='h-4 w-4' data-parity-id='dash-global-filter-back__icon' />
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
              className={itemClassName}
              onClick={() => onSelect(type)}
            >
              <FieldTypeIcon type={type} className='text-icon-secondary' />
              <span className='min-w-0 flex-1 truncate'>{getFieldTypeName(type, t)}</span>
              <span className='shrink-0 text-xs text-text-tertiary'>
                {globalFilterSourcesText(t, sourceCountByType.get(type) ?? 0)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface GlobalFilterMenuProps {
  /**
   * The screen the menu opens on (default: the filter list). A menu opened
   * straight on a filter's editor (a chip click) or on the property-type
   * picker closes when that screen is left, instead of showing the list.
   */
  initialScreen?: GlobalFilterMenuScreen;
  onClose: () => void;
}

/**
 * "Filter multiple sources": the list of dashboard filters, the property-type
 * picker for a new one, and the editor of one filter. The editor's Done
 * finishes editing and closes the menu; its back arrow (shown when the editor
 * was reached from the list) returns to the list.
 */
export function GlobalFilterMenu({ initialScreen = LIST_SCREEN, onClose }: GlobalFilterMenuProps) {
  const { t } = useTranslation();
  const { sourceNames } = useDashboardSources();
  const sources = useDashboardFilterSources();
  const { filters, persist, addFilter, updateFilter, deleteFilter } = useGlobalFilterActions();
  const [screen, setScreen] = useState(initialScreen);
  // Fixed for the life of the menu, like the screen it opened on.
  const [closeOnLeave] = useState(initialScreen.type !== 'list');
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

    setScreen(LIST_SCREEN);
  }, [closeOnLeave, onClose]);

  // The filter was deleted (here or by a collaborator). Returning to the list
  // is decided while rendering, so no empty editor frame is painted.
  if (missing && !closeOnLeave) setScreen(LIST_SCREEN);

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
          className={addItemClassName}
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
