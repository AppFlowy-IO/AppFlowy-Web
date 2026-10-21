import { createContext, useContext, useLayoutEffect, useRef } from 'react';

import { Log } from '@/utils/log';

type NavigationGuard = () => boolean | Promise<boolean>;

/** Menus and higher dialogs own keyboard shortcuts; closed MUI popovers do not. */
export function hasRowPeekOverlay(container: HTMLElement | null) {
  const overlays = document.querySelectorAll(
    '[role="menu"], .MuiModal-root:not([aria-hidden="true"]):not([data-row-peek-open="false"]), [data-radix-popper-content-wrapper] [role="dialog"]'
  );

  return Array.from(overlays).some((overlay) => !overlay.contains(container));
}

/** A row owns its editors' commit barriers, including editors rendered in portals. */
export function createRowPeekNavigation() {
  const guards = new Set<NavigationGuard>();
  let pending: Promise<boolean> | undefined;
  let focusedEditor: EventTarget | null = null;

  return {
    // React focus events include portaled descendants, unlike DOM containment.
    trackFocusedEditor(target: EventTarget | null) {
      focusedEditor = target;
    },
    register(guard: NavigationGuard) {
      guards.add(guard);
      return () => {
        guards.delete(guard);
      };
    },
    prepare(container: HTMLElement | null): Promise<boolean> {
      if (pending) return pending;

      // Blur can unmount a property editor. Capture its commit before that
      // happens, and wait for saves that blur starts before allowing navigation.
      const current = Array.from(guards);
      const focused = document.activeElement;

      if (focused instanceof HTMLElement && (container?.contains(focused) || focused === focusedEditor)) {
        focused.blur();
      }

      pending = Promise.resolve()
        .then(() => Promise.all(current.map((guard) => guard())))
        .then((results) => results.every(Boolean))
        .catch((error: unknown) => {
          Log.error('[RowPeek] Failed to save before navigation', error);
          return false;
        })
        .finally(() => {
          pending = undefined;
        });

      return pending;
    },
  };
}

export const RowPeekNavigationContext = createContext<ReturnType<typeof createRowPeekNavigation> | null>(null);

export function useRowPeekNavigationGuard(guard: NavigationGuard) {
  const navigation = useContext(RowPeekNavigationContext);
  const latest = useRef(guard);

  useLayoutEffect(() => {
    latest.current = guard;
  });
  useLayoutEffect(() => navigation?.register(() => latest.current()), [navigation]);
}
