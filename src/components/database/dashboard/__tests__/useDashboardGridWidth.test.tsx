import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { measureContentWidth, useDashboardGridWidth } from '../hooks/useDashboardGridWidth';

type ResizeCallback = (entries: Array<{ contentRect: { width: number } }>) => void;

const observers: Array<{ callback: ResizeCallback; disconnect: jest.Mock; observe: jest.Mock }> = [];
const originalResizeObserver = window.ResizeObserver;
let elementWidth = 1200;

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
  const width = useDashboardGridWidth(ref);

  return <div data-testid='grid' data-width={width === null ? 'null' : String(width)} ref={ref} />;
}

const widthAttribute = () => screen.getByTestId('grid').getAttribute('data-width');

function resizeObservedTo(width: number) {
  act(() => {
    observers.forEach((observer) => observer.callback([{ contentRect: { width } }]));
  });
}

beforeEach(() => {
  observers.length = 0;
  elementWidth = 1200;
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

describe('useDashboardGridWidth', () => {
  it('is null before the grid has a width (an unmeasured row never wraps)', () => {
    elementWidth = 0;
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    render(<Probe />);

    expect(widthAttribute()).toBe('null');
  });

  it('measures the grid on mount and follows the ResizeObserver', () => {
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    render(<Probe />);

    expect(widthAttribute()).toBe('1200');
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(screen.getByTestId('grid'));

    resizeObservedTo(692);
    expect(widthAttribute()).toBe('692');
    resizeObservedTo(0);
    expect(widthAttribute()).toBe('null');
  });

  it('falls back to window resizes without a ResizeObserver', () => {
    // @ts-expect-error -- simulate a browser without ResizeObserver
    window.ResizeObserver = undefined;
    render(<Probe />);
    expect(widthAttribute()).toBe('1200');

    elementWidth = 940;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(widthAttribute()).toBe('940');
  });

  it('disconnects and stops listening on unmount', () => {
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    const removeListener = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Probe />);

    unmount();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
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
