import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useDatabaseContext,
  useDatabaseViewLayout,
  useConditionsReadOnly,
  useReadOnly,
} from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as ExpandMoreIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { DatabaseSearchAction } from '@/components/database/components/conditions/DatabaseSearchAction';
import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';
import Settings from '@/components/database/components/settings/Settings';
import { DatabaseTemplateButton } from '@/components/database/components/template';
import { getDashboardWidgetTools, WidgetTool } from '@/components/database/dashboard/widget-tools';
import { useOpenDatabaseAsPage } from '@/components/database/hooks';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export { DatabaseSearchAction } from '@/components/database/components/conditions/DatabaseSearchAction';

// Only dashboards render it, so its global filter editor stays out of every
// other view's bundle.
const DashboardActions = lazy(() => import('@/components/database/dashboard/DashboardActions'));

/** Layouts that search cards (not rows); their toolbar keeps its compact size. */
const CARD_SEARCH_LAYOUTS = new Set<DatabaseViewLayout>([DatabaseViewLayout.Gallery, DatabaseViewLayout.Feed]);

/**
 * The actions beside a database's tabs, the toolbar of its view: Filter and
 * Sort (they reveal the conditions bar), "Open as page" for a database
 * embedded in a document, Search for the layouts that consume it, Settings
 * and the template button. A dashboard swaps in its own toolbar
 * (`DashboardActions`). A dashboard widget has no tabs: its header renders
 * the widget's tools (`WidgetActions`) in place of this.
 */
export function DatabaseActions() {
  const { t } = useTranslation();

  // Null until the view's layout is read.
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

  // One resolver for the standalone toolbar and the widget header (WP09 §1.1):
  // Filter, Sort, Search, Settings and New for writers, Search for readers.
  // Until the layout is read, only Filter (it needs no layout).
  const tools: WidgetTool[] =
    layout === null
      ? conditionsReadOnly
        ? []
        : ['filter']
      : getDashboardWidgetTools({
          layout,
          editing: false,
          canWrite: !readOnly,
          canEditConditions: !conditionsReadOnly,
          context: 'standalone',
        });
  const has = (tool: WidgetTool) => tools.includes(tool);
  const compact = layout !== null && CARD_SEARCH_LAYOUTS.has(layout);
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

  if (tools.length === 0 && !isDocumentBlock) return null;

  return (
    <div
      className={`flex min-w-fit items-center justify-end ${compact ? 'gap-0.5' : 'gap-1.5'}`}
      data-testid='database-actions'
    >
      {has('filter') ? <FiltersButton compact={compact} /> : null}
      {has('sort') ? <SortsButton compact={compact} /> : null}
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
      {has('search') ? <DatabaseSearchAction compact={compact} key={activeViewId} /> : null}
      {has('settings') && layout !== null ? (
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
      {has('new') ? (
        <div className={compact ? 'ml-1' : undefined}>
          <DatabaseTemplateButton variant={compact ? 'compact' : 'default'} />
        </div>
      ) : null}
    </div>
  );
}

export default DatabaseActions;
