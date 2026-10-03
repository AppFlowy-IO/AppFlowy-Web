import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useDatabaseContext,
  useDatabaseViewLayout,
  useConditionsReadOnly,
  useReadOnly,
} from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ExpandMoreIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';
import Settings from '@/components/database/components/settings/Settings';
import { DatabaseTemplateButton } from '@/components/database/components/template';
import { WidgetTools } from '@/components/database/dashboard/widget-tool-buttons/WidgetTools';
import { SORTABLE_LAYOUTS } from '@/components/database/dashboard/widget-tools';
import { useOpenDatabaseAsPage } from '@/components/database/hooks';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Only dashboards render it, so its global filter editor stays out of every
// other view's bundle.
const DashboardActions = lazy(() => import('@/components/database/dashboard/DashboardActions'));

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
 * The toolbar of a database view: Filter and Sort (they reveal the conditions
 * bar), "Open as page" for a database embedded in a document, Search for the
 * layouts that consume it, Settings and the template button. A dashboard
 * swaps in its own toolbar (`DashboardActions`).
 */
function DatabaseToolbar() {
  const { t } = useTranslation();

  // Null until the view's layout is read: the plain toolbar, without Sort, Search or templates.
  const layout = useDatabaseViewLayout();
  const readOnly = useReadOnly();
  const conditionsReadOnly = useConditionsReadOnly();
  const { activeViewId, isDocumentBlock, databasePageId } = useDatabaseContext();
  const { canOpen, isOpening, openDatabaseAsPage } = useOpenDatabaseAsPage({ fallbackViewId: databasePageId });

  // The dashboard's own toolbar (`DashboardActions`): global filters, Open as
  // full page, Settings and Edit / Done replace the view conditions. A
  // mobile context is view-only, so that toolbar offers no Settings there
  // (layout conversion and the display settings only edit). It gets the
  // database as primitives, so the host's row changes do not re-render it.
  if (layout === DatabaseViewLayout.Dashboard) {
    return (
      <div className='flex min-w-fit items-center justify-end gap-1' data-testid='database-actions'>
        <Suspense fallback={null}>
          <DashboardActions
            activeViewId={activeViewId}
            databasePageId={databasePageId}
            isDocumentBlock={Boolean(isDocumentBlock)}
            readOnly={readOnly}
          />
        </Suspense>
      </div>
    );
  }

  // `Settings` renders nothing for a layout it does not know yet.
  const showSettings = !readOnly && layout !== null;
  const showSorts = layout !== null && SORTABLE_LAYOUTS.has(layout);
  const showSearch = layout === DatabaseViewLayout.Gallery || layout === DatabaseViewLayout.Feed;
  const showTemplates = layout !== null && TEMPLATE_LAYOUTS.has(layout);
  const compact = showSearch;
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
      data-testid='database-actions'
    >
      {!conditionsReadOnly ? <FiltersButton compact={compact} /> : null}
      {!conditionsReadOnly && showSorts ? <SortsButton compact={compact} /> : null}
      {isDocumentBlock && (
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

/**
 * The actions beside a database's tabs. Inside a dashboard widget, whose
 * header (`WidgetHeader`) renders them in place of the tab bar, they are the
 * widget's tools (`WidgetTools`) instead of the toolbar.
 */
export function DatabaseActions() {
  const { isDashboardWidget } = useDatabaseContext();

  return isDashboardWidget ? <WidgetTools /> : <DatabaseToolbar />;
}

export default DatabaseActions;
