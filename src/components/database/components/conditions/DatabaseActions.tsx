import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useDatabaseContext,
  useDatabaseViewLayout,
  useConditionsReadOnly,
  useFiltersSelector,
  useReadOnly,
  useSortsSelector,
} from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as WidgetSettingsIcon } from '@/assets/icons/controller.svg';
import { ReactComponent as ExpandMoreIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import FiltersButton, {
  preventWidgetToolFocusTooltip,
} from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';
import Settings from '@/components/database/components/settings/Settings';
import { DatabaseTemplateButton } from '@/components/database/components/template';
import {
  getDashboardWidgetTools,
  WIDGET_TOOL_CAPS,
  WidgetTool,
  widgetToolsContainerClass,
  widgetToolSlotClass,
} from '@/components/database/dashboard/widget-tools';
import { useWidgetContextOptional, WidgetContextValue } from '@/components/database/dashboard/WidgetContext';
import { useOpenDatabaseAsPage } from '@/components/database/hooks';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Only dashboards render it, so its global filter editor stays out of every
// other view's bundle.
const DashboardActions = lazy(() => import('@/components/database/dashboard/DashboardActions'));

/** Layouts whose toolbar offers sorting. */
const SORTABLE_LAYOUTS = new Set<DatabaseViewLayout>([
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Gallery,
  DatabaseViewLayout.Feed,
  DatabaseViewLayout.Timeline,
]);

/** Layouts whose toolbar offers the template button. */
const TEMPLATE_LAYOUTS = new Set<DatabaseViewLayout>([
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.Board,
  DatabaseViewLayout.Calendar,
  DatabaseViewLayout.Chart,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Gallery,
  DatabaseViewLayout.Feed,
  DatabaseViewLayout.Timeline,
]);

function DatabaseSearchAction() {
  const { t } = useTranslation();
  const { query, setQuery } = useDatabaseSearch();
  const [expanded, setExpanded] = useState(() => Boolean(query));
  const [inputValue, setInputValue] = useState(query);

  useEffect(() => {
    if (!expanded) return;

    const timeout = window.setTimeout(() => setQuery(inputValue.trim()), 200);

    return () => window.clearTimeout(timeout);
  }, [expanded, inputValue, setQuery]);

  const closeSearch = () => {
    setInputValue('');
    setQuery('');
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={t('search.label')}
            data-testid='database-actions-search'
            onClick={() => setExpanded(true)}
            size='icon-sm'
            type='button'
            variant='ghost'
          >
            <SearchIcon aria-hidden='true' className='h-5 w-5' />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('search.label')}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      className='flex h-6 w-[200px] items-center gap-1 rounded-300 border border-border-primary bg-fill-content px-1.5 transition-[width,opacity] duration-150 motion-reduce:transition-none'
      data-testid='database-actions-search-field'
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !inputValue.trim()) {
          closeSearch();
        }
      }}
      role='search'
    >
      <SearchIcon aria-hidden='true' className='h-4 w-4 shrink-0 text-icon-secondary' />
      <input
        aria-label={t('search.label')}
        autoFocus
        className='h-full min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary'
        data-testid='database-actions-search-input'
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;

          event.preventDefault();
          event.stopPropagation();
          closeSearch();
        }}
        placeholder={t('gallery.searchPlaceholder')}
        enterKeyHint='search'
        type='text'
        value={inputValue}
      />
      {inputValue ? (
        <Button
          aria-label={t('button.clear')}
          className='h-5 w-5 rounded-200 p-0 text-icon-secondary'
          data-testid='database-actions-search-clear'
          onClick={closeSearch}
          size='icon-sm'
          type='button'
          variant='ghost'
        >
          <CloseIcon aria-hidden='true' className='h-3.5 w-3.5' />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The tools of a dashboard widget's header (`getDashboardWidgetTools`): Filter
 * and Sort open popovers, and Edit mode adds Settings, which opens the
 * widget's settings host. Hidden tools keep their slot and stay focusable;
 * they show on hover, on focus, while a popover or the menu is open, in Edit
 * mode, and an active filter or sort always shows (in accent).
 */
function DashboardWidgetTools({ widget, layout }: { widget: WidgetContextValue; layout: DatabaseViewLayout }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const conditionsReadOnly = useConditionsReadOnly();
  const conditionsContext = useConditionsContext();
  const filters = useFiltersSelector();
  const sorts = useSortsSelector();
  const tools = getDashboardWidgetTools({
    layout,
    editing: widget.editing,
    canWrite: !readOnly,
    canEditConditions: !conditionsReadOnly,
    caps: WIDGET_TOOL_CAPS,
  });
  const settingsLabel = t('dashboard.widget.settings', { defaultValue: 'Settings' });
  const isActive = (tool: WidgetTool) =>
    (tool === 'filter' && filters.length > 0) || (tool === 'sort' && sorts.length > 0);

  if (tools.length === 0) return null;

  return (
    <div
      className={cn('group/tools flex items-center gap-0.5', widgetToolsContainerClass())}
      data-dashboard-widget='true'
      data-force-visible={widget.editing || widget.menuOpen || widget.settingsOpen ? 'true' : 'false'}
      data-has-active={tools.some(isActive) ? 'true' : 'false'}
      data-parity-id='dash-widget-tools'
      data-testid='database-actions'
    >
      {tools.map((tool) => (
        <div
          className={widgetToolSlotClass()}
          data-active={isActive(tool) ? 'true' : 'false'}
          data-widget-tool={tool}
          key={tool}
        >
          {tool === 'filter' ? (
            <FiltersButton {...conditionsContext} editing={widget.editing} presentation='popover' variant='widget' />
          ) : tool === 'sort' ? (
            <SortsButton {...conditionsContext} editing={widget.editing} presentation='popover' variant='widget' />
          ) : tool === 'settings' ? (
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild onFocus={preventWidgetToolFocusTooltip}>
                <Button
                  aria-label={settingsLabel}
                  className='!rounded-200 text-dash-edit-icon data-[state=open]:bg-dash-hover-fill [&_svg]:h-4 [&_svg]:w-4'
                  data-parity-id='dash-widget-tool-settings'
                  data-state={widget.settingsOpen ? 'open' : 'closed'}
                  data-testid='dashboard-widget-settings-button'
                  onClick={(event) => {
                    event.stopPropagation();
                    if (widget.settingsOpen) widget.setSettingsOpen(false);
                    else widget.actions.openSettings();
                  }}
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                >
                  <WidgetSettingsIcon aria-hidden='true' data-parity-id='dash-widget-tool-settings__icon' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{settingsLabel}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function DatabaseActions() {
  const { t } = useTranslation();

  const layout = useDatabaseViewLayout() as DatabaseViewLayout;
  const readOnly = useReadOnly();
  // Filters and sorts stay usable in a View-mode dashboard widget (local to the viewer).
  const conditionsReadOnly = useConditionsReadOnly();
  const conditionsContext = useConditionsContext();
  const { activeViewId, isDocumentBlock, databasePageId, isDashboardWidget } = useDatabaseContext();
  const { canOpen, isOpening, openDatabaseAsPage } = useOpenDatabaseAsPage({ fallbackViewId: databasePageId });
  const widget = useWidgetContextOptional();

  // The dashboard's own toolbar (`DashboardActions`): global filters, Open as
  // full page, Settings and Edit / Done replace the view conditions. A
  // mobile context is view-only, so that toolbar offers no Settings there
  // (layout conversion and the display settings only edit).
  const isDashboard = layout === DatabaseViewLayout.Dashboard && !isDashboardWidget;

  if (isDashboard) {
    return (
      <div className='flex min-w-fit items-center justify-end gap-1' data-testid='database-actions'>
        <Suspense fallback={null}>
          <DashboardActions />
        </Suspense>
      </div>
    );
  }

  // A dashboard widget's header shows the widget tools instead of the toolbar.
  if (isDashboardWidget && widget) return <DashboardWidgetTools layout={layout} widget={widget} />;

  const showSettings = !readOnly;
  const showSorts = SORTABLE_LAYOUTS.has(layout);
  const supportsSearch = layout === DatabaseViewLayout.Gallery || layout === DatabaseViewLayout.Feed;
  // A widget header has no room for the search field or the template button.
  const showSearch = supportsSearch && !isDashboardWidget;
  const showTemplates = !isDashboardWidget && TEMPLATE_LAYOUTS.has(layout);
  const compact = showSearch || Boolean(isDashboardWidget);
  const settingsButton = (
    <Button
      aria-label={t('settings.title')}
      data-testid='database-actions-settings'
      size={compact ? 'icon-sm' : 'icon'}
      type='button'
      variant='ghost'
    >
      <SettingsIcon aria-hidden='true' className='h-5 w-5' />
    </Button>
  );

  if (readOnly && conditionsReadOnly && !isDocumentBlock && !showSearch) return null;

  return (
    <div
      className={`flex min-w-fit items-center justify-end ${compact ? 'gap-0.5' : 'gap-1.5'}`}
      data-dashboard-widget={isDashboardWidget ? 'true' : undefined}
      data-testid='database-actions'
    >
      {!conditionsReadOnly ? <FiltersButton {...conditionsContext} compact={compact} /> : null}
      {!conditionsReadOnly && showSorts ? <SortsButton {...conditionsContext} compact={compact} /> : null}
      {/* A widget never offers its own page: its menu does ("View data source"). */}
      {isDocumentBlock && !isDashboardWidget && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('tooltip.openAsPage')}
              data-testid='database-actions-open-as-page'
              disabled={!canOpen}
              loading={isOpening}
              onClick={() => void openDatabaseAsPage()}
              size={compact ? 'icon-sm' : 'icon'}
              type='button'
              variant='ghost'
            >
              <ExpandMoreIcon aria-hidden='true' className='h-5 w-5' />
            </Button>
          </TooltipTrigger>

          <TooltipContent>{t('tooltip.openAsPage')}</TooltipContent>
        </Tooltip>
      )}
      {showSearch ? <DatabaseSearchAction key={activeViewId} /> : null}
      {showSettings ? (
        layout === DatabaseViewLayout.Gallery ? (
          <Settings layout={layout}>{settingsButton}</Settings>
        ) : (
          <Settings layout={layout}>
            <Tooltip>
              <TooltipTrigger asChild>{settingsButton}</TooltipTrigger>
              <TooltipContent>{t('settings.title')}</TooltipContent>
            </Tooltip>
          </Settings>
        )
      ) : null}
      {!readOnly && showTemplates ? (
        <div className={showSearch ? 'ml-1' : undefined}>
          <DatabaseTemplateButton compact={showSearch} />
        </div>
      ) : null}
    </div>
  );
}

export default DatabaseActions;
