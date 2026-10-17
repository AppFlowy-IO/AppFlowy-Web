import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';

import {
  ListRowLayoutProvider,
  ListRowLayoutScope,
  resolveListRowLayout,
  useListRowLayout,
  useMeasuredListRowLayout,
} from '../ListRowLayout';

type ObserverCallback = (entries: Array<{ contentRect: { width: number } }>) => void;

function MeasuredProbe() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const layout = useMeasuredListRowLayout(element);

  return <div data-layout={layout} data-testid='probe' ref={setElement} style={{ paddingLeft: 56, paddingRight: 96 }} />;
}

function Echo() {
  return <span data-testid='echo'>{useListRowLayout()}</span>;
}

describe('resolveListRowLayout', () => {
  it('list_layout_constants.dart: narrow below a 480px content width (row minus the 40px gutter)', () => {
    expect(resolveListRowLayout(519)).toBe('narrow');
    expect(resolveListRowLayout(520)).toBe('wide');
    expect(resolveListRowLayout(1200)).toBe('wide');
  });

  it('keeps the desktop default for an unmeasured width', () => {
    expect(resolveListRowLayout(0)).toBe('wide');
    expect(resolveListRowLayout(-1)).toBe('wide');
  });
});

describe('useListRowLayout', () => {
  it('defaults to wide and reads the provided layout', () => {
    const { rerender } = render(<Echo />);

    expect(screen.getByTestId('echo').textContent).toBe('wide');

    rerender(
      <ListRowLayoutProvider value='narrow'>
        <Echo />
      </ListRowLayoutProvider>
    );
    expect(screen.getByTestId('echo').textContent).toBe('narrow');
  });
});

describe('useMeasuredListRowLayout', () => {
  const originalResizeObserver = global.ResizeObserver;
  const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const disconnect = jest.fn();
  let callbacks: ObserverCallback[];
  let observed: Element[];

  function mockClientWidth(width: number) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  }

  beforeEach(() => {
    callbacks = [];
    observed = [];
    disconnect.mockClear();
    global.ResizeObserver = class {
      constructor(callback: ObserverCallback) {
        callbacks.push(callback);
      }

      observe = (element: Element) => {
        observed.push(element);
      };

      unobserve = jest.fn();
      disconnect = disconnect;
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    if (clientWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor);
    } else {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it('observes the element once and stays wide while it has no width (jsdom)', () => {
    render(<MeasuredProbe />);

    const probe = screen.getByTestId('probe');

    expect(probe.getAttribute('data-layout')).toBe('wide');
    expect(observed).toEqual([probe]);
    expect(callbacks).toHaveLength(1);
  });

  it('measures on mount, so a narrow List never paints the wide layout first', () => {
    // 540 - 56 - 96 = 388 content px: narrow only once the padding is excluded.
    mockClientWidth(540);
    render(<MeasuredProbe />);

    expect(screen.getByTestId('probe').getAttribute('data-layout')).toBe('narrow');
  });

  it('follows the observed content width', () => {
    render(<MeasuredProbe />);

    const probe = screen.getByTestId('probe');

    act(() => callbacks[0]([{ contentRect: { width: 400 } }]));
    expect(probe.getAttribute('data-layout')).toBe('narrow');

    act(() => callbacks[0]([{ contentRect: { width: 1000 } }]));
    expect(probe.getAttribute('data-layout')).toBe('wide');

    // The latest entry of a batch wins.
    act(() => callbacks[0]([{ contentRect: { width: 1000 } }, { contentRect: { width: 300 } }]));
    expect(probe.getAttribute('data-layout')).toBe('narrow');

    act(() => callbacks[0]([{ contentRect: { width: 0 } }]));
    expect(probe.getAttribute('data-layout')).toBe('wide');
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<MeasuredProbe />);

    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('stays wide without a ResizeObserver', () => {
    global.ResizeObserver = undefined as unknown as typeof ResizeObserver;

    render(<MeasuredProbe />);
    expect(screen.getByTestId('probe').getAttribute('data-layout')).toBe('wide');
    expect(callbacks).toHaveLength(0);
  });

  it('ListRowLayoutScope measures its own box and re-renders only the layout consumers', () => {
    const childRenders = jest.fn();

    function Child() {
      childRenders();
      return <Echo />;
    }

    render(
      <ListRowLayoutScope className='w-full py-2' data-testid='scope' style={{ paddingInlineStart: 56 }}>
        <Child />
      </ListRowLayoutScope>
    );

    const scope = screen.getByTestId('scope');

    expect(scope.className).toBe('w-full py-2');
    expect(scope.style.paddingInlineStart).toBe('56px');
    expect(observed).toEqual([scope]);
    expect(screen.getByTestId('echo').textContent).toBe('wide');
    // The callback-ref render of the scope reuses the same children element.
    expect(childRenders).toHaveBeenCalledTimes(1);

    act(() => callbacks[0]([{ contentRect: { width: 400 } }]));
    expect(screen.getByTestId('echo').textContent).toBe('narrow');
    expect(childRenders).toHaveBeenCalledTimes(1);
  });
});
