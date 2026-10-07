/**
 * WP04 arrangement vectors of `dashboard-parity/wrap-and-split.json` (the
 * same bytes desktop reads): R-SPLIT (`split`), row moves (`row_moves`), row
 * controls (`row_controls`), drops (`drop`) and the widget menu (`menu`).
 */
import {
  addDashboardWidget,
  classifyDashboardMove,
  duplicateDashboardWidget,
  getDashboardAddToNewRowState,
  getDashboardDropFeedback,
  getDashboardDropIndicator,
  getDashboardRowControls,
  moveDashboardRow,
  moveDashboardWidget,
  normalizeDashboardRows,
  removeDashboardWidget,
  resolveDashboardDropPlacement,
  setDashboardRowHeight,
} from '@/application/database-yjs/dashboard-layout';
import {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DashboardDropIndicator,
  DashboardDropTarget,
  DashboardRow,
  DashboardWidgetPlacement,
} from '@/application/database-yjs/dashboard.type';
import {
  buildWidgetMenuEntries,
  canDuplicateWidget,
  getWidgetMoveTargets,
  WidgetMenuEntry,
  WidgetMoveTargets,
} from '@/components/database/dashboard/widget-moves';

import { loadParityFixture } from './dashboard-parity-helpers';

type FixtureRow = [string, [string, number][], number?];
type FixturePlacement =
  | { type: 'existing_row'; row_id: string; index?: number }
  | { type: 'new_row'; row_index?: number };
type FixtureOp =
  | { type: 'add'; widget: string; placement: FixturePlacement }
  | { type: 'remove'; widget: string }
  | { type: 'move'; widget: string; placement: FixturePlacement }
  | { type: 'duplicate'; widget: string }
  | { type: 'set_height'; row: string; height: number };

interface SplitVector {
  id: string;
  name: string;
  rows: FixtureRow[];
  op: FixtureOp;
  expect?: FixtureRow[];
  unchanged?: boolean;
  feedback?: 'noop' | 'blocked';
}

interface RowMoveVector {
  id: string;
  name: string;
  rows: FixtureRow[];
  row: string;
  delta: -1 | 1;
  expect?: FixtureRow[];
  unchanged?: boolean;
}

interface FixtureControls {
  move_up: boolean;
  move_down: boolean;
  add_to_row: 'enabled' | 'disabled' | 'hidden';
}

interface RowControlsVector {
  id: string;
  name: string;
  rows: FixtureRow[];
  controls: Record<string, FixtureControls>;
  add_to_new_row: 'enabled' | 'disabled';
}

type FixtureTarget =
  | { type: 'widget'; widget_id: string; edge: 'left' | 'right' }
  | { type: 'row_gap'; row_index: number };
type FixtureIndicator = { type: 'column'; row_id: string; boundary: number } | { type: 'row_gap'; row_index: number };

interface DropVector {
  id: string;
  name: string;
  rows: FixtureRow[];
  source: string;
  target: FixtureTarget;
  feedback: 'allowed' | 'blocked' | 'noop';
  placement: FixturePlacement | null;
  indicator: FixtureIndicator | null;
  expect?: FixtureRow[];
}

interface FixtureMenuEntry {
  id: string;
  group?: string;
  disabled: boolean;
  disabled_reason?: string;
  children?: FixtureMenuEntry[];
}

interface MenuVector {
  id: string;
  name: string;
  rows: FixtureRow[];
  widget: string;
  editing: boolean;
  move_targets: Record<'left' | 'right' | 'row_above' | 'row_below', FixturePlacement | null>;
  entries: FixtureMenuEntry[];
}

interface WrapAndSplitFixture {
  split: SplitVector[];
  row_moves: RowMoveVector[];
  row_controls: RowControlsVector[];
  drop: DropVector[];
  menu: MenuVector[];
}

const fixture = loadParityFixture<WrapAndSplitFixture>('wrap-and-split.json');

function decodeRows(rows: FixtureRow[]): DashboardRow[] {
  return rows.map(([id, widgets, height]) => ({
    id,
    height: height ?? DASHBOARD_DEFAULT_ROW_HEIGHT,
    widgets: widgets.map(([widgetId, width]) => ({ id: widgetId, viewId: `view-${widgetId}`, databaseId: 'db', width })),
  }));
}

function decodePlacement(placement: FixturePlacement): DashboardWidgetPlacement {
  if (placement.type === 'existing_row') {
    return placement.index === undefined
      ? { type: 'existing_row', rowId: placement.row_id }
      : { type: 'existing_row', rowId: placement.row_id, index: placement.index };
  }

  return placement.row_index === undefined ? { type: 'new_row' } : { type: 'new_row', rowIndex: placement.row_index };
}

function decodeTarget(target: FixtureTarget): DashboardDropTarget {
  return target.type === 'widget'
    ? { type: 'widget', widgetId: target.widget_id, edge: target.edge }
    : { type: 'row_gap', rowIndex: target.row_index };
}

function decodeIndicator(indicator: FixtureIndicator | null): DashboardDropIndicator | null {
  if (!indicator) return null;
  return indicator.type === 'column'
    ? { type: 'column', rowId: indicator.row_id, boundary: indicator.boundary }
    : { type: 'row_gap', rowIndex: indicator.row_index };
}

/** Row id, height, widget ids and widths, the fields the fixture compares. */
function shape(rows: DashboardRow[]) {
  return rows.map((row) => ({
    id: row.id,
    height: row.height,
    widgets: row.widgets.map((widget) => ({ id: widget.id, width: widget.width })),
  }));
}

/** `"*"` in the expected rows matches a generated id. */
function expectRows(actual: DashboardRow[], expected: FixtureRow[]) {
  const want = shape(decodeRows(expected));
  const got = shape(actual).map((row, rowIndex) => ({
    ...row,
    id: want[rowIndex]?.id === '*' ? '*' : row.id,
    widgets: row.widgets.map((widget, index) => ({
      ...widget,
      id: want[rowIndex]?.widgets[index]?.id === '*' ? '*' : widget.id,
    })),
  }));

  expect(got).toEqual(want);
}

function applyOp(rows: DashboardRow[], op: FixtureOp): DashboardRow[] {
  switch (op.type) {
    case 'add':
      return addDashboardWidget(
        rows,
        { id: op.widget, viewId: `view-${op.widget}`, databaseId: 'db', width: 12 },
        decodePlacement(op.placement)
      );
    case 'remove':
      return removeDashboardWidget(rows, op.widget);
    case 'move':
      return moveDashboardWidget(rows, op.widget, decodePlacement(op.placement));
    case 'duplicate':
      return duplicateDashboardWidget(rows, op.widget);
    case 'set_height':
      return setDashboardRowHeight(rows, op.row, op.height);
  }
}

function menuShape(entries: WidgetMenuEntry[]): FixtureMenuEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    group: entry.group,
    disabled: entry.disabled,
    ...(entry.disabledReason ? { disabled_reason: entry.disabledReason } : {}),
    ...(entry.children ? { children: entry.children.map((child) => ({ id: child.id, disabled: child.disabled })) } : {}),
  }));
}

function decodeMoveTargets(targets: MenuVector['move_targets']): WidgetMoveTargets {
  const decode = (placement: FixturePlacement | null) => (placement ? decodePlacement(placement) : null);

  return {
    left: decode(targets.left),
    right: decode(targets.right),
    rowAbove: decode(targets.row_above),
    rowBelow: decode(targets.row_below),
  };
}

describe('wrap-and-split.json split (R-SPLIT)', () => {
  it('covers S1 to S30', () => {
    expect(fixture.split.map((vector) => vector.id)).toEqual(Array.from({ length: 30 }, (_, index) => `S${index + 1}`));
  });

  it.each(fixture.split.map((vector) => [`${vector.id} ${vector.name}`, vector] as const))('%s', (_name, vector) => {
    const rows = decodeRows(vector.rows);
    const result = applyOp(rows, vector.op);

    if (vector.unchanged) {
      expect(shape(result)).toEqual(shape(rows));
    } else {
      expectRows(result, vector.expect ?? []);
      // An equal split survives normalization on every client unchanged.
      expect(shape(normalizeDashboardRows(result))).toEqual(shape(result));
    }

    if (vector.op.type === 'move') {
      expect(classifyDashboardMove(rows, vector.op.widget, decodePlacement(vector.op.placement))).toBe(
        vector.unchanged ? vector.feedback ?? 'noop' : 'allowed'
      );
    }
  });
});

describe('wrap-and-split.json row_moves', () => {
  it.each(fixture.row_moves.map((vector) => [`${vector.id} ${vector.name}`, vector] as const))('%s', (_name, vector) => {
    const rows = decodeRows(vector.rows);
    const result = moveDashboardRow(rows, vector.row, vector.delta);

    if (vector.unchanged) {
      expect(result).toBe(rows);
      return;
    }

    expectRows(result, vector.expect ?? []);
    // The row objects move as they are.
    result.forEach((row) => expect(rows).toContain(row));
  });
});

describe('wrap-and-split.json row_controls', () => {
  it.each(fixture.row_controls.map((vector) => [`${vector.id} ${vector.name}`, vector] as const))(
    '%s',
    (_name, vector) => {
      const rows = decodeRows(vector.rows);

      Object.entries(vector.controls).forEach(([rowId, controls]) => {
        expect({ rowId, ...getDashboardRowControls(rows, rowId) }).toEqual({
          rowId,
          moveUp: controls.move_up,
          moveDown: controls.move_down,
          addToRow: controls.add_to_row,
        });
      });
      expect(getDashboardAddToNewRowState(rows)).toBe(vector.add_to_new_row);
    }
  );
});

describe('wrap-and-split.json drop', () => {
  it.each(fixture.drop.map((vector) => [`${vector.id} ${vector.name}`, vector] as const))('%s', (_name, vector) => {
    const rows = decodeRows(vector.rows);
    const target = decodeTarget(vector.target);
    const placement = resolveDashboardDropPlacement(rows, vector.source, target);

    expect(getDashboardDropFeedback(rows, vector.source, target)).toBe(vector.feedback);
    expect(placement).toEqual(vector.placement ? decodePlacement(vector.placement) : null);
    expect(getDashboardDropIndicator(rows, vector.source, target)).toEqual(decodeIndicator(vector.indicator));

    if (vector.feedback === 'allowed') {
      expect(placement).not.toBeNull();
      expectRows(moveDashboardWidget(rows, vector.source, placement as DashboardWidgetPlacement), vector.expect ?? []);
    } else {
      expect(vector.expect).toBeUndefined();
    }
  });
});

describe('wrap-and-split.json menu', () => {
  it.each(fixture.menu.map((vector) => [`${vector.id} ${vector.name}`, vector] as const))('%s', (_name, vector) => {
    const rows = decodeRows(vector.rows);
    const moveTargets = getWidgetMoveTargets(rows, vector.widget);

    expect(moveTargets).toEqual(decodeMoveTargets(vector.move_targets));
    expect(
      menuShape(
        buildWidgetMenuEntries({
          editing: vector.editing,
          canDuplicate: canDuplicateWidget(rows, vector.widget),
          moveTargets,
        })
      )
    ).toEqual(vector.entries);
  });
});
