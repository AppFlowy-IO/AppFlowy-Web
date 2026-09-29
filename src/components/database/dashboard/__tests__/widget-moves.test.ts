import { moveDashboardWidget } from '@/application/database-yjs/dashboard-layout';
import { DASHBOARD_MAX_WIDGETS, DashboardRow } from '@/application/database-yjs/dashboard.type';

import {
  canDuplicateWidget,
  getWidgetMoveTargets,
  NO_WIDGET_MOVES,
  resolveAddPlacement,
  WidgetMoveDirection,
} from '../widget-moves';

/** Rows from widget-id lists; widths are split evenly like the real layout. */
function makeRows(...layout: string[][]): DashboardRow[] {
  return layout.map((ids, rowIndex) => ({
    id: `r${rowIndex + 1}`,
    height: 360 + rowIndex,
    widgets: ids.map((id, index) => ({
      id,
      viewId: `view-${id}`,
      databaseId: 'db',
      width:
        index === ids.length - 1 ? 12 - Math.floor(12 / ids.length) * (ids.length - 1) : Math.floor(12 / ids.length),
    })),
  }));
}

function ids(rows: DashboardRow[]) {
  return rows.map((row) => row.widgets.map((widget) => widget.id));
}

function move(rows: DashboardRow[], widgetId: string, direction: WidgetMoveDirection) {
  const placement = getWidgetMoveTargets(rows, widgetId)[direction];

  if (!placement) throw new Error(`"${widgetId}" cannot move ${direction}`);
  return moveDashboardWidget(rows, widgetId, placement);
}

describe('getWidgetMoveTargets', () => {
  it('offers nothing for an unknown widget', () => {
    expect(getWidgetMoveTargets(makeRows(['a']), 'missing')).toBe(NO_WIDGET_MOVES);
  });

  it('disables every move of the only widget', () => {
    expect(getWidgetMoveTargets(makeRows(['a']), 'a')).toEqual(NO_WIDGET_MOVES);
  });

  it('enables left / right only when there is a neighbour on that side', () => {
    const rows = makeRows(['a', 'b', 'c']);

    expect(getWidgetMoveTargets(rows, 'a').left).toBeNull();
    expect(getWidgetMoveTargets(rows, 'a').right).not.toBeNull();
    expect(getWidgetMoveTargets(rows, 'b').left).not.toBeNull();
    expect(getWidgetMoveTargets(rows, 'b').right).not.toBeNull();
    expect(getWidgetMoveTargets(rows, 'c').right).toBeNull();
  });

  it('swaps a widget with its neighbours', () => {
    const rows = makeRows(['a', 'b', 'c']);

    expect(ids(move(rows, 'b', 'left'))).toEqual([['b', 'a', 'c']]);
    expect(ids(move(rows, 'b', 'right'))).toEqual([['a', 'c', 'b']]);
  });

  it('splits a widget that shares its row into its own row above or below', () => {
    const rows = makeRows(['a', 'b', 'c'], ['d']);

    expect(ids(move(rows, 'b', 'up'))).toEqual([['b'], ['a', 'c'], ['d']]);
    expect(ids(move(rows, 'b', 'down'))).toEqual([['a', 'c'], ['b'], ['d']]);
  });

  it('lets a lone widget join the neighbouring row, so up and down undo each other', () => {
    const rows = makeRows(['a', 'c'], ['b'], ['d']);
    const up = move(rows, 'b', 'up');

    expect(ids(up)).toEqual([['a', 'c', 'b'], ['d']]);
    // Back down: it now shares a row, so it gets its own row again.
    expect(ids(move(up, 'b', 'down'))).toEqual([['a', 'c'], ['b'], ['d']]);

    const down = move(rows, 'b', 'down');

    expect(ids(down)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
    expect(ids(move(down, 'b', 'up'))).toEqual([['a', 'c'], ['b'], ['d']]);
  });

  it('replays the widget-menu scenario of the BDD suite', () => {
    let rows = makeRows(['projects', 'tasks', 'notes'], ['tasks2']);

    rows = move(rows, 'tasks', 'left');
    expect(ids(rows)).toEqual([['tasks', 'projects', 'notes'], ['tasks2']]);
    rows = move(rows, 'tasks', 'right');
    expect(ids(rows)).toEqual([['projects', 'tasks', 'notes'], ['tasks2']]);
    rows = move(rows, 'tasks', 'down');
    expect(ids(rows)).toEqual([['projects', 'notes'], ['tasks'], ['tasks2']]);
    rows = move(rows, 'tasks', 'up');
    expect(ids(rows)).toEqual([['projects', 'notes', 'tasks'], ['tasks2']]);
    expect(rows.every((row) => row.widgets.reduce((sum, widget) => sum + widget.width, 0) === 12)).toBe(true);
  });

  it('swaps a lone widget with a full neighbouring row', () => {
    const rows = makeRows(['a', 'b', 'c', 'd'], ['e'], ['f', 'g', 'h', 'i']);

    expect(ids(move(rows, 'e', 'up'))).toEqual([['e'], ['a', 'b', 'c', 'd'], ['f', 'g', 'h', 'i']]);
    expect(ids(move(rows, 'e', 'down'))).toEqual([['a', 'b', 'c', 'd'], ['f', 'g', 'h', 'i'], ['e']]);
  });

  it('keeps the row height of a widget that moves into a new row', () => {
    const rows = makeRows(['a', 'b']);
    const [moved] = move(rows, 'b', 'up');

    expect(moved.height).toBe(rows[0].height);
  });

  it('disables up for the first lone row and down for the last lone row', () => {
    const rows = makeRows(['a'], ['b']);

    expect(getWidgetMoveTargets(rows, 'a').up).toBeNull();
    expect(getWidgetMoveTargets(rows, 'a').down).not.toBeNull();
    expect(getWidgetMoveTargets(rows, 'b').up).not.toBeNull();
    expect(getWidgetMoveTargets(rows, 'b').down).toBeNull();
  });
});

describe('canDuplicateWidget', () => {
  it('needs a known widget and a free slot on the dashboard', () => {
    const rows = makeRows(['a', 'b']);

    expect(canDuplicateWidget(rows, 'a')).toBe(true);
    expect(canDuplicateWidget(rows, 'missing')).toBe(false);
  });

  it('is refused on a full dashboard', () => {
    const full = makeRows(
      ...Array.from({ length: DASHBOARD_MAX_WIDGETS / 4 }, (_, rowIndex) =>
        Array.from({ length: 4 }, (__, index) => `w${rowIndex}-${index}`)
      )
    );

    expect(canDuplicateWidget(full, 'w0-0')).toBe(false);
  });
});

describe('resolveAddPlacement', () => {
  it('keeps a placement the limits accept', () => {
    const rows = makeRows(['a']);

    expect(resolveAddPlacement(rows, { type: 'existing_row', rowId: 'r1', index: 1 })).toEqual({
      type: 'existing_row',
      rowId: 'r1',
      index: 1,
    });
    expect(resolveAddPlacement(rows, { type: 'new_row' })).toEqual({ type: 'new_row' });
  });

  it('starts a new row below a row that filled up meanwhile', () => {
    const rows = makeRows(['a'], ['b', 'c', 'd', 'e'], ['f']);

    expect(resolveAddPlacement(rows, { type: 'existing_row', rowId: 'r2' })).toEqual({ type: 'new_row', rowIndex: 2 });
  });

  it('appends a new row when the target row is gone', () => {
    const rows = makeRows(['a'], ['b']);

    expect(resolveAddPlacement(rows, { type: 'existing_row', rowId: 'gone' })).toEqual({
      type: 'new_row',
      rowIndex: 2,
    });
  });

  it('refuses any add on a full dashboard', () => {
    const full = makeRows(['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k', 'l']);

    expect(resolveAddPlacement(full, { type: 'new_row' })).toBeNull();
    expect(resolveAddPlacement(full, { type: 'existing_row', rowId: 'r1' })).toBeNull();
  });
});
