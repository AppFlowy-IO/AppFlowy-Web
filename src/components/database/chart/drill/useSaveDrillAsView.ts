import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import * as Y from 'yjs';

import { useDatabaseContext, useSharedRoot } from '@/application/database-yjs/context';
import { plainToYCondition } from '@/application/database-yjs/dashboard-private';
import type { DashboardExtraFilter } from '@/application/database-yjs/dashboard.type';
import {
  cloneDatabaseViewConfigurationValue,
  createDatabaseViewInDoc,
  getDatabaseFromDoc,
} from '@/application/database-yjs/database-view-doc-ops';
import { mergeFiltersForSave, SavedFilterNode, toSavedFilterNodes } from '@/application/database-yjs/drill-query';
import { executeDatabaseOperations as executeOperations } from '@/application/database-yjs/history';
import { removeCreatedDatabaseView } from '@/application/database-yjs/list-layout';
import { getOverlayTarget } from '@/application/database-yjs/view-conditions-overlay';
import { DatabaseViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { Log } from '@/utils/log';

function plainList(view: YDatabaseView, key: YjsDatabaseKey.filters | YjsDatabaseKey.sorts): SavedFilterNode[] {
  return (((view as unknown as Y.Map<unknown>).get(key) as Y.Array<unknown> | undefined)?.toJSON() ??
    []) as SavedFilterNode[];
}

function yList(nodes: readonly SavedFilterNode[]) {
  const array = new Y.Array<unknown>();

  array.push(nodes.map(plainToYCondition));
  return array;
}

export interface SaveDrillAsViewInput {
  /** The drill session's view: its filters and sorts are the widget's plus the drill-local ones. */
  drillView: YDatabaseView | undefined;
  /** The widget's resolved global filters. */
  globals: readonly DashboardExtraFilter[];
  /** The category filters. */
  categoryNodes: readonly DashboardExtraFilter[];
  /** The source database's container view, the new tab's parent; the widget's view when unknown. */
  containerViewId: string | null;
  /** Closes the drill-down before the new view opens. */
  onClose: () => void;
}

/**
 * "Save as view…" (WP13 §3.7): a non-owned Grid tab of the source database
 * with the drill's filters (merged with the global and category filters,
 * which get fresh ids), its sorts, and the chart view's field order and field
 * settings; search is not saved. A failed write removes the created view and
 * shows the error toast. On success the drill-down closes and the view opens.
 * Resolves to the new view id, or `null` after a failure.
 */
export function useSaveDrillAsView({
  drillView,
  globals,
  categoryNodes,
  containerViewId,
  onClose,
}: SaveDrillAsViewInput) {
  const { t } = useTranslation();
  const context = useDatabaseContext();
  const sharedRoot = useSharedRoot();

  return useCallback(
    async (name: string): Promise<string | null> => {
      const { databaseDoc, deletePage, navigateToView } = context;

      if (!drillView) return null;
      const chartView = getOverlayTarget(drillView);
      const parentViewId = containerViewId ?? context.databasePageId;
      let viewId: string | null = null;

      try {
        // A normal tab of the source database: no owner, not embedded.
        viewId = await createDatabaseViewInDoc(
          {
            databaseDoc,
            databasePageId: parentViewId,
            activeViewId: parentViewId,
            createDatabaseView: context.createDatabaseView,
            deletePage: context.deletePage,
            loadViewMeta: context.loadViewMeta,
            updatePage: context.updatePage,
            loadView: context.loadView,
            bindViewSync: context.bindViewSync,
            scheduleDeferredCleanup: context.scheduleDeferredCleanup,
            readOnly: context.readOnly,
            canWrite: context.canWrite,
            isDocumentBlock: false,
          },
          DatabaseViewLayout.Grid,
          name,
          { requireExactCreatedView: true }
        );
        const createdViewId = viewId;
        const filters = mergeFiltersForSave(
          plainList(drillView, YjsDatabaseKey.filters),
          toSavedFilterNodes([...globals, ...categoryNodes])
        );
        const sorts = plainList(drillView, YjsDatabaseKey.sorts);
        const fieldOrders = chartView.get(YjsDatabaseKey.field_orders);
        const fieldSettings = chartView.get(YjsDatabaseKey.field_settings);

        // One write, kept out of the undo history like the other created-tab writes.
        executeOperations(
          sharedRoot,
          [
            () => {
              const target = getDatabaseFromDoc(databaseDoc)?.get(YjsDatabaseKey.views)?.get(createdViewId);

              if (!target) throw new Error('The created view is missing');
              target.set(YjsDatabaseKey.filters, yList(filters));
              target.set(YjsDatabaseKey.sorts, yList(sorts));
              if (fieldOrders) target.set(YjsDatabaseKey.field_orders, cloneDatabaseViewConfigurationValue(fieldOrders));
              if (fieldSettings) {
                target.set(YjsDatabaseKey.field_settings, cloneDatabaseViewConfigurationValue(fieldSettings));
              }
            },
          ],
          'saveDrillAsView',
          { type: 'database.saveDrillAsView', policy: 'skip' }
        );
      } catch (error) {
        Log.warn('[ChartDrill] Save as view failed', { viewId, error });
        if (viewId) {
          removeCreatedDatabaseView(databaseDoc, viewId);
          try {
            await deletePage?.(viewId);
          } catch (deleteError) {
            Log.warn('[ChartDrill] failed to remove a partially saved view', { viewId, error: deleteError });
          }
        }

        toast.error(t('dashboard.picker.createFailed', { defaultValue: 'Could not create the view' }));
        return null;
      }

      onClose();
      void navigateToView?.(viewId);
      return viewId;
    },
    [categoryNodes, containerViewId, context, drillView, globals, onClose, sharedRoot, t]
  );
}
