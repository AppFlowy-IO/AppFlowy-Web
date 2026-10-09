import { DashboardWidgetPlacement } from '@/application/database-yjs/dashboard.type';
import { DatabaseViewLayout } from '@/application/types';

/**
 * The add-widget flow (WP06 §1.5) as a pure reducer: the same states, events
 * and effects as desktop `dashboard_add_widget_flow.dart`, both bound to
 * `dashboard-parity/add-widget.json` (`flow`, `default_widget_spec`).
 *
 * A "+" inserts a selected default widget straight away and opens the "New
 * view" picker beside it; the picker either swaps the widget to an existing
 * view, turns the widget's own view into another type, or is closed and the
 * default widget stays. The reducer decides; `useAddWidgetFlow` runs the
 * effects (view creation, layout writes, announcements).
 */

/** The default widget: a Number chart, or a table where charts or Number cannot be created. */
export type DefaultWidgetSpecKind = 'chart' | 'grid';

export interface DefaultWidgetPlanInputs {
  /** A Chart view can be created here (online check of hosted workspaces). */
  chartCreationAllowed: boolean;
  /** The Number chart type is available (Pro, or self-hosted). */
  numberChartAllowed: boolean;
}

/** WP06 §1.2: a Number chart only when both are allowed, else a Grid named "Table". */
export function resolveDefaultWidgetSpec({
  chartCreationAllowed,
  numberChartAllowed,
}: DefaultWidgetPlanInputs): DefaultWidgetSpecKind {
  return chartCreationAllowed && numberChartAllowed ? 'chart' : 'grid';
}

/** The database layout of each default spec. */
export const DEFAULT_WIDGET_LAYOUTS: Record<DefaultWidgetSpecKind, DatabaseViewLayout> = {
  chart: DatabaseViewLayout.Chart,
  grid: DatabaseViewLayout.Grid,
};

/** English names of the default widget views, numbered among the database's views ("Chart", "Chart (1)"). */
export const DEFAULT_WIDGET_NAMES: Record<DefaultWidgetSpecKind, string> = {
  chart: 'Chart',
  grid: 'Table',
};

/** Why an add was refused (`canAddDashboardWidget`): the dashboard or the target row is full. */
export type AddWidgetRefusal = 'dashboard' | 'row';

interface FlowViewState {
  widgetId: string;
  /** The widget's own view, created by the flow (owned by the dashboard). */
  viewId: string;
  layout: DatabaseViewLayout;
  /** The view still has the name the flow gave it: a type pick renames it. */
  autoNamed: boolean;
}

export type AddWidgetFlowState =
  | { kind: 'idle' }
  | {
      kind: 'choosing_existing';
      widgetId: string;
      placement: DashboardWidgetPlacement;
      /** Geometry only: this pending slot has no owned view or stored widget. */
      spec: 'grid';
    }
  | {
      kind: 'creating';
      widgetId: string;
      placement: DashboardWidgetPlacement;
      spec: DefaultWidgetSpecKind;
      /** The picker is shown (dismissing it while creating keeps the creation going). */
      popoverOpen: boolean;
    }
  | ({ kind: 'open' } & FlowViewState)
  | ({ kind: 'configuring' } & FlowViewState)
  | ({ kind: 'settings'; backTo: 'configuring' } & FlowViewState);

export type AddWidgetFlowEvent =
  | {
      type: 'start';
      placement: DashboardWidgetPlacement;
      /** Generated at the click: the pending slot and the persisted widget share it. */
      widgetId: string;
      spec: DefaultWidgetSpecKind;
      /** `canAddDashboardWidget` refused the placement. */
      refused: AddWidgetRefusal | null;
      /** Offline adds can reference existing views without creating an owned view. */
      existingOnly?: boolean;
    }
  | { type: 'created'; viewId: string }
  | {
      type: 'insert_refused';
      viewId: string;
      /**
       * Why the insert was refused: the dashboard filled between the click and
       * the insert (announced; the default), or the write went for another
       * reason, write access lost or a mobile context, which has nothing to say.
       */
      reason?: 'full' | 'access';
    }
  | { type: 'create_failed'; planError: boolean }
  | { type: 'dismiss' }
  | { type: 'mode_left' }
  | { type: 'access_lost' }
  | { type: 'pick_existing'; viewId: string; databaseId: string }
  | { type: 'pick_layout'; layout: DatabaseViewLayout }
  | { type: 'pick_tile'; layout: DatabaseViewLayout }
  | { type: 'create_in_database'; databaseId: string; layout: DatabaseViewLayout }
  | { type: 'rename'; name: string }
  | { type: 'edit_chart' }
  | { type: 'back' };

export type AddWidgetFlowEffect =
  | { type: 'announce_limit'; reason: AddWidgetRefusal }
  | { type: 'pin_edit' }
  | { type: 'create_default_view'; spec: DefaultWidgetSpecKind }
  | { type: 'select'; widgetId: string }
  | { type: 'scroll_to'; widgetId: string }
  | { type: 'insert_widget'; widgetId: string; viewId: string; placement: DashboardWidgetPlacement }
  | {
      type: 'insert_existing_widget';
      widgetId: string;
      viewId: string;
      databaseId: string;
      placement: DashboardWidgetPlacement;
    }
  | { type: 'delete_never_referenced_view'; viewId: string }
  | { type: 'toast_create_failed' }
  | { type: 'swap_widget_view'; widgetId: string; viewId: string; databaseId: string }
  | { type: 'enqueue_owned_view_deletion'; viewId: string }
  | { type: 'switch_view_layout'; viewId: string; layout: DatabaseViewLayout }
  | { type: 'rename_if_auto'; viewId: string; layout: DatabaseViewLayout }
  | {
      type: 'create_owned_view';
      databaseId: string;
      layout: DatabaseViewLayout;
      widgetId: string;
      /** The flow's default view, deleted through the queue once the widget shows the new one. */
      replacesViewId: string;
    }
  | { type: 'rename_view'; viewId: string; name: string }
  | { type: 'open_settings'; widgetId: string };

export interface AddWidgetFlowResult {
  state: AddWidgetFlowState;
  effects: AddWidgetFlowEffect[];
}

export const IDLE_ADD_WIDGET_FLOW: AddWidgetFlowState = { kind: 'idle' };

const unchanged = (state: AddWidgetFlowState): AddWidgetFlowResult => ({ state, effects: [] });

function viewState(state: Extract<AddWidgetFlowState, FlowViewState>): FlowViewState {
  const { widgetId, viewId, layout, autoNamed } = state;

  return { widgetId, viewId, layout, autoNamed };
}

/** A type pick: the widget's own view switches in place, and an untouched name follows the type. */
function pickLayout(state: Extract<AddWidgetFlowState, FlowViewState>, layout: DatabaseViewLayout): AddWidgetFlowResult {
  const base = viewState(state);

  if (layout === state.layout) return { state: { kind: 'configuring', ...base }, effects: [] };
  const effects: AddWidgetFlowEffect[] = [{ type: 'switch_view_layout', viewId: state.viewId, layout }];

  if (state.autoNamed) effects.push({ type: 'rename_if_auto', viewId: state.viewId, layout });
  return { state: { kind: 'configuring', ...base, layout }, effects };
}

export function reduceAddWidgetFlow(state: AddWidgetFlowState, event: AddWidgetFlowEvent): AddWidgetFlowResult {
  switch (event.type) {
    case 'start': {
      // One add at a time: the "+" controls wait for the default view in flight.
      if (state.kind === 'creating') return unchanged(state);
      if (event.refused) return { state, effects: [{ type: 'announce_limit', reason: event.refused }] };
      if (event.existingOnly) {
        return {
          state: { kind: 'choosing_existing', widgetId: event.widgetId, placement: event.placement, spec: 'grid' },
          effects: [
            { type: 'pin_edit' },
            { type: 'select', widgetId: event.widgetId },
            { type: 'scroll_to', widgetId: event.widgetId },
          ],
        };
      }

      return {
        state: {
          kind: 'creating',
          widgetId: event.widgetId,
          placement: event.placement,
          spec: event.spec,
          popoverOpen: true,
        },
        effects: [
          { type: 'pin_edit' },
          { type: 'create_default_view', spec: event.spec },
          { type: 'select', widgetId: event.widgetId },
          { type: 'scroll_to', widgetId: event.widgetId },
        ],
      };
    }

    case 'created': {
      if (state.kind !== 'creating') return unchanged(state);
      const effects: AddWidgetFlowEffect[] = [
        { type: 'insert_widget', widgetId: state.widgetId, viewId: event.viewId, placement: state.placement },
      ];

      if (!state.popoverOpen) return { state: IDLE_ADD_WIDGET_FLOW, effects };
      return {
        state: {
          kind: 'open',
          widgetId: state.widgetId,
          viewId: event.viewId,
          layout: DEFAULT_WIDGET_LAYOUTS[state.spec],
          autoNamed: true,
        },
        effects,
      };
    }

    case 'insert_refused': {
      // The created view never got its widget. A dashboard that filled between
      // the click and the insert is announced; a lost write access (or a
      // mobile context) is not: the dashboard is not full.
      const effects: AddWidgetFlowEffect[] = [{ type: 'delete_never_referenced_view', viewId: event.viewId }];

      if (event.reason !== 'access') effects.push({ type: 'announce_limit', reason: 'dashboard' });
      return { state: IDLE_ADD_WIDGET_FLOW, effects };
    }

    case 'create_failed': {
      if (state.kind !== 'creating') return unchanged(state);
      if (event.planError && state.spec === 'chart') {
        return { state: { ...state, spec: 'grid' }, effects: [{ type: 'create_default_view', spec: 'grid' }] };
      }

      return { state: IDLE_ADD_WIDGET_FLOW, effects: [{ type: 'toast_create_failed' }] };
    }

    case 'dismiss':
    case 'mode_left':
    case 'access_lost':
      // The creation in flight continues: its widget is still inserted.
      if (state.kind === 'creating') {
        return state.popoverOpen ? { state: { ...state, popoverOpen: false }, effects: [] } : unchanged(state);
      }

      return state.kind === 'idle' ? unchanged(state) : { state: IDLE_ADD_WIDGET_FLOW, effects: [] };

    case 'pick_existing':
      if (state.kind === 'choosing_existing') {
        return {
          state: IDLE_ADD_WIDGET_FLOW,
          effects: [{
            type: 'insert_existing_widget',
            widgetId: state.widgetId,
            placement: state.placement,
            viewId: event.viewId,
            databaseId: event.databaseId,
          }],
        };
      }

      if (state.kind !== 'open') return unchanged(state);
      return {
        state: IDLE_ADD_WIDGET_FLOW,
        effects: [
          { type: 'swap_widget_view', widgetId: state.widgetId, viewId: event.viewId, databaseId: event.databaseId },
          { type: 'enqueue_owned_view_deletion', viewId: state.viewId },
        ],
      };

    case 'pick_layout':
      return state.kind === 'open' ? pickLayout(state, event.layout) : unchanged(state);

    case 'pick_tile':
      return state.kind === 'configuring' ? pickLayout(state, event.layout) : unchanged(state);

    case 'create_in_database':
      if (state.kind !== 'open') return unchanged(state);
      return {
        state: IDLE_ADD_WIDGET_FLOW,
        effects: [
          {
            type: 'create_owned_view',
            databaseId: event.databaseId,
            layout: event.layout,
            widgetId: state.widgetId,
            replacesViewId: state.viewId,
          },
        ],
      };

    case 'rename': {
      if (state.kind !== 'configuring') return unchanged(state);
      return {
        state: { ...state, autoNamed: false },
        effects: [{ type: 'rename_view', viewId: state.viewId, name: event.name }],
      };
    }

    case 'edit_chart':
      if (state.kind !== 'configuring' || state.layout !== DatabaseViewLayout.Chart) return unchanged(state);
      return {
        state: { kind: 'settings', ...viewState(state), backTo: 'configuring' },
        effects: [{ type: 'open_settings', widgetId: state.widgetId }],
      };

    case 'back':
      if (state.kind === 'settings') return { state: { kind: 'configuring', ...viewState(state) }, effects: [] };
      if (state.kind === 'configuring') return { state: { kind: 'open', ...viewState(state) }, effects: [] };
      if (state.kind === 'open') return { state: IDLE_ADD_WIDGET_FLOW, effects: [] };
      if (state.kind === 'choosing_existing') return { state: IDLE_ADD_WIDGET_FLOW, effects: [] };
      return unchanged(state);
  }
}

/** The widget the flow is adding or configuring, if any. */
export function addWidgetFlowWidgetId(state: AddWidgetFlowState): string | null {
  return state.kind === 'idle' ? null : state.widgetId;
}

/** Whether a dock panel (picker, New view panel) is shown for the flow's widget. */
export function isAddWidgetPopoverOpen(state: AddWidgetFlowState): boolean {
  return state.kind === 'choosing_existing' || state.kind === 'open' || state.kind === 'configuring' || (state.kind === 'creating' && state.popoverOpen);
}
