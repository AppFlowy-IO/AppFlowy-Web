import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { DASHBOARD_STACK_BREAKPOINT } from '@/application/database-yjs/dashboard.type';
import { DASHBOARD_STACK_CONTAINER_BREAKPOINT } from '@/components/database/dashboard/constants';

import { isStackedLayout, isStackedWidth, StackedLayoutBreakpoints, useStackedLayout } from '../hooks/useStackedLayout';

type ResizeCallback = (entries: Array<{ contentRect: { width: number } }>) => void;

const observers: Array<{ callback: ResizeCallback; disconnect: jest.Mock; observe: jest.Mock }> = [];
const originalResizeObserver = window.ResizeObserver;
const originalInnerWidth = window.innerWidth;
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

function Probe(breakpoints: StackedLayoutBreakpoints) {
  const ref = useRef<HTMLDivElement>(null);
  const stacked = useStackedLayout(ref, breakpoints);

  return <div data-stacked={String(stacked)} data-testid='grid' ref={ref} />;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function resizeContainerTo(width: number) {
  act(() => {
    observers.forEach((observer) => observer.callback([{ contentRect: { width } }]));
  });
}

function resizeWindowTo(viewport: number, container: number) {
  setViewportWidth(viewport);
  elementWidth = container;
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

const stackedAttribute = () => screen.getByTestId('grid').getAttribute('data-stacked');

beforeEach(() => {
  observers.length = 0;
  elementWidth = 1200;
  setViewportWidth(1440);
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(
      () => ({ width: elementWidth, height: 100, top: 0, left: 0, right: elementWidth, bottom: 100 } as DOMRect)
    );
});

afterEach(() => {
  jest.restoreAllMocks();
  window.ResizeObserver = originalResizeObserver;
  setViewportWidth(originalInnerWidth);
});

describe('isStackedWidth', () => {
  it('is true strictly below the breakpoint and ignores unmeasured widths', () => {
    expect(isStackedWidth(DASHBOARD_STACK_BREAKPOINT - 1)).toBe(true);
    expect(isStackedWidth(DASHBOARD_STACK_BREAKPOINT)).toBe(false);
    expect(isStackedWidth(0)).toBe(false);
    expect(isStackedWidth(500, 400)).toBe(false);
  });
});

describe('isStackedLayout', () => {
  it('stacks on a narrow viewport', () => {
    expect(isStackedLayout({ viewportWidth: 600, containerWidth: 600 })).toBe(true);
    expect(isStackedLayout({ viewportWidth: DASHBOARD_STACK_BREAKPOINT, containerWidth: 600 })).toBe(false);
  });

  it('keeps a desktop window side by side although its grid is narrower than the viewport breakpoint', () => {
    // 1200px window - 268px sidebar - 2 x 96px padding.
    expect(isStackedLayout({ viewportWidth: 1200, containerWidth: 740 })).toBe(false);
  });

  it('stacks a narrow grid on a wide screen', () => {
    expect(isStackedLayout({ viewportWidth: 1440, containerWidth: DASHBOARD_STACK_CONTAINER_BREAKPOINT - 1 })).toBe(
      true
    );
    expect(isStackedLayout({ viewportWidth: 1440, containerWidth: 0 })).toBe(false);
  });

  it('honours custom breakpoints', () => {
    expect(isStackedLayout({ viewportWidth: 600, containerWidth: 600 }, { viewportBreakpoint: 500 })).toBe(false);
    expect(isStackedLayout({ viewportWidth: 1440, containerWidth: 600 }, { containerBreakpoint: 700 })).toBe(true);
  });
});

describe('useStackedLayout', () => {
  beforeEach(() => {
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  it('measures the viewport and the container on mount', () => {
    setViewportWidth(600);
    render(<Probe />);

    expect(stackedAttribute()).toBe('true');
    expect(observers[0].observe).toHaveBeenCalledWith(screen.getByTestId('grid'));
  });

  it('does not stack a desktop-width grid below the viewport breakpoint', () => {
    elementWidth = 740;
    setViewportWidth(1200);
    render(<Probe />);

    expect(stackedAttribute()).toBe('false');
  });

  it('follows the container width', () => {
    render(<Probe />);

    expect(stackedAttribute()).toBe('false');
    resizeContainerTo(DASHBOARD_STACK_CONTAINER_BREAKPOINT - 80);
    expect(stackedAttribute()).toBe('true');
    resizeContainerTo(1200);
    expect(stackedAttribute()).toBe('false');
  });

  it('follows the viewport width', () => {
    render(<Probe />);

    resizeWindowTo(600, 560);
    expect(stackedAttribute()).toBe('true');
    resizeWindowTo(1440, 1000);
    expect(stackedAttribute()).toBe('false');
  });

  it('honours custom breakpoints', () => {
    setViewportWidth(600);
    render(<Probe viewportBreakpoint={500} />);

    expect(stackedAttribute()).toBe('false');
  });

  it('cleans up on unmount', () => {
    const removeListener = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Probe />);

    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('falls back to window resizes without ResizeObserver', () => {
    (window as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined;
    render(<Probe />);

    expect(stackedAttribute()).toBe('false');
    resizeWindowTo(1440, DASHBOARD_STACK_CONTAINER_BREAKPOINT - 80);
    expect(stackedAttribute()).toBe('true');
  });
});
