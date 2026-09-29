import {
  addDashboardWidget,
  duplicateDashboardWidget,
  getDashboardJoinWidth,
  moveDashboardWidget,
} from '../dashboard-layout';
import { DashboardRow, DashboardWidget } from '../dashboard.type';

// A widget joining a row gets an equal share of it; the widgets already there
// keep their proportions, and reorders inside a row keep every width.

function widget(id: string, width = 12): DashboardWidget {
  return { id, viewId: `view-${id}`, databaseId: 'db', width };
}

function row(id: string, widgets: DashboardWidget[], height = 360): DashboardRow {
  return { id, height, widgets };
}

function widths(rows: DashboardRow[]) {
  return rows.map((item) => item.widgets.map((entry) => entry.width));
}

function ids(rows: DashboardRow[]) {
  return rows.map((item) => item.widgets.map((entry) => entry.id));
}

function fullDashboard() {
  return Array.from({ length: 3 }, (_, rowIndex) =>
    row(
      `r${rowIndex}`,
      Array.from({ length: 4 }, (__, index) => widget(`w${rowIndex}-${index}`, 3))
    )
  );
}

describe('getDashboardJoinWidth', () => {
  it('asks for an equal share of the row', () => {
    expect(getDashboardJoinWidth(row('r', []))).toBe(12);
    expect(getDashboardJoinWidth(row('r', [widget('a', 12)]))).toBe(12);
    expect(getDashboardJoinWidth(row('r', [widget('a', 8), widget('b', 4)]))).toBe(6);
    expect(getDashboardJoinWidth(row('r', [widget('a', 4), widget('b', 4), widget('c', 4)]))).toBe(4);
  });

  it('treats a row without widths as a full row', () => {
    expect(getDashboardJoinWidth(row('r', [widget('a', 0), widget('b', 0)]))).toBe(6);
  });
});

describe('addDashboardWidget', () => {
  it('splits a one-widget row in half', () => {
    const rows = [row('r1', [widget('a')])];
    const result = addDashboardWidget(rows, widget('b'), { type: 'existing_row', rowId: 'r1' });

    expect(ids(result)).toEqual([['a', 'b']]);
    expect(widths(result)).toEqual([[6, 6]]);
    expect(result[0].id).toBe('r1');
  });

  it('gives the newcomer a third and keeps the others proportional', () => {
    const rows = [row('r1', [widget('a', 6), widget('b', 6)])];

    expect(widths(addDashboardWidget(rows, widget('c'), { type: 'existing_row', rowId: 'r1', index: 0 }))).toEqual([
      [4, 4, 4],
    ]);
    expect(ids(addDashboardWidget(rows, widget('c'), { type: 'existing_row', rowId: 'r1', index: 0 }))).toEqual([
      ['c', 'a', 'b'],
    ]);

    const uneven = [row('r1', [widget('a', 9), widget('b', 3)])];
    const result = addDashboardWidget(uneven, widget('c'), { type: 'existing_row', rowId: 'r1' });

    expect(widths(result)[0][2]).toBe(4);
    expect(widths(result)[0].reduce((sum, width) => sum + width, 0)).toBe(12);
    expect(widths(result)[0][0]).toBeGreaterThan(widths(result)[0][1]);
  });

  it('adds a full-width row for new-row placements', () => {
    const rows = [row('r1', [widget('a')])];
    const result = addDashboardWidget(rows, widget('b', 3), { type: 'new_row', rowIndex: 0 });

    expect(ids(result)).toEqual([['b'], ['a']]);
    expect(widths(result)).toEqual([[12], [12]]);
  });

  it('returns the same rows when the limits refuse the add', () => {
    const full = fullDashboard();
    const fullRow = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)])];

    expect(addDashboardWidget(full, widget('x'))).toBe(full);
    expect(addDashboardWidget(fullRow, widget('x'), { type: 'existing_row', rowId: 'r1' })).toBe(fullRow);
    expect(addDashboardWidget(fullRow, widget('x'), { type: 'existing_row', rowId: 'missing' })).toBe(fullRow);
  });
});

describe('moveDashboardWidget', () => {
  it('rebalances both rows when a widget changes rows', () => {
    const rows = [row('r1', [widget('p', 4), widget('t', 4), widget('n', 4)]), row('r2', [widget('t2')])];
    const result = moveDashboardWidget(rows, 'n', { type: 'existing_row', rowId: 'r2', index: 1 });

    expect(ids(result)).toEqual([
      ['p', 't'],
      ['t2', 'n'],
    ]);
    expect(widths(result)).toEqual([
      [6, 6],
      [6, 6],
    ]);
  });

  it('gives a lone widget joining a two-widget row a third', () => {
    const rows = [row('r1', [widget('p', 6), widget('n', 6)]), row('r2', [widget('t')])];
    const result = moveDashboardWidget(rows, 't', { type: 'existing_row', rowId: 'r1', index: 2 });

    expect(ids(result)).toEqual([['p', 'n', 't']]);
    expect(widths(result)).toEqual([[4, 4, 4]]);
  });

  it('keeps widths when reordering inside a row', () => {
    const rows = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 6)])];
    const result = moveDashboardWidget(rows, 'c', { type: 'existing_row', rowId: 'r1', index: 0 });

    expect(ids(result)).toEqual([['c', 'a', 'b']]);
    expect(widths(result)).toEqual([[6, 3, 3]]);
  });

  it('passes new-row moves through', () => {
    const rows = [row('r1', [widget('a', 6), widget('b', 6)], 500)];
    const result = moveDashboardWidget(rows, 'b', { type: 'new_row', rowIndex: 1 });

    expect(ids(result)).toEqual([['a'], ['b']]);
    expect(widths(result)).toEqual([[12], [12]]);
    expect(result[1].height).toBe(500);
  });

  it('returns the same rows for refused moves', () => {
    const rows = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)]), row('r2', [widget('e')])];

    expect(moveDashboardWidget(rows, 'e', { type: 'existing_row', rowId: 'r1' })).toBe(rows);
    expect(moveDashboardWidget(rows, 'e', { type: 'existing_row', rowId: 'missing' })).toBe(rows);
    expect(moveDashboardWidget(rows, 'missing', { type: 'existing_row', rowId: 'r2' })).toBe(rows);
  });
});

describe('duplicateDashboardWidget', () => {
  it('places an equally sized copy right after the source', () => {
    const rows = [row('r1', [widget('a', 6), widget('b', 6)])];
    const result = duplicateDashboardWidget(rows, 'a');

    expect(result[0].widgets).toHaveLength(3);
    expect(result[0].widgets[0].id).toBe('a');
    expect(result[0].widgets[2].id).toBe('b');
    expect(result[0].widgets[1]).toMatchObject({ viewId: 'view-a', databaseId: 'db' });
    expect(result[0].widgets[1].id).not.toBe('a');
    expect(widths(result)).toEqual([[4, 4, 4]]);
  });

  it('starts a new row right below a full row', () => {
    const rows = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)]), row('r2', [widget('e')])];
    const result = duplicateDashboardWidget(rows, 'c');

    expect(result.map((item) => item.widgets.length)).toEqual([4, 1, 1]);
    expect(result[1].widgets[0]).toMatchObject({ viewId: 'view-c', width: 12 });
    expect(result[2].id).toBe('r2');
  });

  it('refuses on a full dashboard or for an unknown widget', () => {
    const full = fullDashboard();
    const rows = [row('r1', [widget('a')])];

    expect(duplicateDashboardWidget(full, 'w0-0')).toBe(full);
    expect(duplicateDashboardWidget(rows, 'missing')).toBe(rows);
  });
});
