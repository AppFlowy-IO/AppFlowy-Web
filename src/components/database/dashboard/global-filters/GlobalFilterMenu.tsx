import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as ArrowLeftSvg } from '@/assets/icons/alt_arrow_left.svg';
import { getFieldTypeName } from '@/components/database/components/field/FieldLabel';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { useDashboardSources } from '@/components/database/dashboard/DashboardContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { MergedSelection } from './global-filter.options';
import {
  GlobalFilterMenuEntry,
  GlobalFilterMenuScreen,
  globalFilterSheetBackTarget,
  initialGlobalFilterScreen,
} from './global-filter.screens';
import { GlobalFilterSource, GlobalFilterSourceField } from './global-filter.utils';
import { GlobalFilterBuilder, GlobalFilterMultiIntro } from './GlobalFilterMultiSources';
import { GLOBAL_FILTER_ROW_CLASS, GlobalFilterPicker } from './GlobalFilterPicker';
import { GlobalFilterPillEditor } from './GlobalFilterPillEditor';
import { requestGlobalFilterEditor } from './pendingEditorStore';
import { GlobalFilterActions, useDashboardFilterSources, useGlobalFilterActions } from './useGlobalFilterActions';
import { useGlobalFilterLabel } from './useGlobalFilterLabel';

export type { GlobalFilterMenuEntry, GlobalFilterMenuScreen } from './global-filter.screens';

type FilterUpdater = (filter: DashboardGlobalFilter) => DashboardGlobalFilter;

/** Where the menu renders: a desktop popover, or a phone's bottom sheet (WP14 §1.4.2). */
export type GlobalFilterMenuVariant = 'popover' | 'sheet';

export interface GlobalFilterMenuProps {
  entry: GlobalFilterMenuEntry;
  /** The pill's filter (entry `pill`). */
  filterId?: string;
  onClose: () => void;
  /** `sheet`: pushed screens go back through the sheet's header, so the menu draws no back row. */
  variant?: GlobalFilterMenuVariant;
  /**
   * The screen, when the popover holds it (a phone sheet's header then draws
   * its back chevron from `globalFilterSheetBackTarget`); both or neither.
   * Without them the menu holds the screen itself.
   */
  screen?: GlobalFilterMenuScreen;
  onScreenChange?: (screen: GlobalFilterMenuScreen) => void;
  /** Sheet only, while the menu holds the screen: the back action of the current screen, `null` on a first screen. */
  onSheetBackChange?: (onBack: (() => void) | null) => void;
}

/** A reader's list of the dashboard's filters: one row per filter, worded like its pill. */
function ReaderFilterItem({
  filter,
  sources,
  onOpen,
}: {
  filter: DashboardGlobalFilter;
  sources: GlobalFilterSource[];
  onOpen: () => void;
}) {
  const { text, active } = useGlobalFilterLabel(filter, sources);

  return (
    <button
      className={GLOBAL_FILTER_ROW_CLASS}
      data-active={false}
      data-filter-active={active}
      data-filter-id={filter.id}
      data-testid='dashboard-global-filter-reader-item'
      onClick={onOpen}
      type='button'
    >
      <FieldTypeIcon className='h-4 w-4 shrink-0 text-icon-secondary' type={filter.fieldType} />
      <span className={cn('min-w-0 flex-1 truncate', active && 'text-text-action')}>{text}</span>
    </button>
  );
}

function BackHeader({ onBack, children }: { onBack: () => void; children?: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className='flex items-center gap-1 px-1 pt-1'>
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
      {children}
    </div>
  );
}

interface FilterScreenProps {
  filter: DashboardGlobalFilter;
  sources: GlobalFilterSource[];
  actions: GlobalFilterActions;
  setScreen: (screen: GlobalFilterMenuScreen) => void;
}

/**
 * The builder of one filter (screen `builder`). Its callbacks follow the
 * filter's id, not the filter, so the memoized name input and target rows
 * keep their props while the filter is edited.
 */
function BuilderScreen({
  filter,
  sources,
  sourceNames,
  actions,
  showBack,
  onDone,
  setScreen,
}: FilterScreenProps & {
  sourceNames: Record<string, string>;
  /** A back arrow to the pill's editor (a popover opened from a pill; a sheet's header has its own). */
  showBack: boolean;
  onDone: (filterId: string) => void;
}) {
  const { id } = filter;
  const { removeTarget, updateFilterStructure } = actions;
  const handleAddAnother = useCallback(() => setScreen({ type: 'add-another', filterId: id }), [id, setScreen]);
  const handleBack = useCallback(() => setScreen({ type: 'pill', filterId: id }), [id, setScreen]);
  const handleDone = useCallback(() => onDone(id), [id, onDone]);
  const handleRemoveTarget = useCallback(
    (databaseId: string) => removeTarget(id, sources, databaseId),
    [id, removeTarget, sources]
  );
  const handleRename = useCallback(
    (updater: FilterUpdater) => updateFilterStructure(id, updater),
    [id, updateFilterStructure]
  );

  return (
    <GlobalFilterBuilder
      filter={filter}
      onAddAnother={handleAddAnother}
      onBack={showBack ? handleBack : undefined}
      onDone={handleDone}
      onRemoveTarget={handleRemoveTarget}
      onRename={handleRename}
      sourceNames={sourceNames}
      sources={sources}
    />
  );
}

/** A pill's editor (screen `pill`): callbacks keyed on the filter's id, so the memoized editor re-renders with its filter only. */
function PillScreen({
  filter,
  sources,
  actions,
  canEdit,
  onClose,
  setScreen,
}: FilterScreenProps & { canEdit: boolean; onClose: () => void }) {
  const { id } = filter;
  const { deleteFilter, setFilterValue, setSelection } = actions;
  const handleDelete = useCallback(() => {
    deleteFilter(id);
    onClose();
  }, [deleteFilter, id, onClose]);
  const handleOpenBuilder = useCallback(() => setScreen({ type: 'builder', filterId: id }), [id, setScreen]);
  const handleSelectionChange = useCallback(
    (selection: MergedSelection) => setSelection(id, selection),
    [id, setSelection]
  );
  const handleValueChange = useCallback((updater: FilterUpdater) => setFilterValue(id, updater), [id, setFilterValue]);

  return (
    <GlobalFilterPillEditor
      canEditStructure={canEdit}
      filter={filter}
      onDelete={handleDelete}
      onOpenBuilder={handleOpenBuilder}
      onSelectionChange={handleSelectionChange}
      onValueChange={handleValueChange}
      sources={sources}
    />
  );
}

/**
 * The dashboard's global filter menu, one state machine for every entry
 * point (WP08 §1.2–1.6): the property-first picker (writers), the reader's
 * filter list, "Filter multiple sources" (intro, grouped picker, builder,
 * add another) and a pill's editor. A pick from the picker closes the menu
 * and opens the new pill's editor; a filter deleted underneath closes the
 * screens that show it. In a phone sheet (`variant='sheet'`) the screens push
 * inside the sheet and go back through its header; the intro, pushed from the
 * picker there, goes back to it too.
 */
export function GlobalFilterMenu({
  entry,
  filterId,
  onClose,
  variant = 'popover',
  screen: controlledScreen,
  onScreenChange,
  onSheetBackChange,
}: GlobalFilterMenuProps) {
  const { t } = useTranslation();
  const { sourceNames } = useDashboardSources();
  const sources = useDashboardFilterSources();
  const actions = useGlobalFilterActions();
  const { filters, canEdit, pickProperty, createFromMultiPicker, setTarget } = actions;
  const [ownScreen, setOwnScreen] = useState<GlobalFilterMenuScreen>(() =>
    initialGlobalFilterScreen(entry, filterId, canEdit)
  );
  const screen = controlledScreen ?? ownScreen;
  const setScreen = useCallback(
    (next: GlobalFilterMenuScreen) => (onScreenChange ?? setOwnScreen)(next),
    [onScreenChange]
  );
  const screenFilterId = 'filterId' in screen ? screen.filterId : undefined;
  const current = useMemo(
    () => (screenFilterId ? filters.find((filter) => filter.id === screenFilterId) : undefined),
    [filters, screenFilterId]
  );
  // Only a filter this menu has shown can go missing (a new one appears with the same write).
  const seenRef = useRef<string | null>(null);

  if (current) seenRef.current = current.id;
  const missing = screenFilterId !== undefined && !current && seenRef.current === screenFilterId;

  // The filter was deleted (here or by a collaborator): its screen closes.
  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);

  const typeNameOf = useCallback((field: GlobalFilterSourceField) => getFieldTypeName(field.type, t), [t]);
  const inSheet = variant === 'sheet';
  // While the menu holds the screen, a sheet's header learns its back action
  // through an effect; a popover that holds the screen computes it itself.
  const reportsSheetBack = inSheet && controlledScreen === undefined;
  const sheetBack = useMemo(() => {
    if (!reportsSheetBack) return null;
    const target = globalFilterSheetBackTarget(screen, entry, canEdit);

    return target ? () => setScreen(target) : null;
  }, [canEdit, entry, reportsSheetBack, screen, setScreen]);

  useEffect(() => {
    if (!reportsSheetBack) return;
    onSheetBackChange?.(sheetBack);
  }, [onSheetBackChange, reportsSheetBack, sheetBack]);
  useEffect(
    () => () => {
      onSheetBackChange?.(null);
    },
    [onSheetBackChange]
  );

  const handlePick = useCallback(
    (databaseId: string, field: GlobalFilterSourceField) => {
      onClose();
      pickProperty(databaseId, field, typeNameOf(field));
    },
    [onClose, pickProperty, typeNameOf]
  );

  const handleMultiPick = useCallback(
    (databaseId: string, field: GlobalFilterSourceField) => {
      const id = createFromMultiPicker(databaseId, field, typeNameOf(field));

      if (id) setScreen({ type: 'builder', filterId: id });
    },
    [createFromMultiPicker, setScreen, typeNameOf]
  );

  const openPill = useCallback(
    (id: string) => {
      if (entry === 'pill' && id === filterId) {
        setScreen({ type: 'pill', filterId: id });
        return;
      }

      onClose();
      requestGlobalFilterEditor(id);
    },
    [entry, filterId, onClose, setScreen]
  );

  let body: ReactNode = null;

  switch (screen.type) {
    case 'picker':
      body = (
        <GlobalFilterPicker
          mode='toolbar'
          onMultipleSources={() => setScreen({ type: 'multi-intro' })}
          onPick={handlePick}
        />
      );
      break;
    case 'reader-list':
      body = (
        <div className='flex flex-col p-1'>
          {filters.map((filter) => (
            <ReaderFilterItem filter={filter} key={filter.id} onOpen={() => openPill(filter.id)} sources={sources} />
          ))}
        </div>
      );
      break;
    case 'multi-intro':
      body = (
        <GlobalFilterMultiIntro
          onAdd={() => setScreen({ type: 'multi-picker' })}
          onClose={onClose}
          showClose={!inSheet}
        />
      );
      break;
    case 'multi-picker':
      body = (
        <>
          {inSheet ? null : <BackHeader onBack={() => setScreen({ type: 'multi-intro' })} />}
          <GlobalFilterPicker mode='multi' onPick={handleMultiPick} />
        </>
      );
      break;
    case 'builder':
      body = current ? (
        <BuilderScreen
          actions={actions}
          filter={current}
          onDone={openPill}
          setScreen={setScreen}
          showBack={entry === 'pill' && !inSheet}
          sourceNames={sourceNames}
          sources={sources}
        />
      ) : null;
      break;
    case 'add-another':
      body = current ? (
        <>
          {inSheet ? null : <BackHeader onBack={() => setScreen({ type: 'builder', filterId: current.id })} />}
          <GlobalFilterPicker
            excludeDatabaseIds={Object.keys(current.targets)}
            fieldType={current.fieldType}
            mode='add-another'
            onPick={(databaseId, field) => {
              setTarget(current.id, sources, databaseId, field.id);
              setScreen({ type: 'builder', filterId: current.id });
            }}
          />
        </>
      ) : null;
      break;
    case 'pill':
      body = current ? (
        <PillScreen
          actions={actions}
          canEdit={canEdit}
          filter={current}
          key={current.id}
          onClose={onClose}
          setScreen={setScreen}
          sources={sources}
        />
      ) : null;
      break;
  }

  return (
    <div
      className='flex flex-col'
      data-entry={entry}
      data-persist={actions.persist}
      data-screen={screen.type}
      data-testid='dashboard-global-filter-menu'
      data-variant={variant}
    >
      {body}
    </div>
  );
}

export default GlobalFilterMenu;
