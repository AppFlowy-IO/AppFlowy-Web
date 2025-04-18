import { useDatabaseViewId, useReadOnly } from '@/application/database-yjs';
import { useReorderColumnDispatch, useReorderRowDispatch } from '@/application/database-yjs/dispatch';
import {
  getColumnRegistry,
  getRowRegistry,
  ReorderPayload,
} from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderColumn } from '@/components/database/components/grid/grid-column';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { triggerPostMoveFlash } from '@atlaskit/pragmatic-drag-and-drop-flourish/trigger-post-move-flash';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import {
  getReorderDestinationIndex,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import * as liveRegion from '@atlaskit/pragmatic-drag-and-drop-live-region';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { Virtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useGridDnd (data: RenderRow[], columns: RenderColumn[], virtualizer: Virtualizer<Element, Element>, columnVirtualizer: Virtualizer<HTMLDivElement, Element>) {
  const rowContextValue = useGridDndRow(data, virtualizer);
  const columnContextValue = useGridDndColumn(columns, columnVirtualizer);

  return useMemo(() => {
    return {
      ...rowContextValue,
      ...columnContextValue,
    };
  }, [columnContextValue, rowContextValue]);
}

export function useGridDndRow (data: RenderRow[], virtualizer: Virtualizer<Element, Element>) {
  const viewId = useDatabaseViewId();
  const readOnly = useReadOnly();
  const [registry] = useState(getRowRegistry);
  const [instanceId] = useState(() => Symbol(`grid-row-dnd-${viewId}`));
  const [lastRowMoved, setLastRowMoved] = useState<{
    rowId: string;
    previousIndex: number;
    currentIndex: number;
  } | null>(null);
  const stableData = useRef<RenderRow[]>(data);

  useEffect(() => {
    stableData.current = data;
  }, [data]);
  const reorder = useReorderRowDispatch();

  const reorderRow = useCallback(({
    startIndex,
    indexOfTarget,
    closestEdgeOfTarget,
  }: ReorderPayload) => {
    const finishIndex = getReorderDestinationIndex({
      startIndex,
      closestEdgeOfTarget,
      indexOfTarget,
      axis: 'vertical',
    });

    if (finishIndex === startIndex) {
      return;
    }

    const rowIds = stableData.current.map(item => item.rowId);
    const rowId = rowIds[startIndex];

    if (!rowId) {
      throw new Error('No rowId provided');
    }

    rowIds.splice(startIndex, 1);
    rowIds.splice(finishIndex, 0, rowId);

    const newIndex = rowIds.findIndex(id => id === rowId);
    const beforeId = rowIds[newIndex - 1];

    console.log('rowId', rowId, beforeId);

    reorder(rowId, beforeId);

  }, [reorder]);

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

    if (!scrollContainer || readOnly) return;

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

          if (!target) {
            return;
          }

          const sourceData = source.data;
          const targetData = target.data;

          const indexOfTarget = data.findIndex(
            (item) => item.rowId === targetData.rowId,
          );

          if (indexOfTarget < 0) {
            return;
          }

          const closestEdgeOfTarget = extractClosestEdge(targetData);

          reorderRow({
            startIndex: sourceData.index as number,
            indexOfTarget,
            closestEdgeOfTarget,
          });
        },
      }),
      autoScrollForElements({
        canScroll: canRespond,
        element: scrollContainer,
      }),
    );
  }, [readOnly, instanceId, data, reorderRow, virtualizer.scrollElement]);

  useEffect(() => {
    return () => {
      liveRegion.cleanup();
    };
  }, []);

  return useMemo(() => ({
    getRows: () => data,
    registerRow: registry.register,
    reorderRow,
    rowInstanceId: instanceId,
  }), [data, registry.register, reorderRow, instanceId]);

}

export function useGridDndColumn (data: RenderColumn[], virtualizer: Virtualizer<HTMLDivElement, Element>) {
  const viewId = useDatabaseViewId();
  const reorder = useReorderColumnDispatch();
  const stableData = useRef<RenderColumn[]>(data);

  const [registry] = useState(getColumnRegistry);
  const [instanceId] = useState(() => Symbol(`grid-column-dnd-${viewId}`));

  useEffect(() => {
    stableData.current = data;
  }, [data]);

  const [lastColumnMoved, setLastColumnMoved] = useState<{
    fieldId: string;
    previousIndex: number;
    currentIndex: number;
  } | null>(null);

  const reorderColumn = useCallback(({
    startIndex,
    indexOfTarget,
    closestEdgeOfTarget,
  }: ReorderPayload) => {
    const finishIndex = getReorderDestinationIndex({
      startIndex,
      closestEdgeOfTarget,
      indexOfTarget,
      axis: 'horizontal',
    });

    if (finishIndex === startIndex) {
      return;
    }

    const columnIds = stableData.current.map(item => item.fieldId);
    const columnId = columnIds[startIndex];

    if (!columnId) {
      throw new Error('No fieldId provided');
    }

    columnIds.splice(startIndex, 1);
    columnIds.splice(finishIndex, 0, columnId);
    const newIndex = columnIds.findIndex(id => id === columnId);
    const beforeColumnId = columnIds[newIndex - 1];

    reorder(columnId, beforeColumnId);

  }, [reorder]);

  useEffect(() => {
    if (!lastColumnMoved) return;

    const { fieldId, previousIndex, currentIndex } = lastColumnMoved;

    liveRegion.announce(
      `Column moved from position ${previousIndex + 1} to position ${currentIndex + 1}.`,
    );

    setTimeout(() => {
      virtualizer.scrollToIndex(currentIndex);

      setTimeout(() => {
        const element = registry.getElement(fieldId);

        if (element) {
          triggerPostMoveFlash(element);
        }
      }, 100);
    });

    return () => setLastColumnMoved(null);
  }, [lastColumnMoved, virtualizer, registry]);

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

          if (!target) {
            return;
          }

          const sourceData = source.data;
          const targetData = target.data;

          const indexOfTarget = data.findIndex(
            (item) => item.fieldId === targetData.fieldId,
          );

          if (indexOfTarget < 0) {
            return;
          }

          const closestEdgeOfTarget = extractClosestEdge(targetData);

          reorderColumn({
            startIndex: sourceData.index as number,
            indexOfTarget,
            closestEdgeOfTarget,
          });
        },
      }),
      autoScrollForElements({
        canScroll: canRespond,
        element: scrollContainer,
      }),
    );
  }, [instanceId, data, reorderColumn, virtualizer.scrollElement]);

  useEffect(() => {
    return () => {
      liveRegion.cleanup();
    };
  }, []);

  return useMemo(() => ({
    getColumns: () => data,
    registerColumn: registry.register,
    reorderColumn,
    columnInstanceId: instanceId,
  }), [data, registry.register, reorderColumn, instanceId]);
}