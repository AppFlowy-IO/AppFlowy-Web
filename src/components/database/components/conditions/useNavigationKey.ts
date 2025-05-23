import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { useEffect, useRef, useState } from 'react';

export function useNavigationKey ({
  element,
  onToggleItemId,
}: {
  element: HTMLElement | null;
  onToggleItemId: (itemId: string) => void;
}) {

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!element) {
      return;
    }

    // Add event listeners for keydown and click events
    const handleKeyDown = (event: KeyboardEvent) => {
      const isArrowDown = createHotkey(HOT_KEY_NAME.DOWN)(event);
      const isArrowUp = createHotkey(HOT_KEY_NAME.UP)(event);
      const isEnter = createHotkey(HOT_KEY_NAME.ENTER)(event);
      const rowTargets = Array.from(element.querySelectorAll('[data-item-id]'));

      const itemIds = rowTargets.map((target) => {
        const el = target as HTMLElement;

        if (el && el.dataset && el.dataset.itemId) {
          return el.dataset.itemId;
        }

        return null;
      }).filter((id) => id !== null) as string[];

      const selectedId = selectedIdRef.current;

      if (!selectedId) {

        setSelectedId(itemIds[0]);
        return;
      }

      const index = itemIds.indexOf(selectedId);

      const focusedNextItem = () => {
        const nextIndex = index === itemIds.length - 1 ? 0 : index + 1;
        const nextItem = rowTargets[nextIndex] as HTMLElement;

        if (nextItem && nextItem.dataset && nextItem.dataset.itemId) {
          setSelectedId(nextItem.dataset.itemId);
          nextItem.scrollIntoView({
            block: 'nearest',
          });
        }
      };

      const focusedPrevItem = () => {
        const prevIndex = index === 0 ? itemIds.length - 1 : index - 1;
        const prevItem = rowTargets[prevIndex] as HTMLElement;

        if (prevItem && prevItem.dataset && prevItem.dataset.itemId) {
          setSelectedId(prevItem.dataset.itemId);
          prevItem.scrollIntoView({
            block: 'nearest',
          });
        }
      };

      switch (true) {
        case isEnter:
          event.preventDefault();
          onToggleItemId(selectedId);

          break;

        case isArrowDown:
          event.preventDefault();
          focusedNextItem();

          break;
        case isArrowUp:
          event.preventDefault();
          focusedPrevItem();
          break;
        default:
          break;
      }
    };

    element.addEventListener('keydown', handleKeyDown);

    // Cleanup event listeners on component unmount
    return () => {
      element.removeEventListener('keydown', handleKeyDown);
    };

  }, [element, onToggleItemId]);

  return {
    selectedId,
    setSelectedId,
  };
}