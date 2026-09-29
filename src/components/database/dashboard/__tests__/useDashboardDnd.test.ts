import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

import { moveDashboardWidget } from '@/application/database-yjs/dashboard-layout';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';

import { DASHBOARD_ROW_GAP_DROP_TYPE, DASHBOARD_WIDGET_DROP_TYPE } from '../constants';
import {
  DashboardDropTarget,
  findDashboardDropTarget,
  getDropFeedback,
  parseDropTarget,
  resolveDropPlacement,
} from '../hooks/useDashboardDnd';

function makeRows(...layout: string[][]): DashboardRow[] {
  return layout.map((ids, rowIndex) => ({
    id: `r${rowIndex + 1}`,
    height: 360,
    widgets: ids.map((id) => ({ id, viewId: `view-${id}`, databaseId: 'db', width: 12 / ids.length })),
  }));
}

function ids(rows: DashboardRow[]) {
  return rows.map((row) => row.widgets.map((widget) => widget.id));
}

function drop(rows: DashboardRow[], widgetId: string, target: DashboardDropTarget) {
  const placement = resolveDropPlacement(rows, widgetId, target);

  // The dashboard commits drops through `moveDashboardWidget`.
  return placement ? moveDashboardWidget(rows, widgetId, placement) : rows;
}

/** Drop-target data with the closest edge attached, as the widget target builds it. */
function widgetTargetData(instanceId: symbol, widgetId: string, edge: 'left' | 'right') {
  const element = document.createElement('div');

  element.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 } as DOMRect);
  return attachClosestEdge(
    { type: DASHBOARD_WIDGET_DROP_TYPE, instanceId, widgetId },
    {
      element,
      input: { clientX: edge === 'left' ? 10 : 90, clientY: 50 } as never,
      allowedEdges: ['left', 'right'],
    }
  );
}

describe('getDropFeedback', () => {
  const rows = makeRows(['a', 'b', 'c'], ['d'], ['e', 'f', 'g', 'h']);

  it('ignores drops of unknown widgets and onto unknown or identical widgets', () => {
    expect(getDropFeedback(rows, 'missing', { type: 'row-gap', rowIndex: 0 })).toBe('noop');
    expect(getDropFeedback(rows, 'a', { type: 'widget', widgetId: 'missing', edge: 'left' })).toBe('noop');
    expect(getDropFeedback(rows, 'a', { type: 'widget', widgetId: 'a', edge: 'right' })).toBe('noop');
  });

  it('treats dropping next to itself as no move', () => {
    expect(getDropFeedback(rows, 'b', { type: 'widget', widgetId: 'a', edge: 'right' })).toBe('noop');
    expect(getDropFeedback(rows, 'b', { type: 'widget', widgetId: 'c', edge: 'left' })).toBe('noop');
  });

  it('allows reordering inside a row, even a full one', () => {
    expect(getDropFeedback(rows, 'a', { type: 'widget', widgetId: 'c', edge: 'right' })).toBe('allowed');
    expect(getDropFeedback(rows, 'e', { type: 'widget', widgetId: 'h', edge: 'right' })).toBe('allowed');
  });

  it('allows moving into another row with room and blocks a full one', () => {
    expect(getDropFeedback(rows, 'a', { type: 'widget', widgetId: 'd', edge: 'left' })).toBe('allowed');
    expect(getDropFeedback(rows, 'd', { type: 'widget', widgetId: 'e', edge: 'left' })).toBe('blocked');
  });

  it('treats the gaps around a lone widget as no move', () => {
    expect(getDropFeedback(rows, 'd', { type: 'row-gap', rowIndex: 1 })).toBe('noop');
    expect(getDropFeedback(rows, 'd', { type: 'row-gap', rowIndex: 2 })).toBe('noop');
    expect(getDropFeedback(rows, 'd', { type: 'row-gap', rowIndex: 0 })).toBe('allowed');
    expect(getDropFeedback(rows, 'd', { type: 'row-gap', rowIndex: 3 })).toBe('allowed');
  });

  it('allows a shared widget into any gap, including the ones around its row', () => {
    expect(getDropFeedback(rows, 'a', { type: 'row-gap', rowIndex: 0 })).toBe('allowed');
    expect(getDropFeedback(rows, 'a', { type: 'row-gap', rowIndex: 1 })).toBe('allowed');
  });
});

describe('resolveDropPlacement', () => {
  it('returns nothing for refused or empty drops', () => {
    const rows = makeRows(['a'], ['b', 'c', 'd', 'e']);

    expect(resolveDropPlacement(rows, 'a', { type: 'widget', widgetId: 'b', edge: 'left' })).toBeNull();
    expect(resolveDropPlacement(rows, 'a', { type: 'row-gap', rowIndex: 1 })).toBeNull();
  });

  it('reorders within a row (the BDD "right side of" drop)', () => {
    const rows = makeRows(['projects', 'tasks', 'notes'], ['tasks2']);

    expect(ids(drop(rows, 'projects', { type: 'widget', widgetId: 'notes', edge: 'right' }))).toEqual([
      ['tasks', 'notes', 'projects'],
      ['tasks2'],
    ]);
    expect(ids(drop(rows, 'notes', { type: 'widget', widgetId: 'projects', edge: 'left' }))).toEqual([
      ['notes', 'projects', 'tasks'],
      ['tasks2'],
    ]);
  });

  it('moves a widget into another row at the dropped edge and rebalances both rows', () => {
    const rows = makeRows(['projects', 'tasks', 'notes'], ['tasks2']);
    const next = drop(rows, 'notes', { type: 'widget', widgetId: 'tasks2', edge: 'right' });

    expect(ids(next)).toEqual([
      ['projects', 'tasks'],
      ['tasks2', 'notes'],
    ]);
    expect(next.map((row) => row.widgets.map((widget) => widget.width))).toEqual([
      [6, 6],
      [6, 6],
    ]);
  });

  it('turns a drop between rows into a new row', () => {
    const rows = makeRows(['projects', 'tasks', 'notes'], ['tasks2']);

    expect(ids(drop(rows, 'projects', { type: 'row-gap', rowIndex: 1 }))).toEqual([
      ['tasks', 'notes'],
      ['projects'],
      ['tasks2'],
    ]);
    expect(ids(drop(rows, 'tasks2', { type: 'row-gap', rowIndex: 0 }))).toEqual([
      ['tasks2'],
      ['projects', 'tasks', 'notes'],
    ]);
  });

  it('clamps gap indexes to the row list', () => {
    const rows = makeRows(['a', 'b'], ['c']);

    expect(resolveDropPlacement(rows, 'a', { type: 'row-gap', rowIndex: 99 })).toEqual({
      type: 'new_row',
      rowIndex: 2,
    });
    expect(resolveDropPlacement(rows, 'a', { type: 'row-gap', rowIndex: -3 })).toEqual({
      type: 'new_row',
      rowIndex: 0,
    });
  });
});

describe('drop target data', () => {
  const instanceId = Symbol('dashboard');
  const otherInstanceId = Symbol('other-dashboard');

  it('reads widget edges and row gaps', () => {
    expect(parseDropTarget(widgetTargetData(instanceId, 'w1', 'left'))).toEqual({
      type: 'widget',
      widgetId: 'w1',
      edge: 'left',
    });
    expect(parseDropTarget(widgetTargetData(instanceId, 'w1', 'right'))).toEqual({
      type: 'widget',
      widgetId: 'w1',
      edge: 'right',
    });
    expect(parseDropTarget({ type: DASHBOARD_ROW_GAP_DROP_TYPE, instanceId, rowIndex: 2 })).toEqual({
      type: 'row-gap',
      rowIndex: 2,
    });
  });

  it('rejects foreign or incomplete data', () => {
    expect(parseDropTarget({ type: 'board-column', columnId: 'c1' })).toBeNull();
    expect(parseDropTarget({ type: DASHBOARD_WIDGET_DROP_TYPE, instanceId, widgetId: 'w1' })).toBeNull();
    expect(parseDropTarget({ type: DASHBOARD_ROW_GAP_DROP_TYPE, instanceId, rowIndex: '1' })).toBeNull();
  });

  it('skips nested database targets and other dashboards', () => {
    const targets = [
      { type: 'grid-row', rowId: 'row-1' },
      { ...widgetTargetData(otherInstanceId, 'foreign', 'left') },
      widgetTargetData(instanceId, 'w2', 'right'),
      { type: DASHBOARD_ROW_GAP_DROP_TYPE, instanceId, rowIndex: 0 },
    ];

    expect(findDashboardDropTarget(targets, instanceId)).toEqual({ type: 'widget', widgetId: 'w2', edge: 'right' });
    expect(findDashboardDropTarget([{ type: 'grid-row' }], instanceId)).toBeNull();
    expect(findDashboardDropTarget([], instanceId)).toBeNull();
  });
});
