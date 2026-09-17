import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { findDashboardWidget } from '@/application/database-yjs/dashboard-layout';
import { DatabaseViewLayout, UIVariant, ViewLayout } from '@/application/types';
import { ViewIcon } from '@/components/_shared/view-icon';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import { TabLabel, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/utils/errors';

import { WIDGET_PICKER_LAYOUTS } from './constants';
import { useDashboardContext, useDashboardSources } from './DashboardContext';
import { WidgetPickerRequest } from './DashboardUiContext';
import { CreateWidgetViewRequest } from './hooks/useCreateWidgetView';
import { useHostViews } from './hooks/useHostViews';
import { useWorkspaceDatabases } from './hooks/useWorkspaceDatabases';
import {
  buildWidgetPickerDatabases,
  buildWidgetPickerGroups,
  WidgetPickerDatabase,
  WidgetPickerGroup,
} from './picker-options';
import { databaseLayoutToViewLayout, getLayoutLabel } from './utils';

type PickerTab = 'existing' | 'new';

const OPTION_SELECTOR = '[data-picker-focusable="true"]:not([disabled])';

/** Arrow keys move focus between the picker's options. */
function moveFocus(container: HTMLElement | null, current: Element | null, step: 1 | -1) {
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(OPTION_SELECTOR));

  if (items.length === 0) return;
  const index = current ? items.indexOf(current as HTMLElement) : -1;
  const next = index === -1 ? (step === 1 ? 0 : items.length - 1) : (index + step + items.length) % items.length;

  items[next]?.focus();
}

interface WidgetPickerProps {
  request: WidgetPickerRequest | null;
  onClose: () => void;
  onPick: (viewId: string, databaseId: string) => void;
  /**
   * Create a view and place it for the open request. The caller adds the
   * widget and closes the picker itself, so the view is never left without
   * its widget; resolves `null` when nothing was created.
   */
  createView: (request: CreateWidgetViewRequest) => Promise<string | null>;
  canCreateInOtherDatabases: boolean;
}

/**
 * Chooses the view a widget shows: an existing view of any database, or a new
 * view created on the spot. Also used by "Change view" (replace mode). While a
 * new view is being created the picker cannot be dismissed and offers no other
 * choice.
 */
export function WidgetPicker({ request, onClose, onPick, createView, canCreateInOtherDatabases }: WidgetPickerProps) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={request !== null}
    >
      {request ? (
        <WidgetPickerContent
          canCreateInOtherDatabases={canCreateInOtherDatabases}
          createView={createView}
          onPick={onPick}
          request={request}
        />
      ) : null}
    </Dialog>
  );
}

function WidgetPickerContent({
  request,
  onPick,
  createView,
  canCreateInOtherDatabases,
}: Omit<WidgetPickerProps, 'request' | 'onClose'> & { request: WidgetPickerRequest }) {
  const { t } = useTranslation();
  const hostContext = useDatabaseContext();
  const database = useDatabase();
  const { hostDatabaseId, dashboardViewId, hostViewIds, rows } = useDashboardContext();
  const { sourceNames } = useDashboardSources();
  const [tab, setTab] = useState<PickerTab>('existing');
  const [query, setQuery] = useState('');
  const [selectedDatabaseId, setSelectedDatabaseId] = useState(hostDatabaseId);
  const [creatingLayout, setCreatingLayout] = useState<DatabaseViewLayout | null>(null);
  const mountedRef = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const isPublish = hostContext.variant === UIVariant.Publish;
  const hostViews = useHostViews(database);
  const { databases: catalog, loading, error } = useWorkspaceDatabases(hostContext.workspaceId, !isPublish);
  const canCreate = Boolean(hostContext.createDatabaseView);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const currentViewId =
    request.mode === 'replace' ? findDashboardWidget(rows, request.widgetId)?.widget.viewId : undefined;
  const hostDatabaseName = sourceNames[hostDatabaseId] ?? '';

  const fallbackName = (layout: ViewLayout) => {
    const label = getLayoutLabel(layout);

    return t(label.key, { defaultValue: label.defaultValue });
  };

  const groups = buildWidgetPickerGroups({
    hostDatabaseId,
    hostDatabaseName,
    hostViews,
    hostTabViewIds: hostViewIds,
    catalog,
    excludeViewIds: [dashboardViewId],
    query,
    fallbackName,
  });

  const databases = useMemo(() => {
    const all = buildWidgetPickerDatabases({
      hostDatabaseId,
      hostDatabaseName,
      hostPrimaryViewId: hostContext.activeViewId,
      catalog: canCreateInOtherDatabases ? catalog : [],
    });
    const normalizedQuery = query.trim().toLowerCase();

    return normalizedQuery
      ? all.filter((entry) => entry.isHost || entry.name.toLowerCase().includes(normalizedQuery))
      : all;
  }, [canCreateInOtherDatabases, catalog, hostContext.activeViewId, hostDatabaseId, hostDatabaseName, query]);

  const selectedDatabase: WidgetPickerDatabase =
    databases.find((entry) => entry.databaseId === selectedDatabaseId) ?? databases[0];

  const creating = creatingLayout !== null;

  const handleCreate = async (layout: DatabaseViewLayout) => {
    if (creating || !selectedDatabase) return;
    setCreatingLayout(layout);

    try {
      await createView({
        databaseId: selectedDatabase.databaseId,
        primaryViewId: selectedDatabase.primaryViewId,
        isHost: selectedDatabase.isHost,
        layout,
        name: fallbackName(databaseLayoutToViewLayout(layout)),
      });
    } catch (createError) {
      toast.error(
        getErrorMessage(createError, t('dashboard.picker.createFailed', { defaultValue: 'Could not create the view' }))
      );
    } finally {
      if (mountedRef.current) setCreatingLayout(null);
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    moveFocus(listRef.current, document.activeElement, event.key === 'ArrowDown' ? 1 : -1);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (creating) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(listRef.current, null, 1);
      return;
    }

    if (event.key === 'Enter' && tab === 'existing') {
      const first = groups[0]?.options[0];

      if (first) {
        event.preventDefault();
        onPick(first.viewId, first.databaseId);
      }
    }
  };

  const title =
    request.mode === 'replace'
      ? t('dashboard.picker.changeViewTitle', { defaultValue: 'Change view' })
      : t('dashboard.picker.title', { defaultValue: 'Add widget' });

  const renderGroup = (group: WidgetPickerGroup, showOtherHeading: boolean) => (
    <div data-database-id={group.databaseId} data-testid='dashboard-widget-picker-group' key={group.databaseId}>
      {showOtherHeading ? (
        <div className='mt-2 px-2 py-1 text-xs font-semibold uppercase text-text-tertiary'>
          {t('dashboard.picker.otherDatabases', { defaultValue: 'Other databases' })}
        </div>
      ) : null}
      <div className='flex items-center gap-1 px-2 py-1 text-xs font-medium text-text-tertiary'>
        <span className='truncate'>
          {group.isHost
            ? t('dashboard.picker.thisDatabase', { defaultValue: 'This database' })
            : group.name || t('untitled')}
        </span>
        {group.isHost && group.name ? <span className='truncate text-text-quaternary'>· {group.name}</span> : null}
      </div>
      {group.options.map((option) => {
        const selected = option.viewId === currentViewId;
        const label = getLayoutLabel(option.layout);

        return (
          <button
            aria-pressed={selected}
            className={cn(
              'flex w-full items-center gap-2 rounded-300 px-2 py-1.5 text-left text-sm text-text-primary outline-none',
              'hover:bg-fill-content-hover focus-visible:bg-fill-content-hover',
              'disabled:cursor-not-allowed disabled:opacity-60',
              selected && 'bg-fill-theme-select'
            )}
            data-database-id={option.databaseId}
            data-picker-focusable='true'
            data-testid='dashboard-widget-picker-option'
            data-view-id={option.viewId}
            disabled={creating}
            key={option.viewId}
            onClick={() => onPick(option.viewId, option.databaseId)}
            type='button'
          >
            <PageIcon className='!h-5 !w-5 shrink-0' iconSize={16} view={{ icon: option.icon, layout: option.layout }} />
            <span className='min-w-0 flex-1 truncate'>{option.name}</span>
            <span className='shrink-0 text-xs text-text-tertiary'>
              {t(label.key, { defaultValue: label.defaultValue })}
            </span>
          </button>
        );
      })}
    </div>
  );

  const firstOtherIndex = groups.findIndex((group) => !group.isHost);

  // Closing mid-creation would leave the new view without its widget.
  const keepOpenWhileCreating = (event: Event) => {
    if (creating) event.preventDefault();
  };

  return (
    <DialogContent
      aria-busy={creating || undefined}
      aria-describedby={undefined}
      className='flex max-h-[80vh] flex-col gap-3'
      closeLabel={t('button.close', { defaultValue: 'Close' })}
      data-creating={creating ? 'true' : undefined}
      data-mode={request.mode}
      data-testid='dashboard-widget-picker'
      onEscapeKeyDown={keepOpenWhileCreating}
      onInteractOutside={keepOpenWhileCreating}
      onKeyDown={(event) => event.stopPropagation()}
      showCloseButton={!creating}
      size='md'
    >
      <DialogHeader className='mb-0'>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <SearchInput
        autoFocus
        data-testid='dashboard-widget-picker-search'
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleSearchKeyDown}
        placeholder={t('dashboard.picker.search', { defaultValue: 'Search views' })}
        value={query}
      />
      <Tabs className='min-h-0 flex-1' onValueChange={(value) => setTab(value as PickerTab)} value={tab}>
        <TabsList className='w-full justify-start border-b border-border-primary'>
          <TabsTrigger data-testid='dashboard-widget-picker-existing' value='existing'>
            <TabLabel>{t('dashboard.picker.existing', { defaultValue: 'Existing views' })}</TabLabel>
          </TabsTrigger>
          <TabsTrigger data-testid='dashboard-widget-picker-new-view' disabled={!canCreate} value='new'>
            <TabLabel>{t('dashboard.picker.newView', { defaultValue: 'New view' })}</TabLabel>
          </TabsTrigger>
        </TabsList>

        <TabsContent className='min-h-0' value='existing'>
          <div
            className='flex max-h-[min(420px,50vh)] flex-col overflow-y-auto pr-1'
            data-testid='dashboard-widget-picker-list'
            onKeyDown={handleListKeyDown}
            ref={tab === 'existing' ? listRef : undefined}
            role='listbox'
          >
            {groups.map((group, index) => renderGroup(group, index === firstOtherIndex))}
            {loading ? (
              <div className='flex items-center justify-center py-3'>
                <Progress variant='inherit' />
              </div>
            ) : null}
            {!loading && groups.length === 0 ? (
              <div
                className='px-2 py-6 text-center text-sm text-text-tertiary'
                data-testid='dashboard-widget-picker-empty'
              >
                {t('dashboard.picker.noResults', { defaultValue: 'No views found' })}
              </div>
            ) : null}
            {error && !loading ? (
              <div className='px-2 py-1 text-xs text-text-error'>
                {t('dashboard.picker.loadFailed', { defaultValue: 'Could not load databases' })}
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent className='min-h-0' value='new'>
          <div className='flex flex-col gap-3' onKeyDown={handleListKeyDown} ref={tab === 'new' ? listRef : undefined}>
            <div className='flex flex-col gap-1'>
              <div className='px-2 text-xs font-medium text-text-tertiary'>
                {t('dashboard.picker.selectDatabase', { defaultValue: 'Choose a database' })}
              </div>
              <div className='flex max-h-[160px] flex-col overflow-y-auto pr-1' role='radiogroup'>
                {databases.map((entry) => {
                  const selected = entry.databaseId === selectedDatabase?.databaseId;

                  return (
                    <button
                      aria-checked={selected}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-300 px-2 py-1.5 text-left text-sm text-text-primary outline-none',
                        'hover:bg-fill-content-hover focus-visible:bg-fill-content-hover',
                        selected && 'bg-fill-theme-select'
                      )}
                      data-database-id={entry.databaseId}
                      data-picker-focusable='true'
                      data-selected={selected ? 'true' : 'false'}
                      data-testid='dashboard-widget-picker-database'
                      disabled={creating}
                      key={entry.databaseId}
                      onClick={() => setSelectedDatabaseId(entry.databaseId)}
                      role='radio'
                      type='button'
                    >
                      <ViewIcon layout={ViewLayout.Grid} size='small' />
                      <span className='min-w-0 flex-1 truncate'>
                        {entry.isHost
                          ? t('dashboard.picker.thisDatabase', { defaultValue: 'This database' })
                          : entry.name || t('untitled')}
                      </span>
                      {entry.isHost && entry.name ? (
                        <span className='shrink-0 truncate text-xs text-text-tertiary'>{entry.name}</span>
                      ) : null}
                    </button>
                  );
                })}
                {loading && canCreateInOtherDatabases ? (
                  <div className='flex items-center justify-center py-2'>
                    <Progress variant='inherit' />
                  </div>
                ) : null}
              </div>
            </div>
            <div className='flex flex-col gap-2'>
              <div className='px-2 text-xs font-medium text-text-tertiary'>
                {t('dashboard.picker.createIn', {
                  name: selectedDatabase?.isHost
                    ? t('dashboard.picker.thisDatabase', { defaultValue: 'This database' })
                    : selectedDatabase?.name || t('untitled'),
                  defaultValue: 'Create a new view in {{name}}',
                })}
              </div>
              <div className='grid grid-cols-4 gap-2 max-sm:grid-cols-2'>
                {WIDGET_PICKER_LAYOUTS.map((layout) => {
                  const viewLayout = databaseLayoutToViewLayout(layout);
                  const label = getLayoutLabel(viewLayout);
                  const creatingThis = creatingLayout === layout;

                  return (
                    <button
                      aria-busy={creatingThis || undefined}
                      className={cn(
                        'flex h-20 flex-col items-center justify-center gap-1.5 rounded-400 border border-border-primary text-sm text-text-primary outline-none transition-colors',
                        'hover:border-border-theme-thick hover:bg-fill-content-hover focus-visible:border-border-theme-thick',
                        'disabled:cursor-not-allowed disabled:opacity-60'
                      )}
                      data-layout={layout}
                      data-picker-focusable='true'
                      data-testid='dashboard-widget-picker-layout-option'
                      disabled={creating || !selectedDatabase}
                      key={layout}
                      onClick={() => void handleCreate(layout)}
                      type='button'
                    >
                      {creatingThis ? <Progress variant='inherit' /> : <ViewIcon layout={viewLayout} size='medium' />}
                      <span>{t(label.key, { defaultValue: label.defaultValue })}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}

export default WidgetPicker;
