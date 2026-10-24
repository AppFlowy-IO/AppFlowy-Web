/**
 * One shared watcher for the device pixel ratio (browser zoom, or a window
 * dragged to a screen with another density), so that every image decoded at
 * its display size does not register its own `window` listener and re-measure
 * on each resize event.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let query: MediaQueryList | null = null;

function disarm(): void {
  query?.removeEventListener('change', onRatioChange);
  query = null;
}

function arm(): void {
  disarm();
  // `(resolution: Xdppx)` matches only the current ratio, so its `change`
  // event fires exactly when the ratio moves; re-arm for the new ratio then.
  query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  query.addEventListener('change', onRatioChange);
}

function onRatioChange(): void {
  arm();
  listeners.forEach((listener) => listener());
}

/** Calls `listener` whenever the device pixel ratio changes; returns the unsubscribe. */
export function subscribeToDevicePixelRatio(listener: Listener): () => void {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';

  if (supported && listeners.size === 0) arm();
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) disarm();
  };
}
