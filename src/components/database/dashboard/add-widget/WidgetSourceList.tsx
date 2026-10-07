import { KeyboardEvent, memo, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { ViewIcon } from '@/components/_shared/view-icon';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { DASHBOARD_MOTION_FAST_CLASS } from '../constants';
import { databaseLayoutToViewLayout } from '../utils';

import { PickerNewViewRow, PickerViewGroup, WidgetPickerOption } from './picker-sections';
import { WidgetPickerListState } from './useWidgetPickerSections';

/** Picker rows the arrow keys move between (disabled rows are skipped). */
export const PICKER_ROW_SELECTOR = '[data-picker-focusable="true"]:not([aria-disabled="true"])';

/** Arrow keys move the focus across every enabled row of every section, wrapping around. */
export function movePickerFocus(container: HTMLElement | null, current: Element | null, step: 1 | -1) {
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(PICKER_ROW_SELECTOR));

  if (items.length === 0) return;
  const index = current ? items.indexOf(current as HTMLElement) : -1;
  const next = index === -1 ? (step === 1 ? 0 : items.length - 1) : (index + step + items.length) % items.length;

  items[next]?.focus();
}

/** Visual parity ids of the New view rows (`dashboard-parity/visual-metrics.json`). */
export const LAYOUT_ROW_PARITY_SLUGS: Partial<Record<DatabaseViewLayout, string>> = {
  [DatabaseViewLayout.Grid]: 'grid',
  [DatabaseViewLayout.Board]: 'board',
  [DatabaseViewLayout.Gallery]: 'gallery',
  [DatabaseViewLayout.List]: 'list',
  [DatabaseViewLayout.Chart]: 'chart',
  [DatabaseViewLayout.Timeline]: 'timeline',
  [DatabaseViewLayout.Feed]: 'feed',
  [DatabaseViewLayout.Calendar]: 'calendar',
};

const ROW_CLASS = cn(
  'flex h-7 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-left text-sm leading-5 text-text-primary outline-none',
  'hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill aria-disabled:cursor-default aria-disabled:opacity-60 aria-disabled:hover:bg-transparent',
  'transition-colors',
  DASHBOARD_MOTION_FAST_CLASS
);
const SECTION_TITLE_CLASS = 'px-2 pb-1 pt-2 text-xs font-medium leading-4 text-dash-title';

interface RowProps {
  disabled: boolean;
  onActivate: () => void;
  children: ReactNode;
  testId: string;
  className?: string;
  attrs?: Record<string, string | undefined>;
}

function PickerRow({ disabled, onActivate, children, testId, className, attrs }: RowProps) {
  return (
    <button
      aria-disabled={disabled || undefined}
      className={cn(ROW_CLASS, className)}
      data-picker-focusable='true'
      data-testid={testId}
      onClick={() => {
        if (!disabled) onActivate();
      }}
      type='button'
      {...attrs}
    >
      {children}
    </button>
  );
}

interface GroupRowsProps {
  group: PickerViewGroup;
  disabled: boolean;
  currentViewId?: string;
  onPickExisting: (viewId: string, databaseId: string) => void;
  onShowAll: (databaseId: string) => void;
}

function OptionRow({
  option,
  disabled,
  selected,
  onPickExisting,
}: {
  option: WidgetPickerOption;
  disabled: boolean;
  selected: boolean;
  onPickExisting: (viewId: string, databaseId: string) => void;
}) {
  return (
    <PickerRow
      attrs={{
        'data-view-id': option.viewId,
        'data-database-id': option.databaseId,
        'aria-pressed': selected ? 'true' : undefined,
      }}
      disabled={disabled}
      onActivate={() => onPickExisting(option.viewId, option.databaseId)}
      testId='dashboard-widget-picker-option'
    >
      <PageIcon
        className='!h-4 !w-4 shrink-0 text-xs leading-4'
        iconSize={16}
        view={{ icon: option.icon, layout: option.layout }}
      />
      <span className='min-w-0 flex-1 truncate'>{option.name}</span>
      {selected ? <CheckIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-dash-accent' /> : null}
    </PickerRow>
  );
}

function GroupRows({ group, disabled, currentViewId, onPickExisting, onShowAll }: GroupRowsProps) {
  const { t } = useTranslation();

  return (
    <>
      {group.options.map((option) => (
        <OptionRow
          disabled={disabled}
          key={option.viewId}
          onPickExisting={onPickExisting}
          option={option}
          selected={option.viewId === currentViewId}
        />
      ))}
      {group.more > 0 ? (
        <PickerRow
          attrs={{ 'data-database-id': group.databaseId }}
          className='text-text-secondary'
          disabled={false}
          onActivate={() => onShowAll(group.databaseId)}
          testId='dashboard-widget-picker-show-more'
        >
          <MoreIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-dash-tool-icon' />
          <span className='truncate'>
            {t('dashboard.picker.showMore', { count: group.more, defaultValue: 'Show {{count}} more' })}
          </span>
        </PickerRow>
      ) : null}
    </>
  );
}

function LayoutRow({
  row,
  label,
  disabled,
  disabledReason,
  onPickLayout,
}: {
  row: PickerNewViewRow;
  label: string;
  disabled: boolean;
  disabledReason?: string;
  onPickLayout: (layout: DatabaseViewLayout) => void;
}) {
  const slug = LAYOUT_ROW_PARITY_SLUGS[row.layout];
  const button = (
    <PickerRow
      attrs={{
        'data-layout': String(row.layout),
        'data-parity-id': slug ? `dash-widget-picker-layout-${slug}` : undefined,
      }}
      disabled={disabled || row.disabled}
      onActivate={() => onPickLayout(row.layout)}
      testId='dashboard-widget-picker-layout-option'
    >
      <span className='flex h-full min-w-0 flex-1 items-center gap-2' data-parity-id='dash-widget-picker-layout'>
        <span
          className='flex h-4 w-4 shrink-0 items-center justify-center'
          data-parity-id={slug ? `dash-widget-picker-layout-${slug}__icon` : undefined}
        >
          <ViewIcon
            className='h-4 w-4 text-dash-tool-icon'
            data-parity-id='dash-widget-picker-layout__icon'
            layout={databaseLayoutToViewLayout(row.layout)}
            size='unset'
          />
        </span>
        <span className='truncate'>{label}</span>
      </span>
    </PickerRow>
  );

  if (!row.disabled || !disabledReason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side='right'>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

export interface WidgetSourceListProps {
  mode: 'add' | 'replace';
  /** `useWidgetPickerSections().list`: without the query as typed, so a keystroke renders the list once. */
  list: WidgetPickerListState;
  /** Rows are shown but not selectable (the default view is being created). */
  disabled: boolean;
  /** Replace mode: the widget's current view (checked). */
  currentViewId?: string;
  onPickExisting: (viewId: string, databaseId: string) => void;
  /** Add mode: a New view type row. */
  onPickLayout?: (layout: DatabaseViewLayout) => void;
  /** Add mode: "New view in {database}". */
  onNewInDatabase?: (databaseId: string, name: string) => void;
  listRef: RefObject<HTMLDivElement>;
}

/**
 * The picker's sections (WP06 §1.4): "Views on {database}" (first 5, then
 * "Show {n} more"), "Other data sources ›" (the other databases by group,
 * loaded when opened or searched) and, in add mode, the "New view" types.
 * The Source panel (replace mode) lists the same views without New view.
 */
export const WidgetSourceList = memo(function WidgetSourceList({
  mode,
  list,
  disabled,
  currentViewId,
  onPickExisting,
  onPickLayout,
  onNewInDatabase,
  listRef,
}: WidgetSourceListProps) {
  const { t } = useTranslation();
  const { sections, catalogLoading, catalogFailed, primaryDatabaseName, layoutLabel } = list;
  const { host, other, newView } = sections;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    movePickerFocus(listRef.current, document.activeElement, event.key === 'ArrowDown' ? 1 : -1);
  };

  return (
    <div
      className='flex min-h-0 flex-1 flex-col overflow-y-auto'
      data-testid='dashboard-widget-picker-list'
      onKeyDown={handleKeyDown}
      ref={listRef}
      role='listbox'
    >
      {host ? (
        <div className='flex flex-col' data-section='host' data-testid='dashboard-widget-picker-section'>
          <div className={SECTION_TITLE_CLASS} data-testid='dashboard-widget-picker-section-title'>
            {primaryDatabaseName
              ? t('dashboard.picker.viewsOn', { database: primaryDatabaseName, defaultValue: 'Views on {{database}}' })
              : t('dashboard.picker.viewsOnThisDatabase', { defaultValue: 'Views on this database' })}
          </div>
          <GroupRows
            currentViewId={currentViewId}
            disabled={disabled}
            group={host}
            onPickExisting={onPickExisting}
            onShowAll={list.showAll}
          />
        </div>
      ) : null}

      <div className='flex flex-col' data-section='other' data-testid='dashboard-widget-picker-section'>
        {other.expanded ? (
          <>
            <div className={SECTION_TITLE_CLASS} data-testid='dashboard-widget-picker-section-title'>
              {t('dashboard.picker.otherSources', { defaultValue: 'Other data sources' })}
            </div>
            {other.groups.map((group) => (
              <div
                // Off-screen groups skip layout and paint until scrolled to.
                className='flex flex-col [contain-intrinsic-size:auto_160px] [content-visibility:auto]'
                data-database-id={group.databaseId}
                data-testid='dashboard-widget-picker-group'
                key={group.databaseId}
              >
                <div className='truncate px-2 pb-1 pt-1.5 text-xs font-medium leading-4 text-dash-title'>
                  {group.name || t('untitled')}
                </div>
                <GroupRows
                  currentViewId={currentViewId}
                  disabled={disabled}
                  group={group}
                  onPickExisting={onPickExisting}
                  onShowAll={list.showAll}
                />
                {group.newInDatabase && onNewInDatabase ? (
                  <PickerRow
                    attrs={{ 'data-database-id': group.databaseId }}
                    className='text-text-secondary'
                    disabled={disabled}
                    onActivate={() => onNewInDatabase(group.databaseId, group.name)}
                    testId='dashboard-widget-picker-new-in-database'
                  >
                    <PlusIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-dash-tool-icon' />
                    <span className='truncate'>
                      {t('dashboard.picker.newViewIn', {
                        database: group.name || t('untitled'),
                        defaultValue: 'New view in {{database}}',
                      })}
                    </span>
                  </PickerRow>
                ) : null}
              </div>
            ))}
            {catalogLoading ? (
              <div className='flex items-center justify-center py-2' data-testid='dashboard-widget-picker-loading'>
                <Progress variant='inherit' />
              </div>
            ) : null}
            {catalogFailed ? (
              <div className='px-2 py-1 text-xs text-text-error' data-testid='dashboard-widget-picker-load-failed'>
                {t('dashboard.picker.loadFailed', { defaultValue: 'Could not load databases' })}
              </div>
            ) : null}
          </>
        ) : (
          <PickerRow
            attrs={{ 'aria-expanded': 'false' }}
            disabled={false}
            onActivate={list.expandOther}
            testId='dashboard-widget-picker-other-sources'
          >
            <span className='min-w-0 flex-1 truncate'>
              {t('dashboard.picker.otherSources', { defaultValue: 'Other data sources' })}
            </span>
            <ChevronRightIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-tertiary' />
          </PickerRow>
        )}
      </div>

      {mode === 'add' && newView.length > 0 && onPickLayout ? (
        <div className='flex flex-col' data-section='new' data-testid='dashboard-widget-picker-section'>
          <div className={SECTION_TITLE_CLASS} data-testid='dashboard-widget-picker-section-title'>
            {t('dashboard.picker.newView', { defaultValue: 'New view' })}
          </div>
          {newView.map((row) => (
            <LayoutRow
              disabled={disabled}
              disabledReason={
                row.layout === DatabaseViewLayout.Timeline
                  ? list.timelineDisabledReason
                  : row.layout === DatabaseViewLayout.Chart
                  ? list.chartDisabledReason
                  : undefined
              }
              key={row.layout}
              label={layoutLabel(row.layout)}
              onPickLayout={onPickLayout}
              row={row}
            />
          ))}
        </div>
      ) : null}

      {sections.noResults && !catalogLoading ? (
        <div className='px-2 py-6 text-center text-sm text-text-tertiary' data-testid='dashboard-widget-picker-empty'>
          {t('dashboard.picker.noResults', { defaultValue: 'No views found' })}
        </div>
      ) : null}
    </div>
  );
});

export default WidgetSourceList;
