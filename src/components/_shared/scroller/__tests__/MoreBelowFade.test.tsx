import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { MoreBelowFade, useMoreContentBelow } from '../MoreBelowFade';

/** jsdom has no layout: the scroll area reports these sizes, everything else reports 0. */
const metrics = { scrollHeight: 600, clientHeight: 400 };
const resizeCallbacks: Array<() => void> = [];
const originals = {
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  ResizeObserver: global.ResizeObserver,
};

function measured(key: keyof typeof metrics) {
  return {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === 'area' ? metrics[key] : 0;
    },
  };
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', measured('scrollHeight'));
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', measured('clientHeight'));
  global.ResizeObserver = class {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback);
    }

    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  } as unknown as typeof ResizeObserver;
});

afterAll(() => {
  if (originals.scrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originals.scrollHeight);
  if (originals.clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originals.clientHeight);
  global.ResizeObserver = originals.ResizeObserver;
});

beforeEach(() => {
  metrics.scrollHeight = 600;
  metrics.clientHeight = 400;
  resizeCallbacks.length = 0;
});

function Area() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const moreBelow = useMoreContentBelow(element);

  return (
    <div ref={setElement} data-testid='area' style={{ overflowY: 'auto' }}>
      <div>Settings</div>
      <MoreBelowFade visible={moreBelow} />
    </div>
  );
}

function fade() {
  return screen.getByTestId('more-below-fade');
}

describe('more below fade', () => {
  it('shows while there is more to scroll to, and goes away at the end', () => {
    render(<Area />);
    expect(fade().getAttribute('data-visible')).toBe('true');
    // Decorative only: it never takes clicks or screen reader attention.
    expect(fade().getAttribute('aria-hidden')).toBe('true');
    expect(fade().className).toContain('pointer-events-none');

    const area = screen.getByTestId('area');

    area.scrollTop = 200;
    fireEvent.scroll(area);
    expect(fade().getAttribute('data-visible')).toBe('false');
    area.scrollTop = 120;
    fireEvent.scroll(area);
    expect(fade().getAttribute('data-visible')).toBe('true');
  });

  it('is hidden when everything fits, also after the content or window changes size', () => {
    metrics.scrollHeight = 400;
    render(<Area />);
    expect(fade().getAttribute('data-visible')).toBe('false');

    metrics.scrollHeight = 520;
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(fade().getAttribute('data-visible')).toBe('true');
  });

  it('ignores a rounding difference of a pixel', () => {
    metrics.scrollHeight = 401;
    render(<Area />);
    expect(fade().getAttribute('data-visible')).toBe('false');
  });
});
