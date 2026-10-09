import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  addDashboardWidget,
  canAddDashboardWidget,
  createDashboardWidget,
  generateDashboardId,
  replaceDashboardWidgetView,
} from '@/application/database-yjs/dashboard-layout';
import { renameDatabaseViewInDoc } from '@/application/database-yjs/dashboard-owned-view-ops';
import { nextViewName } from '@/application/database-yjs/dashboard-owned-views';
import {
  DASHBOARD_GRID_COLUMNS,
  DashboardRow,
  DashboardWidgetPlacement,
} from '@/application/database-yjs/dashboard.type';
import { getDatabaseFromDoc } from '@/application/database-yjs/database-view-doc-ops';
import { createDatabaseHistoryGroup, runDatabaseHistoryGroupForDatabase } from '@/application/database-yjs/history';
import {
  DatabaseViewLayout,
  Subscription,
  SubscriptionPlan,
  UpdatePagePayload,
  ViewLayout,
  YDoc,
  YjsDatabaseKey,
} from '@/application/types';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { getErrorMessage } from '@/utils/errors';
import { Log } from '@/utils/log';

import { dashboardFullAnnouncement, dashboardRowLimitAnnouncement } from '../DashboardFullTooltip';
import { DefaultWidgetPlanError, OwnedWidgetViews } from '../hooks/useOwnedWidgetViews';
import { resolveAddPlacement } from '../widget-moves';

import {
  AddWidgetFlowHandle,
  createAddWidgetFlowStore,
  createDockAnchorStore,
  createWidgetSettingsRequests,
  DashboardAddWidgetApi,
} from './add-widget-api';
import {
  AddWidgetFlowEffect,
  DEFAULT_WIDGET_NAMES,
  DefaultWidgetSpecKind,
  resolveDefaultWidgetSpec,
} from './add-widget-flow';
import { NEW_VIEW_LAYOUT_LABELS } from './picker-sections';

/** An unresolved plan after this long counts as "no Number chart" (WP06 §1.2). */
export const ADD_WIDGET_PLAN_TIMEOUT_MS = 1500;

/** What the flow does with its widget's own view while it is open (bound by `AddFlowViewBinding`). */
export interface AddFlowViewApi {
  viewId: string;
  /** `useUpdateDatabaseLayout(viewId)` with the history skipped. */
  switchLayout: (layout: DatabaseViewLayout) => Promise<void> | void;
}

export interface UseAddWidgetFlowOptions {
  hostDoc: YDoc;
  hostDatabaseId: string;
  canEnterEdit: boolean;
  /** Effective Edit mode (Edit preference applied to access and platform). */
  editing: boolean;
  canEdit: boolean;
  pinEditing: () => void;
  getRows: () => DashboardRow[];
  updateRows: (updater: (rows: DashboardRow[]) => DashboardRow[]) => boolean;
  ownedViews: OwnedWidgetViews;
  selectWidget: (widgetId: string | null) => void;
  announce: (message: string) => void;
  /** Bring a widget (or the pending slot) into view once it renders. */
  scrollToWidget: (widgetId: string) => void;
  openSourcePanel: (widgetId: string) => void;
  /** Warms the picker's code and catalog. */
  preloadPicker: () => void;
  workspaceId?: string;
  getSubscriptions?: () => Promise<Subscription[] | undefined>;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/**
 * Runs the add-widget flow (`reduceAddWidgetFlow`): resolves the default
 * widget spec at the click, creates the owned default view, inserts the
 * widget (one undo step), swaps it to a picked view, switches and renames its
 * own view for a type pick (not undo steps), and deletes a view that never
 * got its widget. Returns the dashboard's add-widget surface and the stable
 * `startAddWidget`.
 */
export function useAddWidgetFlow(options: UseAddWidgetFlowOptions): {
  api: DashboardAddWidgetApi;
  startAddWidget: (placement: DashboardWidgetPlacement) => void;
  bindFlowView: (api: AddFlowViewApi | null) => void;
} {
  const { t } = useTranslation();
  const latest = useRef({ ...options, t });

  latest.current = { ...options, t };
  const { loadSubscription } = useSubscriptionPlan(options.getSubscriptions, {
    cacheKey: options.workspaceId ? `dashboard-plan:${options.workspaceId}` : undefined,
    enabled: false,
  });
  const loadSubscriptionRef = useRef(loadSubscription);

  loadSubscriptionRef.current = loadSubscription;
  const flowViewRef = useRef<AddFlowViewApi | null>(null);
  const anchorsByDatabaseRef = useRef(new Map<string, string>());
  const lastErrorRef = useRef<unknown>(null);
  const startingRef = useRef(false);
  const handleRef = useRef<AddWidgetFlowHandle | null>(null);
  const settingsRequests = useMemo(() => createWidgetSettingsRequests(), []);

  const label = useCallback((layout: DatabaseViewLayout) => {
    const entry = NEW_VIEW_LAYOUT_LABELS[layout];

    return latest.current.t(entry.key, { defaultValue: entry.defaultValue });
  }, []);

  /** The view's name among its database's other views (`nextViewName`). */
  const nameFor = useCallback((base: string, exceptViewId: string) => {
    const names: string[] = [];

    getDatabaseFromDoc(latest.current.hostDoc)
      ?.get(YjsDatabaseKey.views)
      ?.forEach((view, viewId) => {
        const name = view.get(YjsDatabaseKey.name);

        if (viewId !== exceptViewId && typeof name === 'string' && name) names.push(name);
      });
    return nextViewName(base, names);
  }, []);

  const renameHostView = useCallback(async (viewId: string, name: string) => {
    const { hostDoc, updatePage } = latest.current;

    await updatePage?.(viewId, { name });
    await renameDatabaseViewInDoc({ doc: hostDoc, viewId, name });
  }, []);

  const createDefaultView = useCallback(async (spec: DefaultWidgetSpecKind) => {
    const handle = handleRef.current;
    const { ownedViews, t: translate } = latest.current;
    const baseName = translate(spec === 'chart' ? 'dashboard.picker.layout.chart' : 'dashboard.picker.layout.table', {
      defaultValue: DEFAULT_WIDGET_NAMES[spec],
    });

    try {
      const viewId = await ownedViews.createDefaultWidgetView(spec, baseName);

      handle?.dispatch({ type: 'created', viewId });
    } catch (error) {
      lastErrorRef.current = error instanceof DefaultWidgetPlanError ? error.cause : error;
      if (!(error instanceof DefaultWidgetPlanError))
        Log.warn('[Dashboard] could not create the default widget view', error);
      handle?.dispatch({ type: 'create_failed', planError: error instanceof DefaultWidgetPlanError });
    }
  }, []);

  const runEffect = useCallback(
    (effect: AddWidgetFlowEffect) => {
      const current = latest.current;
      const handle = handleRef.current;

      switch (effect.type) {
        case 'announce_limit':
          current.announce(
            effect.reason === 'dashboard'
              ? dashboardFullAnnouncement(current.t)
              : dashboardRowLimitAnnouncement(current.t)
          );
          break;
        case 'pin_edit':
          current.pinEditing();
          break;
        case 'create_default_view':
          void createDefaultView(effect.spec);
          break;
        case 'select':
          current.selectWidget(effect.widgetId);
          break;
        case 'scroll_to':
          current.scrollToWidget(effect.widgetId);
          break;
        case 'insert_widget':
        case 'insert_existing_widget': {
          const widget = createDashboardWidget(
            effect.viewId,
            effect.type === 'insert_existing_widget' ? effect.databaseId : current.hostDatabaseId,
            DASHBOARD_GRID_COLUMNS,
            effect.widgetId
          );
          // The updater only runs for a writer outside a mobile context, so a
          // refusal it records is the dashboard having filled meanwhile.
          let full = false;
          // One undo step of its own: the view creation and the chart seed are not in the history.
          const written = runDatabaseHistoryGroupForDatabase(
            current.hostDoc,
            () =>
              current.updateRows((rows) => {
                const placement = resolveAddPlacement(rows, effect.placement);

                if (!placement) full = true;
                return placement ? addDashboardWidget(rows, widget, placement) : rows;
              }),
            createDatabaseHistoryGroup()
          );

          // Not written: the dashboard filled meanwhile (announced), or write
          // access went or the context turned mobile (nothing to announce).
          if (!written) {
            if (effect.type === 'insert_widget') {
              handle?.dispatch({ type: 'insert_refused', viewId: effect.viewId, reason: full ? 'full' : 'access' });
            } else if (full) {
              current.announce(dashboardFullAnnouncement(current.t));
            }

            break;
          }

          current.selectWidget(effect.widgetId);
          current.scrollToWidget(effect.widgetId);
          break;
        }

        case 'delete_never_referenced_view':
          void current.ownedViews.deleteOwnedViewNow(effect.viewId, current.hostDatabaseId);
          break;
        case 'toast_create_failed':
          toast.error(
            getErrorMessage(
              lastErrorRef.current,
              current.t('dashboard.picker.createFailed', { defaultValue: 'Could not create the view' })
            )
          );
          break;
        case 'swap_widget_view':
          current.updateRows((rows) =>
            replaceDashboardWidgetView(rows, effect.widgetId, effect.viewId, effect.databaseId)
          );
          break;
        case 'enqueue_owned_view_deletion':
          current.ownedViews.enqueueOwnedViewDeletion(effect.viewId, current.hostDatabaseId);
          break;
        case 'switch_view_layout': {
          const api = flowViewRef.current;
          const previous = handle?.getState();
          const revert = (error: unknown) => {
            Log.warn('[Dashboard] could not switch the new widget view', error);
            toast.error(
              getErrorMessage(
                error,
                current.t('dashboard.picker.createFailed', { defaultValue: 'Could not create the view' })
              )
            );
            const state = handle?.getState();

            // Keep the previous tile: switch back in the flow (the view itself never changed).
            if (previous && 'layout' in previous && state?.kind === 'configuring') {
              handle?.dispatch({ type: 'pick_tile', layout: previous.layout });
            }
          };

          if (!api || api.viewId !== effect.viewId) break;
          try {
            const result = api.switchLayout(effect.layout);

            if (result instanceof Promise) void result.catch(revert);
          } catch (error) {
            revert(error);
          }

          break;
        }

        case 'rename_if_auto':
          void renameHostView(effect.viewId, nameFor(label(effect.layout), effect.viewId)).catch((error) =>
            Log.warn('[Dashboard] could not rename the new widget view', error)
          );
          break;
        case 'rename_view':
          void renameHostView(effect.viewId, effect.name.trim()).catch((error) =>
            Log.warn('[Dashboard] could not rename the new widget view', error)
          );
          break;
        case 'create_owned_view': {
          const anchorViewId = anchorsByDatabaseRef.current.get(effect.databaseId);

          if (!anchorViewId) break;
          void current.ownedViews
            .createWidgetView({
              databaseId: effect.databaseId,
              anchorViewId,
              layout: effect.layout,
              baseName: label(effect.layout),
            })
            .then((viewId) => {
              const latestOptions = latest.current;
              // The flow closes while creation runs, so Source settings can
              // already hold a newer choice. A reused hook can also belong to
              // a different host; the creator is stable for one dashboard.
              const sameHost =
                latestOptions.hostDoc === current.hostDoc &&
                latestOptions.hostDatabaseId === current.hostDatabaseId &&
                latestOptions.workspaceId === current.workspaceId &&
                latestOptions.ownedViews.createWidgetView === current.ownedViews.createWidgetView;
              const written = sameHost && latestOptions.updateRows((rows) => {
                const widget = rows.flatMap((row) => row.widgets).find((candidate) => candidate.id === effect.widgetId);

                if (widget?.viewId !== effect.replacesViewId || widget.databaseId !== current.hostDatabaseId) return rows;
                return replaceDashboardWidgetView(rows, effect.widgetId, viewId, effect.databaseId);
              });

              // The widget went meanwhile (undo, Delete, a collaborator) or the
              // write was refused: no row references the new view, so it goes
              // now (the queue only follows views the rows once held).
              if (!written) {
                void current.ownedViews.deleteOwnedViewNow(viewId, effect.databaseId);
                return;
              }

              current.ownedViews.enqueueOwnedViewDeletion(effect.replacesViewId, current.hostDatabaseId);
            })
            .catch((error) => {
              Log.warn('[Dashboard] could not create the view in another database', error);
              toast.error(
                getErrorMessage(
                  error,
                  latest.current.t('dashboard.picker.createFailed', { defaultValue: 'Could not create the view' })
                )
              );
            });
          break;
        }

        case 'open_settings':
          settingsRequests.request(effect.widgetId);
          break;
      }
    },
    [createDefaultView, label, nameFor, renameHostView, settingsRequests]
  );

  const runEffectRef = useRef(runEffect);

  runEffectRef.current = runEffect;
  const handle = useMemo(
    () => createAddWidgetFlowStore((effects) => effects.forEach((effect) => runEffectRef.current(effect))),
    []
  );

  handleRef.current = handle;

  // Leaving Edit mode, or losing write access, closes the picker (a creation in flight continues).
  const { editing, canEdit } = options;

  useEffect(() => {
    if (!canEdit) handle.dispatch({ type: 'access_lost' });
    else if (!editing) handle.dispatch({ type: 'mode_left' });
  }, [canEdit, editing, handle]);

  /** The plan inputs at the click (warmed on hover); an unknown plan never gets an ungated Number chart. */
  const resolveSpec = useCallback(async (): Promise<DefaultWidgetSpecKind> => {
    const policy = getWorkspacePlanPolicy();
    const chartCreationAllowed =
      !policy.requiresOnlineViewCreation(ViewLayout.Chart) ||
      (typeof navigator === 'undefined' ? true : navigator.onLine);
    const plan = await withTimeout<SubscriptionPlan | null>(
      loadSubscriptionRef.current(),
      ADD_WIDGET_PLAN_TIMEOUT_MS,
      null
    );

    return resolveDefaultWidgetSpec({ chartCreationAllowed, numberChartAllowed: policy.hasProAccess(plan) });
  }, []);

  const startAddWidget = useCallback(
    (placement: DashboardWidgetPlacement) => {
      const current = latest.current;

      if (!current.canEnterEdit || startingRef.current || handle.getState().kind === 'creating') return;
      const rows = current.getRows();
      const widgetId = generateDashboardId('w');

      // Capacity first: a refused add creates nothing (#16).
      if (!canAddDashboardWidget(rows, placement)) {
        handle.dispatch({
          type: 'start',
          placement,
          widgetId,
          spec: 'grid',
          refused: canAddDashboardWidget(rows) ? 'row' : 'dashboard',
        });
        return;
      }

      // The editor started building: Edit mode stays whatever the sync brings (R-MODE).
      current.pinEditing();
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        handle.dispatch({ type: 'start', placement, widgetId, spec: 'grid', refused: null, existingOnly: true });
        return;
      }

      startingRef.current = true;
      void resolveSpec()
        .then((spec) => handle.dispatch({ type: 'start', placement, widgetId, spec, refused: null }))
        .finally(() => {
          startingRef.current = false;
        });
    },
    [handle, resolveSpec]
  );

  const preload = useCallback(() => {
    latest.current.preloadPicker();
    void loadSubscriptionRef.current().catch(() => undefined);
  }, []);

  const createInDatabase = useCallback(
    (databaseId: string, anchorViewId: string, layout: DatabaseViewLayout) => {
      anchorsByDatabaseRef.current.set(databaseId, anchorViewId);
      handle.dispatch({ type: 'create_in_database', databaseId, layout });
    },
    [handle]
  );

  const openSourcePanel = useCallback((widgetId: string) => latest.current.openSourcePanel(widgetId), []);
  const dockAnchors = useMemo(() => createDockAnchorStore(), []);

  const api = useMemo<DashboardAddWidgetApi>(
    () => ({
      flow: handle,
      dockAnchors,
      preload,
      createInDatabase,
      settingsRequest: settingsRequests,
      requestWidgetSettings: settingsRequests.request,
      openSourcePanel,
    }),
    [createInDatabase, dockAnchors, handle, openSourcePanel, preload, settingsRequests]
  );

  const bindFlowView = useCallback((viewApi: AddFlowViewApi | null) => {
    flowViewRef.current = viewApi;
  }, []);

  return { api, startAddWidget, bindFlowView };
}
