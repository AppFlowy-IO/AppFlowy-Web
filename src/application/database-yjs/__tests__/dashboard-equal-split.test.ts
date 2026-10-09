import {
  addDashboardWidget,
  duplicateDashboardWidget,
  moveDashboardWidget,
  normalizeDashboardRows,
  removeDashboardWidget,
  splitDashboardRowEqually,
} from '../dashboard-layout';
import { DashboardRow, DashboardWidget } from '../dashboard.type';

// R-SPLIT (WP04 §1.1): a widget that joins or leaves a row splits the row
// equally, discarding earlier custom widths as Notion does; a reorder inside
// a row keeps every width.

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

describe('splitDashboardRowEqually', () => {
  it('gives every widget the same share of twelve columns', () => {
    expect(splitDashboardRowEqually([widget('a', 5)]).map((item) => item.width)).toEqual([12]);
    expect(splitDashboardRowEqually([widget('a', 8), widget('b', 4)]).map((item) => item.width)).toEqual([6, 6]);
    expect(splitDashboardRowEqually([widget('a', 8), widget('b', 2), widget('c', 2)]).map((item) => item.width)).toEqual(
      [4, 4, 4]
    );
    expect(
      splitDashboardRowEqually([widget('a', 6), widget('b', 2), widget('c', 2), widget('d', 2)]).map(
        (item) => item.width
      )
    ).toEqual([3, 3, 3, 3]);
  });

  it('returns the same list, and keeps every widget that already has its share', () => {
    const even = [widget('a', 6), widget('b', 6)];
    const uneven = [widget('a', 4), widget('b', 8)];
    const split = splitDashboardRowEqually(uneven);

    expect(splitDashboardRowEqually(even)).toBe(even);
    expect(splitDashboardRowEqually([])).toEqual([]);
    expect(split).not.toBe(uneven);
    expect(split[0]).not.toBe(uneven[0]);
    expect(split[0]).toEqual(widget('a', 6));
    expect(uneven.map((item) => item.width)).toEqual([4, 8]);
  });

  it('balances a count twelve does not divide, still summing to twelve', () => {
    const five = splitDashboardRowEqually(['a', 'b', 'c', 'd', 'e'].map((id) => widget(id, 1)));

    expect(five.reduce((sum, item) => sum + item.width, 0)).toBe(12);
    expect(Math.max(...five.map((item) => item.width)) - Math.min(...five.map((item) => item.width))).toBeLessThan(2);
  });

  it('is a fixed point of normalization', () => {
    [1, 2, 3, 4].forEach((count) => {
      const rows = [
        row('r', splitDashboardRowEqually(Array.from({ length: count }, (_, index) => widget(`w${index}`)))),
      ];

      expect(normalizeDashboardRows(rows)).toEqual(rows);
    });
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

  it('turns 8 + 4 plus one into 4 / 4 / 4 (Notion)', () => {
    const rows = [row('r1', [widget('a', 8), widget('b', 4)])];

    expect(widths(addDashboardWidget(rows, widget('x'), { type: 'existing_row', rowId: 'r1' }))).toEqual([[4, 4, 4]]);
  });

  it('turns 9 + 3 plus one in the middle into 4 / 4 / 4', () => {
    const rows = [row('r1', [widget('a', 9), widget('b', 3)])];
    const result = addDashboardWidget(rows, widget('x'), { type: 'existing_row', rowId: 'r1', index: 1 });

    expect(ids(result)).toEqual([['a', 'x', 'b']]);
    expect(widths(result)).toEqual([[4, 4, 4]]);
  });

  it('adds a full-width row for new-row placements and leaves the other rows alone', () => {
    const rows = [row('r1', [widget('a', 8), widget('b', 4)])];
    const result = addDashboardWidget(rows, widget('x', 3), { type: 'new_row', rowIndex: 0 });

    expect(ids(result)).toEqual([['x'], ['a', 'b']]);
    expect(widths(result)).toEqual([[12], [8, 4]]);
  });

  it('returns the same rows when the limits refuse the add', () => {
    const full = fullDashboard();
    const fullRow = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)])];

    expect(addDashboardWidget(full, widget('x'))).toBe(full);
    expect(addDashboardWidget(fullRow, widget('x'), { type: 'existing_row', rowId: 'r1' })).toBe(fullRow);
    expect(addDashboardWidget(fullRow, widget('x'), { type: 'existing_row', rowId: 'missing' })).toBe(fullRow);
  });
});

describe('removeDashboardWidget', () => {
  it('splits the rest of a row of three into halves', () => {
    const rows = [row('r1', [widget('a', 4), widget('b', 4), widget('c', 4)])];

    expect(widths(removeDashboardWidget(rows, 'b'))).toEqual([[6, 6]]);
  });

  it('splits 8 / 2 / 2 minus one into halves, not 10 / 2', () => {
    const rows = [row('r1', [widget('a', 8), widget('b', 2), widget('c', 2)])];

    expect(widths(removeDashboardWidget(rows, 'c'))).toEqual([[6, 6]]);
  });

  it('leaves the other rows alone', () => {
    const rows = [
      row('r1', [widget('a', 4), widget('b', 4), widget('c', 4)]),
      row('r2', [widget('d', 9), widget('e', 3)]),
    ];

    expect(widths(removeDashboardWidget(rows, 'a'))).toEqual([
      [6, 6],
      [9, 3],
    ]);
  });
});

describe('moveDashboardWidget', () => {
  it('splits both rows equally when a widget changes rows', () => {
    const rows = [row('r1', [widget('a', 8), widget('b', 4)]), row('r2', [widget('c', 9), widget('d', 3)])];
    const result = moveDashboardWidget(rows, 'a', { type: 'existing_row', rowId: 'r2', index: 0 });

    expect(ids(result)).toEqual([['b'], ['a', 'c', 'd']]);
    expect(widths(result)).toEqual([[12], [4, 4, 4]]);
  });

  it('keeps widths when reordering inside a row', () => {
    const rows = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 6)])];
    const result = moveDashboardWidget(rows, 'c', { type: 'existing_row', rowId: 'r1', index: 0 });

    expect(ids(result)).toEqual([['c', 'a', 'b']]);
    expect(widths(result)).toEqual([[6, 3, 3]]);
  });

  it('splits the source row when the widget starts a new row, at the source row height', () => {
    const rows = [row('r1', [widget('a', 4), widget('b', 2), widget('c', 6)], 500)];
    const result = moveDashboardWidget(rows, 'b', { type: 'new_row', rowIndex: 1 });

    expect(ids(result)).toEqual([['a', 'c'], ['b']]);
    expect(widths(result)).toEqual([[6, 6], [12]]);
    expect(result[1].height).toBe(500);
  });

  it('returns the input rows for a widget alone in its row put back next to that row (#15)', () => {
    const rows = [row('r1', [widget('a', 6), widget('b', 6)]), row('r2', [widget('c')])];

    expect(moveDashboardWidget(rows, 'c', { type: 'new_row', rowIndex: 1 })).toBe(rows);
    expect(moveDashboardWidget(rows, 'c', { type: 'new_row', rowIndex: 2 })).toBe(rows);
    expect(moveDashboardWidget(rows, 'c', { type: 'new_row' })).toBe(rows);
    expect(moveDashboardWidget(rows, 'c', { type: 'new_row', rowIndex: 0 })).not.toBe(rows);
  });

  it('returns the same rows for refused moves', () => {
    const rows = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)]), row('r2', [widget('e')])];

    expect(moveDashboardWidget(rows, 'e', { type: 'existing_row', rowId: 'r1' })).toBe(rows);
    expect(moveDashboardWidget(rows, 'e', { type: 'existing_row', rowId: 'missing' })).toBe(rows);
    expect(moveDashboardWidget(rows, 'missing', { type: 'existing_row', rowId: 'r2' })).toBe(rows);
  });
});

describe('duplicateDashboardWidget', () => {
  it('places the copy right after the source and splits the row equally', () => {
    const rows = [row('r1', [widget('a', 8), widget('b', 4)])];
    const result = duplicateDashboardWidget(rows, 'a');

    expect(result[0].widgets).toHaveLength(3);
    expect(result[0].widgets[0].id).toBe('a');
    expect(result[0].widgets[2].id).toBe('b');
    expect(result[0].widgets[1]).toMatchObject({ viewId: 'view-a', databaseId: 'db' });
    expect(result[0].widgets[1].id).not.toBe('a');
    expect(widths(result)).toEqual([[4, 4, 4]]);
  });

  it('starts a new full-width row right below a full row, which keeps its widths', () => {
    const rows = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)]), row('r2', [widget('e')])];
    const result = duplicateDashboardWidget(rows, 'c');

    expect(result.map((item) => item.widgets.length)).toEqual([4, 1, 1]);
    expect(widths(result)[0]).toEqual([3, 3, 3, 3]);
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
