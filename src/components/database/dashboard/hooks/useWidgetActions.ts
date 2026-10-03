import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  duplicateDashboardWidget,
  moveDashboardWidget,
  removeDashboardWidget,
} from '@/application/database-yjs/dashboard-layout';
import { Log } from '@/utils/log';

import { useDashboardHost, useDashboardUi } from '../DashboardUiContext';
import { canDuplicateWidget, getWidgetMoveTargets, WidgetMoveDirection } from '../widget-moves';
import { WidgetActions } from '../WidgetContext';

interface UseWidgetActionsOptions {
  widgetId: string;
  viewId: string;
  databaseId: string;
  openSettings: () => void;
}

/**
 * What a widget's options menu does (`WidgetActions`). What the menu can do
 * is computed by the menu while it is open, so the actions never change with
 * the layout.
 */
export function useWidgetActions({ widgetId, viewId, databaseId, openSettings }: UseWidgetActionsOptions): WidgetActions {
  const { t } = useTranslation();
  const { navigateToView, getViewIdFromDatabaseId } = useDashboardHost();
  const { openPicker, showLimitMessage, getRows, updateRows } = useDashboardUi();

  // The view, else the page of its database. The user chose "Open view": a
  // navigation that got nowhere says so.
  const openView = useCallback(async () => {
    if (!navigateToView) return;

    try {
      await navigateToView(viewId);
      return;
    } catch (error) {
      Log.warn('[Dashboard] failed to open the widget view, opening its database instead', error);
    }

    try {
      const fallbackViewId = await getViewIdFromDatabaseId?.(databaseId);

      if (fallbackViewId) {
        await navigateToView(fallbackViewId);
        return;
      }

      Log.error('[Dashboard] the widget database has no page to open', { databaseId });
    } catch (error) {
      Log.error('[Dashboard] failed to open the widget database', error);
    }

    toast.error(t('dashboard.widget.openFailed', { defaultValue: 'Could not open the view' }));
  }, [databaseId, getViewIdFromDatabaseId, navigateToView, t, viewId]);

  return useMemo<WidgetActions>(
    () => ({
      open: () => void openView(),
      changeView: () => openPicker({ mode: 'replace', widgetId }),
      duplicate: () => {
        if (!canDuplicateWidget(getRows(), widgetId)) {
          showLimitMessage('dashboard');
          return;
        }

        updateRows((current) => duplicateDashboardWidget(current, widgetId));
      },
      remove: () => updateRows((current) => removeDashboardWidget(current, widgetId)),
      move: (direction: WidgetMoveDirection) =>
        updateRows((current) => {
          const placement = getWidgetMoveTargets(current, widgetId)[direction];

          return placement ? moveDashboardWidget(current, widgetId, placement) : current;
        }),
      openSettings,
    }),
    [getRows, openPicker, openSettings, openView, showLimitMessage, updateRows, widgetId]
  );
}
