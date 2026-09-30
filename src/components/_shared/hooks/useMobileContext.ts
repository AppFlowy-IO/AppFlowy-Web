import { useSyncExternalStore } from 'react';

import { getPlatform } from '@/utils/platform';

/**
 * Below this viewport width a web page is a mobile context: dashboards are
 * view-only and touch surfaces replace popovers. The desktop app never has a
 * mobile context whatever its window width; Flutter mobile always has one.
 */
export const MOBILE_CONTEXT_BREAKPOINT = 768;

/**
 * A mobile user agent (phones and tablets, like the Flutter mobile app) or a
 * viewport narrower than {@link MOBILE_CONTEXT_BREAKPOINT}. A width of 0 (a
 * page not laid out yet) is not a mobile context.
 */
export function isMobileContext(width: number, mobileUserAgent: boolean): boolean {
  return mobileUserAgent || (width > 0 && width < MOBILE_CONTEXT_BREAKPOINT);
}

function readMobileContext(): boolean {
  if (typeof window === 'undefined') return false;
  return isMobileContext(window.innerWidth, getPlatform().isMobile);
}

// One pair of window listeners shared by every subscriber.
const viewportListeners = new Set<() => void>();

function notifyViewportListeners() {
  viewportListeners.forEach((listener) => listener());
}

function subscribeViewport(listener: () => void) {
  viewportListeners.add(listener);
  if (viewportListeners.size === 1) {
    window.addEventListener('resize', notifyViewportListeners);
    window.addEventListener('orientationchange', notifyViewportListeners);
  }

  return () => {
    viewportListeners.delete(listener);
    if (viewportListeners.size === 0) {
      window.removeEventListener('resize', notifyViewportListeners);
      window.removeEventListener('orientationchange', notifyViewportListeners);
    }
  };
}

const serverSnapshot = () => false;

/**
 * Whether the page is a mobile context, live: resizing across the breakpoint
 * re-renders the caller without a reload. Reads `innerWidth` rather than
 * `matchMedia`, which jsdom does not implement.
 */
export function useMobileContext(): boolean {
  return useSyncExternalStore(subscribeViewport, readMobileContext, serverSnapshot);
}

const COARSE_POINTER_QUERY = '(pointer: coarse)';

function coarsePointerQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(COARSE_POINTER_QUERY);
}

function readCoarsePointer(): boolean {
  return coarsePointerQuery()?.matches ?? false;
}

function subscribeCoarsePointer(listener: () => void) {
  const query = coarsePointerQuery();

  if (!query) return () => undefined;
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** Whether the primary pointer is coarse (a finger); `false` where `matchMedia` is missing. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeCoarsePointer, readCoarsePointer, serverSnapshot);
}
