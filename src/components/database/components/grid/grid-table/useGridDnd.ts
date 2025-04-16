import { useDatabaseViewId } from '@/application/database-yjs';
import { getRowRegistry } from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { triggerPostMoveFlash } from '@atlaskit/pragmatic-drag-and-drop-flourish/trigger-post-move-flash';
import * as liveRegion from '@atlaskit/pragmatic-drag-and-drop-live-region';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { Virtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useState } from 'react';

export function useGridDnd (data: RenderRow[], virtualizer: Virtualizer<Element, Element>) {
  const viewId = useDatabaseViewId();
  const [registry] = useState(getRowRegistry);
  const [instanceId] = useState(() => Symbol(viewId));
  const [lastRowMoved, setLastRowMoved] = useState<{
    rowId: string;
    previousIndex: number;
    currentIndex: number;
  } | null>(null);

  const reorderRow = useCallback(() => {
    //
  }, []);

  useEffect(() => {
    if (!lastRowMoved) return;

    const { rowId, previousIndex, currentIndex } = lastRowMoved;

    liveRegion.announce(
      `Row moved from position ${previousIndex + 1} to position ${currentIndex + 1}.`,
    );

    setTimeout(() => {
      virtualizer.scrollToIndex(currentIndex);

      setTimeout(() => {
        const element = registry.getElement(rowId);

        if (element) {
          triggerPostMoveFlash(element);
        }
      }, 100);
    });

    return () => setLastRowMoved(null);
  }, [lastRowMoved, virtualizer, registry]);

  useEffect(() => {
    const scrollContainer = virtualizer.scrollElement;

    if (!scrollContainer) return;

    // eslint-disable-next-line
    function canRespond ({ source }: Record<string, any>) {
      return source.data && source.data.instanceId === instanceId;
    }

    return combine(
      monitorForElements({
        canMonitor: canRespond,
        // eslint-disable-next-line
        onDrop ({ location, source }) {
          const target = location.current.dropTargets[0];

          if (!target) return;

          //
        },
      }),
      autoScrollForElements({
        canScroll: canRespond,
        element: scrollContainer,
      }),
    );
  }, [instanceId, data, reorderRow, virtualizer.scrollElement]);

  useEffect(() => {
    return () => {
      liveRegion.cleanup();
    };
  }, []);

  const contextValue = useMemo(() => ({
    getRows: () => data,
    registerRow: registry.register,
    reorderRow,
    instanceId,
  }), [data, registry.register, reorderRow, instanceId]);

  return {
    contextValue,
    lastRowMoved,
    setLastRowMoved,
    registry,
    instanceId,
    reorderRow,
  };
}