import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { measureContentWidth, useDashboardGridBreakpoints } from '../hooks/useDashboardGridBreakpoints';

type ResizeCallback = (entries: Array<{ contentRect: { width: number } }>) => void;

const observers: Array<{ callback: ResizeCallback; disconnect: jest.Mock; observe: jest.Mock }> = [];
const originalResizeObserver = window.ResizeObserver;
let elementWidth = 1200;
let renders = 0;

class MockResizeObserver {
  callback: ResizeCallback;
  observe = jest.fn();
  disconnect = jest.fn();

  constructor(callback: ResizeCallback) {
    this.callback = callback;
    observers.push(this);
  }
}

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const breakpoints = useDashboardGridBreakpoints(ref);

  renders += 1;
  return (
    <div
      data-min-columns={breakpoints ? breakpoints.minColumns.slice(1).join(',') : 'null'}
      data-testid='grid'
      data-wrap-columns={breakpoints ? breakpoints.wrapColumns.slice(1).join(',') : 'null'}
      ref={ref}
    />
  );
}

const grid = () => screen.getByTestId('grid');
/** The measured track: the content width plus the 6px box bleed on both sides. */
const trackWidth = () => grid().getAttribute('data-track-width');
/** Widgets per line of a row of 1, 2, 3 and 4 widgets. */
const wrapColumns = () => grid().getAttribute('data-wrap-columns');
/** Resize minimum of a row of 1, 2, 3 and 4 widgets. */
const minColumns = () => grid().getAttribute('data-min-columns');

function resizeObservedTo(width: number) {
  act(() => {
    observers.forEach((observer) => observer.callback([{ contentRect: { width } }]));
  });
}

function resizeListeners(spy: jest.SpyInstance) {
  return spy.mock.calls.filter(([type]) => type === 'resize');
}

beforeEach(() => {
  observers.length = 0;
  elementWidth = 1200;
  renders = 0;
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(
      () => ({ width: elementWidth, height: 100, top: 0, left: 0, right: elementWidth, bottom: 100 } as DOMRect)
    );
});

afterEach(() => {
  jest.restoreAllMocks();
  window.ResizeObserver = originalResizeObserver;
});

describe('useDashboardGridBreakpoints', () => {
  it('is null before the grid has a width (an unmeasured row never wraps)', () => {
    elementWidth = 0;
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    render(<Probe />);

    expect(trackWidth()).toBe('');
    expect(wrapColumns()).toBe('null');
    expect(minColumns()).toBe('null');
  });

  it('measures the grid on mount and follows the ResizeObserver', () => {
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    render(<Probe />);

    expect(trackWidth()).toBe('1212');
    expect(wrapColumns()).toBe('1,2,3,4');
    expect(minColumns()).toBe('3,3,3,3');
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(grid());

    // A 704px track: three widgets wrap to two per line, four to two by two.
    resizeObservedTo(692);
    expect(trackWidth()).toBe('704');
    expect(wrapColumns()).toBe('1,2,2,2');
    expect(minColumns()).toBe('5,5,5,5');
    resizeObservedTo(0);
    expect(trackWidth()).toBe('');
    expect(wrapColumns()).toBe('null');
  });

  it('re-renders only when a breakpoint changes, and still reports every measured width', () => {
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    render(<Probe />);
    const rendersAfterMount = renders;

    // The same wrap columns and resize minimum for every row size.
    resizeObservedTo(1201);
    resizeObservedTo(1220);
    expect(trackWidth()).toBe('1232');
    expect(renders).toBe(rendersAfterMount);

    resizeObservedTo(692);
    expect(renders).toBe(rendersAfterMount + 1);
  });

  it('listens to window resizes only in a browser without a ResizeObserver', () => {
    const addListener = jest.spyOn(window, 'addEventListener');
    const removeListener = jest.spyOn(window, 'removeEventListener');

    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    const observed = render(<Probe />);

    expect(resizeListeners(addListener)).toHaveLength(0);
    observed.unmount();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(resizeListeners(removeListener)).toHaveLength(0);

    // @ts-expect-error -- simulate a browser without ResizeObserver
    window.ResizeObserver = undefined;
    const fallback = render(<Probe />);

    expect(trackWidth()).toBe('1212');
    expect(resizeListeners(addListener)).toHaveLength(1);

    elementWidth = 940;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(trackWidth()).toBe('952');
    expect(wrapColumns()).toBe('1,2,3,2');

    fallback.unmount();
    expect(resizeListeners(removeListener)).toEqual([resizeListeners(addListener)[0].slice(0, 2)]);
  });
});

describe('measureContentWidth', () => {
  it('leaves out the horizontal padding (the grid box bleeds like its rows)', () => {
    const element = document.createElement('div');

    element.style.paddingLeft = '6px';
    element.style.paddingRight = '6px';
    elementWidth = 1244;

    expect(measureContentWidth(element)).toBe(1232);
  });

  it('is null for an element without a width', () => {
    elementWidth = 0;
    expect(measureContentWidth(document.createElement('div'))).toBeNull();
  });
});
