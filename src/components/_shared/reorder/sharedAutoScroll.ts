import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';

type AutoScrollOptions = Pick<Parameters<typeof autoScrollForElements>[0], 'element' | 'canScroll'>;
type Participant = Pick<AutoScrollOptions, 'canScroll'>;

interface SharedRegistration {
  participants: Set<Participant>;
  cleanup: () => void;
}

const registrations = new WeakMap<Element, SharedRegistration>();

/**
 * Atlaskit supports one registration per scroll element. Editors, embedded
 * databases and sibling lists can share that element, so keep it registered
 * until its last consumer leaves and allow scrolling for any active consumer.
 */
export function registerSharedAutoScroll({ element, canScroll }: AutoScrollOptions): () => void {
  const participant: Participant = { canScroll };
  let registration = registrations.get(element);

  if (registration) {
    registration.participants.add(participant);
  } else {
    const participants = new Set([participant]);
    const cleanup = autoScrollForElements({
      element,
      canScroll: (args) => {
        for (const current of participants) {
          if (!current.canScroll || current.canScroll(args)) return true;
        }

        return false;
      },
    });

    registration = { participants, cleanup };
    registrations.set(element, registration);
  }

  const activeRegistration = registration;

  return () => {
    // Effects can clean up more than once. An old cleanup must never remove a
    // replacement registration created after the element's last consumer left.
    if (!activeRegistration.participants.delete(participant) || activeRegistration.participants.size > 0) return;

    registrations.delete(element);
    activeRegistration.cleanup();
  };
}
