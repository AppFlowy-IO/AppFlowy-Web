import { afterAll, beforeAll, jest } from '@jest/globals';

/** jsdom has no layout observer; browser tests cover the measured geometry. */
export function mockResizeObserver() {
  const original = global.ResizeObserver;

  beforeAll(() => {
    global.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    };
  });
  afterAll(() => {
    global.ResizeObserver = original;
  });
}
