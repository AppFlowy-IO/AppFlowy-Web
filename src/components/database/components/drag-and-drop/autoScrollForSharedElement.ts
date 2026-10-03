import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';

type AutoScrollCanScroll = NonNullable<Parameters<typeof autoScrollForElements>[0]['canScroll']>;

/** The auto-scroll registration of each scroll element, and the drags it scrolls for. */
const sharedAutoScrolls = new WeakMap<Element, { canScrolls: Set<AutoScrollCanScroll>; cleanup: () => void }>();

/**
 * Auto-scrolls `element` for the drags `canScroll` accepts, sharing one
 * registration per element; the returned function releases this caller's
 * share (calling it again does nothing).
 *
 * Two features often scroll the same element: a grid's row and column
 * reordering share its scroller, and a board in a dashboard widget scrolls its
 * cards and its columns in one box. Registered twice, the library keeps only
 * the last registration, drops both when either is removed, and warns in
 * development with both registrations. An open inspector keeps that logged
 * element alive, and with it the whole unmounted tree: every dashboard visit
 * leaked its widgets that way.
 */
export function autoScrollForSharedElement(element: Element, canScroll: AutoScrollCanScroll) {
  let shared = sharedAutoScrolls.get(element);

  if (!shared) {
    const canScrolls = new Set<AutoScrollCanScroll>();

    shared = {
      canScrolls,
      cleanup: autoScrollForElements({
        element,
        canScroll: (args) => Array.from(canScrolls).some((accepts) => accepts(args)),
      }),
    };
    sharedAutoScrolls.set(element, shared);
  }

  const registration = shared;

  registration.canScrolls.add(canScroll);
  return () => {
    registration.canScrolls.delete(canScroll);
    if (registration.canScrolls.size > 0 || sharedAutoScrolls.get(element) !== registration) return;
    sharedAutoScrolls.delete(element);
    registration.cleanup();
  };
}
