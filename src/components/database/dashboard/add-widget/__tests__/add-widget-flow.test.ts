import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { DashboardWidgetPlacement } from '@/application/database-yjs/dashboard.type';
import { DatabaseViewLayout } from '@/application/types';

import {
  AddWidgetFlowEffect,
  AddWidgetFlowEvent,
  AddWidgetFlowState,
  addWidgetFlowWidgetId,
  DEFAULT_WIDGET_LAYOUTS,
  DEFAULT_WIDGET_NAMES,
  IDLE_ADD_WIDGET_FLOW,
  isAddWidgetPopoverOpen,
  reduceAddWidgetFlow,
  resolveDefaultWidgetSpec,
} from '../add-widget-flow';

type Json = Record<string, unknown>;

interface FlowCase {
  name: string;
  events: Json[];
  expect_states: Json[];
  expect_effects: Json[][];
}

interface AddWidgetFixture {
  default_widget_spec: {
    chart_creation_allowed: boolean;
    number_chart_allowed: boolean;
    expect: { layout: 'chart' | 'grid'; name: string };
  }[];
  flow: FlowCase[];
}

const FIXTURE = loadParityFixture<AddWidgetFixture>('add-widget.json');

const LAYOUTS: Record<string, DatabaseViewLayout> = {
  grid: DatabaseViewLayout.Grid,
  board: DatabaseViewLayout.Board,
  calendar: DatabaseViewLayout.Calendar,
  chart: DatabaseViewLayout.Chart,
  list: DatabaseViewLayout.List,
  gallery: DatabaseViewLayout.Gallery,
  feed: DatabaseViewLayout.Feed,
  timeline: DatabaseViewLayout.Timeline,
};
const LAYOUT_NAMES = Object.fromEntries(Object.entries(LAYOUTS).map(([name, layout]) => [layout, name]));

function placementOf(json: Json): DashboardWidgetPlacement {
  return json.type === 'existing_row'
    ? { type: 'existing_row', rowId: String(json.row_id), index: json.index as number | undefined }
    : { type: 'new_row' };
}

function placementJson(placement: DashboardWidgetPlacement): Json {
  return placement.type === 'existing_row'
    ? { type: 'existing_row', row_id: placement.rowId, index: placement.index }
    : { type: 'new_row' };
}

function eventOf(json: Json): AddWidgetFlowEvent {
  switch (json.type) {
    case 'start':
      return {
        type: 'start',
        placement: placementOf(json.placement as Json),
        widgetId: String(json.widget_id),
        spec: json.spec as 'chart' | 'grid',
        refused: (json.refused as 'dashboard' | 'row' | null) ?? null,
      };
    case 'created':
    case 'insert_refused':
      return { type: json.type, viewId: String(json.view_id) };
    case 'create_failed':
      return { type: 'create_failed', planError: json.plan_error === true };
    case 'pick_existing':
      return { type: 'pick_existing', viewId: String(json.view_id), databaseId: String(json.database_id) };
    case 'pick_layout':
    case 'pick_tile':
      return { type: json.type, layout: LAYOUTS[String(json.layout)] };
    case 'create_in_database':
      return { type: 'create_in_database', databaseId: String(json.database_id), layout: LAYOUTS[String(json.layout)] };
    case 'rename':
      return { type: 'rename', name: String(json.name) };
    default:
      return { type: json.type as 'dismiss' | 'mode_left' | 'access_lost' | 'edit_chart' | 'back' };
  }
}

function stateJson(state: AddWidgetFlowState): Json {
  switch (state.kind) {
    case 'idle':
      return { kind: 'idle' };
    case 'creating':
      return {
        kind: 'creating',
        widget_id: state.widgetId,
        placement: placementJson(state.placement),
        spec: state.spec,
        popover_open: state.popoverOpen,
      };
    default: {
      const base: Json = {
        kind: state.kind,
        widget_id: state.widgetId,
        view_id: state.viewId,
        layout: LAYOUT_NAMES[state.layout],
        auto_named: state.autoNamed,
      };

      return state.kind === 'settings' ? { ...base, back_to: state.backTo } : base;
    }
  }
}

function effectJson(effect: AddWidgetFlowEffect): Json {
  const json: Json = { type: effect.type };
  const keys: Record<string, string> = {
    widgetId: 'widget_id',
    viewId: 'view_id',
    databaseId: 'database_id',
    replacesViewId: 'replaces_view_id',
  };

  Object.entries(effect).forEach(([key, value]) => {
    if (key === 'type') return;
    if (key === 'layout') json.layout = LAYOUT_NAMES[value as DatabaseViewLayout];
    else if (key === 'placement') json.placement = placementJson(value as DashboardWidgetPlacement);
    else json[keys[key] ?? key] = value;
  });
  return json;
}

describe('reduceAddWidgetFlow against add-widget.json', () => {
  it('covers the WP06 flow vectors', () => {
    expect(FIXTURE.flow.length).toBeGreaterThanOrEqual(9);
  });

  it.each(FIXTURE.flow.map((flowCase) => [flowCase.name, flowCase] as const))('%s', (_name, flowCase) => {
    let state: AddWidgetFlowState = IDLE_ADD_WIDGET_FLOW;

    flowCase.events.forEach((event, index) => {
      const result = reduceAddWidgetFlow(state, eventOf(event));

      state = result.state;
      expect({ step: index, state: stateJson(state), effects: result.effects.map(effectJson) }).toEqual({
        step: index,
        state: flowCase.expect_states[index],
        effects: flowCase.expect_effects[index],
      });
    });
  });
});

describe('resolveDefaultWidgetSpec against add-widget.json', () => {
  it.each(FIXTURE.default_widget_spec.map((vector) => [JSON.stringify(vector), vector] as const))(
    '%s',
    (_name, vector) => {
      const spec = resolveDefaultWidgetSpec({
        chartCreationAllowed: vector.chart_creation_allowed,
        numberChartAllowed: vector.number_chart_allowed,
      });

      expect({ layout: spec, name: DEFAULT_WIDGET_NAMES[spec] }).toEqual(vector.expect);
      expect(DEFAULT_WIDGET_LAYOUTS[spec]).toBe(spec === 'chart' ? DatabaseViewLayout.Chart : DatabaseViewLayout.Grid);
    }
  );
});

describe('rename_if_auto', () => {
  const opened = (autoNamed: boolean): AddWidgetFlowState => ({
    kind: 'open',
    widgetId: 'w:1',
    viewId: 'v1',
    layout: DatabaseViewLayout.Chart,
    autoNamed,
  });

  it('renames an untouched name with the layout pick', () => {
    expect(reduceAddWidgetFlow(opened(true), { type: 'pick_layout', layout: DatabaseViewLayout.List }).effects).toEqual([
      { type: 'switch_view_layout', viewId: 'v1', layout: DatabaseViewLayout.List },
      { type: 'rename_if_auto', viewId: 'v1', layout: DatabaseViewLayout.List },
    ]);
  });

  it('never overwrites a name the user typed', () => {
    expect(reduceAddWidgetFlow(opened(false), { type: 'pick_layout', layout: DatabaseViewLayout.List }).effects).toEqual(
      [{ type: 'switch_view_layout', viewId: 'v1', layout: DatabaseViewLayout.List }]
    );
  });
});

describe('flow helpers', () => {
  it('names the flow widget and tells when a dock panel shows', () => {
    const creating: AddWidgetFlowState = {
      kind: 'creating',
      widgetId: 'w:1',
      placement: { type: 'new_row' },
      spec: 'chart',
      popoverOpen: true,
    };

    expect(addWidgetFlowWidgetId(IDLE_ADD_WIDGET_FLOW)).toBeNull();
    expect(addWidgetFlowWidgetId(creating)).toBe('w:1');
    expect(isAddWidgetPopoverOpen(creating)).toBe(true);
    expect(isAddWidgetPopoverOpen({ ...creating, popoverOpen: false })).toBe(false);
    expect(
      isAddWidgetPopoverOpen({
        kind: 'settings',
        widgetId: 'w:1',
        viewId: 'v',
        layout: 3,
        autoNamed: true,
        backTo: 'configuring',
      })
    ).toBe(false);
  });
});

describe('insert_refused', () => {
  const deleted = { type: 'delete_never_referenced_view', viewId: 'v1' };

  it('announces a dashboard that filled meanwhile, not a lost write access', () => {
    // The fixture's bare event is the full dashboard (the default).
    expect(reduceAddWidgetFlow(IDLE_ADD_WIDGET_FLOW, { type: 'insert_refused', viewId: 'v1' }).effects).toEqual([
      deleted,
      { type: 'announce_limit', reason: 'dashboard' },
    ]);
    expect(
      reduceAddWidgetFlow(IDLE_ADD_WIDGET_FLOW, { type: 'insert_refused', viewId: 'v1', reason: 'full' }).effects
    ).toEqual([deleted, { type: 'announce_limit', reason: 'dashboard' }]);
    expect(reduceAddWidgetFlow(IDLE_ADD_WIDGET_FLOW, { type: 'insert_refused', viewId: 'v1', reason: 'access' })).toEqual({
      state: IDLE_ADD_WIDGET_FLOW,
      effects: [deleted],
    });
  });
});
