import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as SettingsIcon } from '@/assets/icons/controller.svg';
import { ReactComponent as OpenAsPageIcon } from '@/assets/icons/full_screen.svg';
import { useMobileContext } from '@/components/_shared/hooks/useMobileContext';
import DashboardSettings from '@/components/database/components/settings/DashboardSettings';
import { useOpenDatabaseAsPage } from '@/components/database/hooks/useOpenDatabaseAsPage';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { useDashboardContextOptional } from './DashboardContext';
import { GlobalFilterButton } from './global-filters/GlobalFilterButton';

/** A 28×28 toolbar icon button: radius 6, padding 6, a 16px glyph in the tool icon color. */
const TOOLBAR_BUTTON_CLASS = 'h-7 w-7 !rounded-200 p-1.5 text-dash-tool-icon [&_svg]:h-4 [&_svg]:w-4';
/** Edit and Done: 28 tall, text 10px from each side, radius 6, 14/20 medium, text only. */
const TOOLBAR_TEXT_BUTTON_CLASS = 'h-7 !rounded-200 py-1 text-sm font-medium leading-5';
/** Done has no border. */
const DONE_BUTTON_CLASS = `${TOOLBAR_TEXT_BUTTON_CLASS} px-2.5`;
/** Edit's 1px outline plus 9px keeps its text 10px in, where Done's sits. */
const EDIT_BUTTON_CLASS = `${TOOLBAR_TEXT_BUTTON_CLASS} px-[9px]`;

/** Opens the dashboard view itself as a full page (shown only when the dashboard is embedded in a document). */
function OpenAsFullPageButton({ viewId, fallbackViewId }: { viewId: string; fallbackViewId?: string }) {
  const { t } = useTranslation();
  const { canOpen, isOpening, openDatabaseAsPage } = useOpenDatabaseAsPage({ viewId, fallbackViewId });
  const label = t('dashboard.toolbar.openAsFullPage', { defaultValue: 'Open as full page' });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={TOOLBAR_BUTTON_CLASS}
          data-parity-id='dash-toolbar-open-as-page'
          data-testid='dashboard-toolbar-open-as-page'
          disabled={!canOpen}
          loading={isOpening}
          onClick={() => void openDatabaseAsPage()}
          size='icon'
          type='button'
          variant='ghost'
        >
          <OpenAsPageIcon aria-hidden='true' data-parity-id='dash-toolbar-open-as-page__icon' />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The dashboard settings (layout, widget titles, icons in heading). */
function DashboardSettingsButton() {
  const { t } = useTranslation();
  const label = t('dashboard.toolbar.settings', { defaultValue: 'Settings' });

  return (
    <DashboardSettings>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            className={TOOLBAR_BUTTON_CLASS}
            data-parity-id='dash-toolbar-settings'
            data-testid='database-actions-settings'
            size='icon'
            type='button'
            variant='ghost'
          >
            <SettingsIcon aria-hidden='true' data-parity-id='dash-toolbar-settings__icon' />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </DashboardSettings>
  );
}

export interface DashboardActionsProps {
  /**
   * The host database's active view (the dashboard). Omitted outside a
   * database: Open as full page and Settings need one.
   */
  activeViewId?: string;
  /** The host database's page, the fallback Open as full page opens. */
  databasePageId?: string;
  /** The host database is read-only (the default): no Settings. */
  readOnly?: boolean;
  /** The dashboard is embedded in a document: Open as full page shows. */
  isDocumentBlock?: boolean;
}

/**
 * Dashboard toolbar in the database tab bar, always visible, left to right:
 * the global filter button (for everyone), "Open as full page" (only when the
 * dashboard is embedded in a document), Settings (writers) and the text-only
 * Edit / Done toggle (writers who can enter Edit mode). A mobile context is
 * view-only, so it shows the global filter button alone.
 *
 * The filter button and Edit / Done need the `DashboardProvider`; Open as full
 * page and Settings only need the host database, so they also render in the
 * one render in which the tab bar still reports the previous view's layout.
 * Without a dashboard and a database it renders nothing.
 *
 * Memoized: the toolbar that renders it (`DatabaseActions`) follows every
 * change of the host database context, so it hands the database over as
 * primitives and this only re-renders with them and `DashboardContext`.
 */
export const DashboardActions = memo(function DashboardActions({
  activeViewId,
  databasePageId,
  readOnly = true,
  isDocumentBlock = false,
}: DashboardActionsProps) {
  const { t } = useTranslation();
  const dashboard = useDashboardContextOptional();
  const viewportMobile = useMobileContext();
  const inDatabase = activeViewId !== undefined;

  if (!dashboard && !inDatabase) return null;
  const mobileContext = dashboard?.mobileContext ?? viewportMobile;

  if (mobileContext) {
    return (
      <div
        className='flex items-center gap-1'
        data-mobile='true'
        data-parity-id='dash-toolbar'
        data-testid='dashboard-actions'
      >
        <GlobalFilterButton />
      </div>
    );
  }

  return (
    <div className='flex items-center gap-1' data-parity-id='dash-toolbar' data-testid='dashboard-actions'>
      <GlobalFilterButton />
      {isDocumentBlock && inDatabase ? (
        <OpenAsFullPageButton fallbackViewId={databasePageId} viewId={activeViewId} />
      ) : null}
      {inDatabase && !readOnly ? <DashboardSettingsButton /> : null}
      {dashboard?.canEnterEdit ? (
        dashboard.isEditing ? (
          <Button
            className={DONE_BUTTON_CLASS}
            data-parity-id='dash-toolbar-done-button'
            data-testid='dashboard-done-button'
            onClick={() => dashboard.setEditing(false)}
            size='sm'
            type='button'
            variant='default'
          >
            <span data-parity-id='dash-toolbar-done-button__label'>{t('dashboard.done', { defaultValue: 'Done' })}</span>
          </Button>
        ) : (
          <Button
            className={EDIT_BUTTON_CLASS}
            data-parity-id='dash-toolbar-edit-button'
            data-testid='dashboard-edit-button'
            onClick={() => dashboard.setEditing(true)}
            size='sm'
            type='button'
            variant='outline'
          >
            <span data-parity-id='dash-toolbar-edit-button__label'>{t('dashboard.edit', { defaultValue: 'Edit' })}</span>
          </Button>
        )
      ) : null}
    </div>
  );
});

export default DashboardActions;
