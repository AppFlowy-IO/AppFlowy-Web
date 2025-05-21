import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { useEffect, useRef, useState } from 'react';

export function useNavigationKey ({
  element,
  onToggleSelectedRowId,
}: {
  element: HTMLElement | null;
  onToggleSelectedRowId: (rowId: string) => void;
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
      const rowTargets = Array.from(element.querySelectorAll('[data-row-id]'));

      const rowIds = rowTargets.map((target) => {
        const el = target as HTMLElement;

        if (el && el.dataset && el.dataset.rowId) {
          return el.dataset.rowId;
        }

        return null;
      }).filter((id) => id !== null) as string[];

      const selectedId = selectedIdRef.current;

      if (!selectedId) {

        setSelectedId(rowIds[0]);
        return;
      }

      const index = rowIds.indexOf(selectedId);

      const focusedNextItem = () => {
        const nextIndex = index === rowIds.length - 1 ? 0 : index + 1;
        const nextItem = rowTargets[nextIndex] as HTMLElement;

        if (nextItem && nextItem.dataset && nextItem.dataset.rowId) {
          setSelectedId(nextItem.dataset.rowId);
          nextItem.scrollIntoView({
            block: 'nearest',
          });
        }
      };

      const focusedPrevItem = () => {
        const prevIndex = index === 0 ? rowIds.length - 1 : index - 1;
        const prevItem = rowTargets[prevIndex] as HTMLElement;

        if (prevItem && prevItem.dataset && prevItem.dataset.rowId) {
          setSelectedId(prevItem.dataset.rowId);
          prevItem.scrollIntoView({
            block: 'nearest',
          });
        }
      };

      switch (true) {
        case isEnter:
          event.preventDefault();
          onToggleSelectedRowId(selectedId);

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

  }, [element, onToggleSelectedRowId]);

  return {
    selectedId,
    setSelectedId,
  };
}