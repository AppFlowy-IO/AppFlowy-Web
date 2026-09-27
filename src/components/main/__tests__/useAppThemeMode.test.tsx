import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';

import { useAppThemeMode } from '../useAppThemeMode';

describe('useAppThemeMode subscriptions', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => localStorage.clear());
  afterEach(() => { window.matchMedia = originalMatchMedia; });

  it('keeps one active listener through Strict Mode and removes it on unmount', () => {
    const targets: { matches: boolean; listeners: Set<() => void> }[] = [];

    window.matchMedia = jest.fn(() => {
      const target = { matches: false, listeners: new Set<() => void>() };

      targets.push(target);
      return {
        get matches() { return target.matches; },
        addEventListener: (_: string, listener: () => void) => target.listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => target.listeners.delete(listener),
      } as unknown as MediaQueryList;
    });
    const listenerCount = () => targets.reduce((sum, target) => sum + target.listeners.size, 0);
    const { result, unmount } = renderHook(() => useAppThemeMode(), { wrapper: StrictMode });

    expect(listenerCount()).toBe(1);
    act(() => {
      targets.forEach((target) => {
        target.matches = true;
        target.listeners.forEach((listener) => listener());
      });
    });
    expect(result.current.isDark).toBe(true);
    unmount();
    expect(listenerCount()).toBe(0);
  });
});
