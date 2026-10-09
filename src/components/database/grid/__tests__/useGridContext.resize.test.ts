import {
  createGridRowResizeStore,
  DASHBOARD_WIDGET_GRID_OPTIONS,
  DEFAULT_GRID_OPTIONS,
} from '@/components/database/grid/useGridContext';

/** The ResizeObservers created, with what each observes. */
const observers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  readonly observed = new Set<Element>();

  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }

  observe(element: Element) {
    this.observed.add(element);
  }

  unobserve(element: Element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.observed.clear();
  }

  /** The browser reports a size change of `targets`. */
  fire(targets: Element[]) {
    this.callback(
      targets.map((target) => ({ target }) as ResizeObserverEntry),
      this as unknown as ResizeObserver
    );
  }
}

describe('Grid row measurement (W15, W18)', () => {
  const originalResizeObserver = global.ResizeObserver;

  beforeEach(() => {
    observers.length = 0;
    global.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.ResizeObserver = originalResizeObserver;
  });

  it('measures every row scheduled in a frame in one pass at the next frame, the last measure of a row only', () => {
    const store = createGridRowResizeStore();
    const reported: [string, number][] = [];
    const reads: string[] = [];

    store.subscribe((rowKey, height) => reported.push([rowKey, height]));
    store.schedule('row-1', () => {
      reads.push('row-1 first');
      return 36;
    });
    store.schedule('row-2', () => {
      reads.push('row-2');
      return 72;
    });
    store.schedule('row-1', () => {
      reads.push('row-1 last');
      return 40;
    });
    store.schedule('row-3', () => undefined);

    expect(reads).toEqual([]);
    jest.runOnlyPendingTimers();

    expect(reads).toEqual(['row-1 last', 'row-2']);
    // A row with nothing to measure reports nothing.
    expect(reported).toEqual([
      ['row-1', 40],
      ['row-2', 72],
    ]);
  });

  it('observes every row of a grid with one ResizeObserver', () => {
    const store = createGridRowResizeStore();
    const rows = [document.createElement('div'), document.createElement('div'), document.createElement('div')];
    const resized = rows.map(() => jest.fn());
    const stops = rows.map((row, index) => store.observe(row, resized[index]));

    expect(observers).toHaveLength(1);
    expect(observers[0].observed.size).toBe(3);

    observers[0].fire([rows[0], rows[2]]);
    expect(resized.map((callback) => callback.mock.calls.length)).toEqual([1, 0, 1]);

    stops[0]();
    observers[0].fire([rows[0]]);
    expect(resized[0]).toHaveBeenCalledTimes(1);
    expect(observers[0].observed.has(rows[0])).toBe(false);
  });

  it('keeps observing a row whose callback was replaced before the old one stopped', () => {
    const store = createGridRowResizeStore();
    const row = document.createElement('div');
    const first = jest.fn();
    const second = jest.fn();
    const stopFirst = store.observe(row, first);

    store.observe(row, second);
    stopFirst();
    observers[0].fire([row]);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('gives dashboard widget grids a small overscan and leaves other grids as they were', () => {
    expect(DASHBOARD_WIDGET_GRID_OPTIONS.rowOverscan).toBe(3);
    expect(DASHBOARD_WIDGET_GRID_OPTIONS.columnOverscan).toBe(2);
    // Unset: the virtualizer keeps its former 10 rows and 5 columns.
    expect(DEFAULT_GRID_OPTIONS.rowOverscan).toBeUndefined();
    expect(DEFAULT_GRID_OPTIONS.columnOverscan).toBeUndefined();
  });
});
