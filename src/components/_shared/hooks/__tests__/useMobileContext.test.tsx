import { act, renderHook } from '@testing-library/react';

import {
  isMobileContext,
  MOBILE_CONTEXT_BREAKPOINT,
  useCoarsePointer,
  useMobileContext,
} from '@/components/_shared/hooks';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const initialWidth = window.innerWidth;

function setInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function resizeTo(width: number) {
  act(() => {
    setInnerWidth(width);
    window.dispatchEvent(new Event('resize'));
  });
}

afterEach(() => {
  setInnerWidth(initialWidth);
  jest.restoreAllMocks();
});

describe('isMobileContext', () => {
  it('is a mobile context below 768px or with a mobile user agent', () => {
    expect(MOBILE_CONTEXT_BREAKPOINT).toBe(768);
    expect(isMobileContext(767, false)).toBe(true);
    expect(isMobileContext(768, false)).toBe(false);
    expect(isMobileContext(1024, true)).toBe(true);
    // A page that is not laid out yet.
    expect(isMobileContext(0, false)).toBe(false);
  });
});

describe('useMobileContext', () => {
  it('reads the viewport width: 767 is mobile, 768 is not', () => {
    setInnerWidth(767);
    expect(renderHook(() => useMobileContext()).result.current).toBe(true);

    setInnerWidth(768);
    expect(renderHook(() => useMobileContext()).result.current).toBe(false);
  });

  it('follows a resize across the breakpoint without a remount', () => {
    setInnerWidth(1440);
    const { result } = renderHook(() => useMobileContext());

    expect(result.current).toBe(false);
    resizeTo(390);
    expect(result.current).toBe(true);
    resizeTo(1440);
    expect(result.current).toBe(false);
  });

  it('follows an orientation change', () => {
    setInnerWidth(1024);
    const { result } = renderHook(() => useMobileContext());

    act(() => {
      setInnerWidth(700);
      window.dispatchEvent(new Event('orientationchange'));
    });
    expect(result.current).toBe(true);
  });

  it('treats a mobile user agent as a mobile context at any width', () => {
    jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
    setInnerWidth(1024);

    expect(renderHook(() => useMobileContext()).result.current).toBe(true);
  });

  it('keeps the shared listener until the last subscriber leaves', () => {
    setInnerWidth(1440);
    const first = renderHook(() => useMobileContext());
    const second = renderHook(() => useMobileContext());

    first.unmount();
    resizeTo(390);
    expect(second.result.current).toBe(true);
  });
});

describe('useCoarsePointer', () => {
  it('is false where matchMedia does not exist (jsdom)', () => {
    expect(window.matchMedia).toBeUndefined();
    expect(renderHook(() => useCoarsePointer()).result.current).toBe(false);
  });

  it('follows the (pointer: coarse) media query', () => {
    let listener: (() => void) | undefined;
    const query = {
      matches: true,
      addEventListener: jest.fn((_type: string, next: () => void) => {
        listener = next;
      }),
      removeEventListener: jest.fn(),
    };
    const matchMedia = jest.fn(() => query);

    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });

    try {
      const { result, unmount } = renderHook(() => useCoarsePointer());

      expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)');
      expect(result.current).toBe(true);

      act(() => {
        query.matches = false;
        listener?.();
      });
      expect(result.current).toBe(false);

      unmount();
      expect(query.removeEventListener).toHaveBeenCalledWith('change', listener);
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});
