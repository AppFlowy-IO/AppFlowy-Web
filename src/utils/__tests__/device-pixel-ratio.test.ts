import { subscribeToDevicePixelRatio } from '../device-pixel-ratio';

interface FakeQuery {
  media: string;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
}

describe('subscribeToDevicePixelRatio', () => {
  const originalMatchMedia = window.matchMedia;
  const originalRatio = window.devicePixelRatio;
  let queries: FakeQuery[] = [];

  const fireChange = () => {
    const query = queries[queries.length - 1];
    const handler = query.addEventListener.mock.calls[0][1] as () => void;

    handler();
  };

  beforeEach(() => {
    queries = [];
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    window.matchMedia = jest.fn((media: string) => {
      const query: FakeQuery = { media, addEventListener: jest.fn(), removeEventListener: jest.fn() };

      queries.push(query);

      return query as unknown as MediaQueryList;
    }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, 'devicePixelRatio', { value: originalRatio, configurable: true });
  });

  it('serves every subscriber from one media query', () => {
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribeFirst = subscribeToDevicePixelRatio(first);
    const unsubscribeSecond = subscribeToDevicePixelRatio(second);

    expect(queries).toHaveLength(1);
    expect(queries[0].media).toBe('(resolution: 1dppx)');

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('notifies subscribers on a change and re-arms for the new ratio', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToDevicePixelRatio(listener);

    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    fireChange();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(queries[0].removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(queries).toHaveLength(2);
    expect(queries[1].media).toBe('(resolution: 2dppx)');

    unsubscribe();
  });

  it('stops watching once the last subscriber leaves', () => {
    const unsubscribe = subscribeToDevicePixelRatio(jest.fn());

    unsubscribe();

    expect(queries[0].removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    // A later subscriber starts a fresh query.
    const again = subscribeToDevicePixelRatio(jest.fn());

    expect(queries).toHaveLength(2);
    again();
  });

  it('is a no-op without matchMedia', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;

    const unsubscribe = subscribeToDevicePixelRatio(jest.fn());

    expect(queries).toHaveLength(0);
    expect(unsubscribe).not.toThrow();
  });
});
