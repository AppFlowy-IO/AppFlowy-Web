import { type MutableRefObject, useLayoutEffect, useRef } from 'react';

/**
 * A ref that always holds the latest `value`, for callbacks that must read
 * fresh props or state without being recreated on every render. The ref is
 * updated after commit, so read it from event handlers and effects, never
 * during render.
 */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);

  useLayoutEffect(() => {
    ref.current = value;
  });

  return ref;
}
