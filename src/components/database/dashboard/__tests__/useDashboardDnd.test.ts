import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { act, renderHook } from '@testing-library/react';

import {
  getDashboardDropFeedback,
  moveDashboardWidget,
  resolveDashboardDropPlacement,
} from '@/application/database-yjs/dashboard-layout';
import { DashboardDropTarget, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { ViewLayout } from '@/application/types';

import { createDragGhostStore, createDropIndicatorStore } from '../arrange-stores';
import { DASHBOARD_ROW_GAP_DROP_TYPE, DASHBOARD_WIDGET_DRAG_TYPE, DASHBOARD_WIDGET_DROP_TYPE } from '../constants';
import {
  findDashboardDropTarget,
  parseDropTarget,
  useDashboardDndMonitor,
  useDraggableWidget,
  useRowGapDropTarget,
  useWidgetDropTarget,
} from '../hooks/useDashboardDnd';

type AnyConfig = Record<string, (...args: never[]) => unknown>;

// The adapter is replaced by a recorder: each test drives the registered callbacks itself.
const mockAdapter = {
  monitors: [] as AnyConfig[],
  dropTargets: [] as AnyConfig[],
  draggables: [] as AnyConfig[],
};

jest.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  monitorForElements: (config: AnyConfig) => {
    mockAdapter.monitors.push(config);
    return () => undefined;
  },
  dropTargetForElements: (config: AnyConfig) => {
    mockAdapter.dropTargets.push(config);
    return () => undefined;
  },
  draggable: (config: AnyConfig) => {
    mockAdapter.draggables.push(config);
    return () => undefined;
  },
}));

const mockDisableNativeDragPreview = jest.fn();

jest.mock('@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview', () => ({
  disableNativeDragPreview: (args: unknown) => mockDisableNativeDragPreview(args),
}));

jest.mock('@atlaskit/pragmatic-drag-and-drop-auto-scroll/element', () => ({
  autoScrollForElements: () => () => undefined,
}));

jest.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown> & { defaultValue?: string }) =>
    (options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name]));

  return { useTranslation: () => ({ t }) };
});

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

/** What a drop applies: the placement of an allowed drop, committed through `moveDashboardWidget`. */
function drop(rows: DashboardRow[], widgetId: string, target: DashboardDropTarget) {
  if (getDashboardDropFeedback(rows, widgetId, target) !== 'allowed') return rows;
  const placement = resolveDashboardDropPlacement(rows, widgetId, target);

  return placement ? moveDashboardWidget(rows, widgetId, placement) : rows;
}

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top } as DOMRect;
}

/** Drop-target data with the closest edge attached, as the widget target builds it. */
function widgetTargetData(instanceId: symbol, widgetId: string, edge: 'left' | 'right') {
  const element = document.createElement('div');

  element.getBoundingClientRect = () => rect(0, 0, 100, 100);
  return attachClosestEdge(
    { type: DASHBOARD_WIDGET_DROP_TYPE, instanceId, widgetId },
    {
      element,
      input: { clientX: edge === 'left' ? 10 : 90, clientY: 50 } as never,
      allowedEdges: ['left', 'right'],
    }
  );
}

function sourceData(instanceId: symbol, widgetId: string) {
  return { type: DASHBOARD_WIDGET_DRAG_TYPE, instanceId, widgetId };
}

beforeEach(() => {
  mockAdapter.monitors.length = 0;
  mockAdapter.dropTargets.length = 0;
  mockAdapter.draggables.length = 0;
  mockDisableNativeDragPreview.mockClear();
});

describe('getDashboardDropFeedback (drag-and-drop rules)', () => {
  const rows = makeRows(['a', 'b', 'c'], ['d'], ['e', 'f', 'g', 'h']);

  it('ignores drops of unknown widgets and onto unknown or identical widgets', () => {
    expect(getDashboardDropFeedback(rows, 'missing', { type: 'row_gap', rowIndex: 0 })).toBe('noop');
    expect(getDashboardDropFeedback(rows, 'a', { type: 'widget', widgetId: 'missing', edge: 'left' })).toBe('noop');
    expect(getDashboardDropFeedback(rows, 'a', { type: 'widget', widgetId: 'a', edge: 'right' })).toBe('noop');
  });

  it('treats dropping next to itself as no move', () => {
    expect(getDashboardDropFeedback(rows, 'b', { type: 'widget', widgetId: 'a', edge: 'right' })).toBe('noop');
    expect(getDashboardDropFeedback(rows, 'b', { type: 'widget', widgetId: 'c', edge: 'left' })).toBe('noop');
  });

  it('allows reordering inside a row, even a full one', () => {
    expect(getDashboardDropFeedback(rows, 'a', { type: 'widget', widgetId: 'c', edge: 'right' })).toBe('allowed');
    expect(getDashboardDropFeedback(rows, 'e', { type: 'widget', widgetId: 'h', edge: 'right' })).toBe('allowed');
  });

  it('allows moving into another row with room and blocks a full one', () => {
    expect(getDashboardDropFeedback(rows, 'a', { type: 'widget', widgetId: 'd', edge: 'left' })).toBe('allowed');
    expect(getDashboardDropFeedback(rows, 'd', { type: 'widget', widgetId: 'e', edge: 'left' })).toBe('blocked');
  });

  it('treats the gaps around a lone widget as no move (#15)', () => {
    expect(getDashboardDropFeedback(rows, 'd', { type: 'row_gap', rowIndex: 1 })).toBe('noop');
    expect(getDashboardDropFeedback(rows, 'd', { type: 'row_gap', rowIndex: 2 })).toBe('noop');
    expect(getDashboardDropFeedback(rows, 'd', { type: 'row_gap', rowIndex: 0 })).toBe('allowed');
    expect(getDashboardDropFeedback(rows, 'd', { type: 'row_gap', rowIndex: 3 })).toBe('allowed');
  });

  it('allows a shared widget into any gap, including the ones around its row', () => {
    expect(getDashboardDropFeedback(rows, 'a', { type: 'row_gap', rowIndex: 0 })).toBe('allowed');
    expect(getDashboardDropFeedback(rows, 'a', { type: 'row_gap', rowIndex: 1 })).toBe('allowed');
  });
});

describe('resolveDashboardDropPlacement', () => {
  it('applies nothing for refused or empty drops', () => {
    const rows = makeRows(['a'], ['b', 'c', 'd', 'e']);

    expect(getDashboardDropFeedback(rows, 'a', { type: 'widget', widgetId: 'b', edge: 'left' })).toBe('blocked');
    expect(drop(rows, 'a', { type: 'widget', widgetId: 'b', edge: 'left' })).toBe(rows);
    expect(getDashboardDropFeedback(rows, 'a', { type: 'row_gap', rowIndex: 1 })).toBe('noop');
    expect(drop(rows, 'a', { type: 'row_gap', rowIndex: 1 })).toBe(rows);
    expect(resolveDashboardDropPlacement(rows, 'a', { type: 'widget', widgetId: 'a', edge: 'left' })).toBeNull();
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

  it('moves a widget into another row at the dropped edge and splits both rows equally', () => {
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

    expect(ids(drop(rows, 'projects', { type: 'row_gap', rowIndex: 1 }))).toEqual([
      ['tasks', 'notes'],
      ['projects'],
      ['tasks2'],
    ]);
    expect(ids(drop(rows, 'tasks2', { type: 'row_gap', rowIndex: 0 }))).toEqual([
      ['tasks2'],
      ['projects', 'tasks', 'notes'],
    ]);
  });

  it('clamps gap indexes to the row list', () => {
    const rows = makeRows(['a', 'b'], ['c']);

    expect(resolveDashboardDropPlacement(rows, 'a', { type: 'row_gap', rowIndex: 99 })).toEqual({
      type: 'new_row',
      rowIndex: 2,
    });
    expect(resolveDashboardDropPlacement(rows, 'a', { type: 'row_gap', rowIndex: -3 })).toEqual({
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
      type: 'row_gap',
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

describe('useDashboardDndMonitor', () => {
  const instanceId = Symbol('dashboard');
  const rows = makeRows(['a', 'b', 'c', 'd'], ['e'], ['f', 'g']);

  function renderMonitor() {
    const onMove = jest.fn();
    const announce = jest.fn();
    const ghostStore = createDragGhostStore();
    const indicatorStore = createDropIndicatorStore();
    const hook = renderHook(() =>
      useDashboardDndMonitor({
        instanceId,
        enabled: true,
        getRows: () => rows,
        onMove,
        scrollContainerRef: { current: null },
        announce,
        ghostStore,
        indicatorStore,
      })
    );
    const monitor = mockAdapter.monitors[mockAdapter.monitors.length - 1];
    const dropOn = (widgetId: string, targets: Record<string | symbol, unknown>[]) =>
      act(() => {
        monitor.onDrop({
          source: { data: sourceData(instanceId, widgetId) },
          location: { current: { dropTargets: targets.map((data) => ({ data })) } },
        } as never);
      });

    return { ...hook, monitor, onMove, announce, ghostStore, indicatorStore, dropOn };
  }

  it('announces a blocked drop (a full row) with the row text and moves nothing', () => {
    const { dropOn, onMove, announce } = renderMonitor();

    dropOn('e', [widgetTargetData(instanceId, 'a', 'left')]);
    expect(announce.mock.calls).toEqual([['A row holds up to 4 widgets.']]);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('does nothing for a no-op drop: no move and no announcement', () => {
    const { dropOn, onMove, announce } = renderMonitor();

    dropOn('e', [{ type: DASHBOARD_ROW_GAP_DROP_TYPE, instanceId, rowIndex: 1 }]);
    dropOn('a', [widgetTargetData(instanceId, 'b', 'left')]);
    expect(onMove).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('moves the widget on an allowed drop', () => {
    const { dropOn, onMove } = renderMonitor();

    dropOn('e', [widgetTargetData(instanceId, 'g', 'right')]);
    expect(onMove.mock.calls).toEqual([['e', { type: 'existing_row', rowId: 'r3', index: 2 }]]);
  });

  it('reports the dragged widget, moves the ghost with the pointer and clears the ghost and the line on drop', () => {
    const { result, monitor, ghostStore, indicatorStore, dropOn } = renderMonitor();
    const element = document.createElement('div');

    act(() => {
      monitor.onDragStart({ source: { data: sourceData(instanceId, 'a') } } as never);
    });
    expect(result.current).toBe('a');
    ghostStore.start(
      { widgetId: 'a', name: 'A', layout: ViewLayout.Grid, width: 300, height: 360, offsetX: 20, offsetY: 10 },
      100,
      100
    );
    ghostStore.attach(element);
    act(() => {
      monitor.onDrag({ location: { current: { input: { clientX: 250, clientY: 300 } } } } as never);
    });
    expect(element.style.transform).toBe('translate3d(230px, 290px, 0)');
    indicatorStore.set({ widgetId: 'b', rowId: 'r1', left: 10, top: 40, height: 314 });

    dropOn('a', []);
    expect(result.current).toBeNull();
    expect(ghostStore.get()).toBeNull();
    expect(indicatorStore.get()).toBeNull();
  });
});

describe('useDraggableWidget', () => {
  it('turns off the browser drag image and starts the ghost at the box size, grabbed where the pointer went down', () => {
    const instanceId = Symbol('dashboard');
    const handle = document.createElement('div');
    const box = document.createElement('div');
    const ghostStore = createDragGhostStore();

    box.getBoundingClientRect = () => rect(100, 50, 300, 360);
    renderHook(() =>
      useDraggableWidget({
        handle,
        widgetId: 'w1',
        instanceId,
        enabled: true,
        label: 'Tasks Grid',
        layout: ViewLayout.Board,
        getBoxElement: () => box,
        ghostStore,
      })
    );
    const config = mockAdapter.draggables[mockAdapter.draggables.length - 1];
    const nativeSetDragImage = jest.fn();

    expect(config.getInitialData({} as never)).toEqual(sourceData(instanceId, 'w1'));
    config.onGenerateDragPreview({ nativeSetDragImage } as never);
    expect(mockDisableNativeDragPreview).toHaveBeenCalledWith({ nativeSetDragImage });

    config.onDragStart({ location: { initial: { input: { clientX: 130, clientY: 70 } } } } as never);
    expect(ghostStore.get()).toEqual({
      widgetId: 'w1',
      name: 'Tasks Grid',
      layout: ViewLayout.Board,
      width: 300,
      height: 360,
      offsetX: 30,
      offsetY: 20,
    });
  });
});

describe('useWidgetDropTarget', () => {
  const instanceId = Symbol('dashboard');
  const rows = makeRows(['a', 'b', 'c'], ['d'], ['e', 'f', 'g', 'h']);

  /** Widget `b` of row r1: its box at (406, 20) 300×360 inside the row element at (100, 10). */
  function renderTarget(widgetId = 'b', cardTop = 40) {
    const row = document.createElement('div');
    const element = document.createElement('div');
    const indicatorStore = createDropIndicatorStore();

    row.setAttribute('data-testid', 'dashboard-row');
    row.appendChild(element);
    document.body.appendChild(row);
    row.getBoundingClientRect = () => rect(100, 10, 1000, 400);
    element.getBoundingClientRect = () => rect(406, 20, 300, 360);
    renderHook(() =>
      useWidgetDropTarget({
        elementRef: { current: element },
        widgetId,
        instanceId,
        enabled: true,
        getRows: () => rows,
        indicatorStore,
        cardTop,
      })
    );
    const config = mockAdapter.dropTargets[mockAdapter.dropTargets.length - 1];
    const over = (source: string, edge: 'left' | 'right', callback: 'onDragEnter' | 'onDrag' = 'onDragEnter') =>
      config[callback]({
        self: { data: widgetTargetData(instanceId, widgetId, edge) },
        source: { data: sourceData(instanceId, source) },
      } as never);

    return { config, indicatorStore, over, cleanup: () => row.remove() };
  }

  it('accepts other widgets only', () => {
    const { config, cleanup } = renderTarget();

    expect(config.canDrop({ source: { data: sourceData(instanceId, 'a') } } as never)).toBe(true);
    expect(config.canDrop({ source: { data: sourceData(instanceId, 'b') } } as never)).toBe(false);
    cleanup();
  });

  it('draws the line in the centre of the gap at the dropped edge, over the card (box − 46 tall, 40 down)', () => {
    const { indicatorStore, over, cleanup } = renderTarget();

    over('a', 'right');
    expect(indicatorStore.get()).toEqual({ widgetId: 'b', rowId: 'r1', left: 406 + 300 + 6 - 100, top: 50, height: 314 });
    over('c', 'left', 'onDrag');
    expect(indicatorStore.get()).toEqual({ widgetId: 'b', rowId: 'r1', left: 406 - 6 - 100, top: 50, height: 314 });
    cleanup();
  });

  it('starts the line under the box padding when titles are hidden', () => {
    const { indicatorStore, over, cleanup } = renderTarget('b', 6);

    over('a', 'right');
    expect(indicatorStore.get()).toMatchObject({ top: 16, height: 348 });
    cleanup();
  });

  it('draws nothing for a no-op or a blocked target, and clears the line on leave and on drop', () => {
    const { config, indicatorStore, over, cleanup } = renderTarget();

    over('a', 'left');
    expect(indicatorStore.get()).toBeNull();
    over('a', 'right');
    expect(indicatorStore.get()).not.toBeNull();
    act(() => {
      config.onDragLeave({} as never);
    });
    expect(indicatorStore.get()).toBeNull();
    over('a', 'right');
    act(() => {
      config.onDrop({} as never);
    });
    expect(indicatorStore.get()).toBeNull();
    cleanup();

    const full = renderTarget('e');

    full.over('d', 'left');
    expect(full.indicatorStore.get()).toBeNull();
    full.cleanup();
  });
});

describe('useRowGapDropTarget', () => {
  const instanceId = Symbol('dashboard');
  const rows = makeRows(['a', 'b'], ['c']);

  function canDropInto(rowIndex: number, widgetId: string) {
    renderHook(() =>
      useRowGapDropTarget({
        elementRef: { current: document.createElement('div') },
        rowIndex,
        instanceId,
        enabled: true,
        getRows: () => rows,
      })
    );
    const config = mockAdapter.dropTargets[mockAdapter.dropTargets.length - 1];

    return config.canDrop({ source: { data: sourceData(instanceId, widgetId) } } as never);
  }

  it('refuses the gaps right above and below a lone widget (#15) and takes the others', () => {
    expect(canDropInto(1, 'c')).toBe(false);
    expect(canDropInto(2, 'c')).toBe(false);
    expect(canDropInto(0, 'c')).toBe(true);
    expect(canDropInto(1, 'a')).toBe(true);
  });
});
