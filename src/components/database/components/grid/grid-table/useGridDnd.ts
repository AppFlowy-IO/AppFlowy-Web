import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { triggerPostMoveFlash } from '@atlaskit/pragmatic-drag-and-drop-flourish/trigger-post-move-flash';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import {
  getReorderDestinationIndex,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import * as liveRegion from '@atlaskit/pragmatic-drag-and-drop-live-region';
import { Virtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDatabaseViewId, useReadOnly } from '@/application/database-yjs';
import { useReorderColumnDispatch, useReorderRowDispatch } from '@/application/database-yjs/dispatch';
import {
  getColumnRegistry,
  getRowRegistry,
  ReorderPayload,
} from '@/components/database/components/grid/drag-and-drop/GridDragContext';
import { RenderColumn } from '@/components/database/components/grid/grid-column';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import { useGridContext } from '@/components/database/grid/useGridContext';

export function useGridDnd (columns: RenderColumn[], virtualizer: Virtualizer<Element, Element>, columnVirtualizer: Virtualizer<HTMLDivElement, Element>) {
  const rowContextValue = useGridDndRow(virtualizer);
  const columnContextValue = useGridDndColumn(columns, columnVirtualizer);

  return useMemo(() => {
    return {
      ...rowContextValue,
      ...columnContextValue,
    };
  }, [columnContextValue, rowContextValue]);
}

export function useGridDndRow (virtualizer: Virtualizer<Element, Element>) {
  const viewId = useDatabaseViewId();
  const readOnly = useReadOnly();
  const {
    rows: data,
    setRows,
  } = useGridContext();
  const [registry] = useState(getRowRegistry);
  const [instanceId] = useState(() => Symbol(`grid-row-dnd-${viewId}`));
  const [lastRowMoved, setLastRowMoved] = useState<{
    rowId: string;
    previousIndex: number;
    currentIndex: number;
  } | null>(null);
  const stableData = useRef<RenderRow[]>(data);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stableData.current = data;
  }, [data]);
  const reorderRowDispatch = useReorderRowDispatch();

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

    const newRows = reorder({
      list: stableData.current,
      startIndex,
      finishIndex,
    });

    if (!newRows) {
      throw new Error('No newRowIds provided');
    }

    setRows(newRows);

    const rowId = stableData.current[startIndex].rowId;

    if (!rowId) {
      throw new Error('No rowId provided');
    }

    const beforeId = newRows[finishIndex - 1]?.rowId;

    reorderRowDispatch(rowId, beforeId);

  }, [reorderRowDispatch, setRows]);

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

    // Clean up previous registration to prevent duplicate autoScroll warnings
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    // eslint-disable-next-line
    function canRespond ({ source }: Record<string, any>) {
      return source.data && source.data.instanceId === instanceId;
    }

    const cleanup = combine(
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

    cleanupRef.current = cleanup;

    return cleanup;
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
  const reorderColumnDispatch = useReorderColumnDispatch();
  const stableData = useRef<RenderColumn[]>(data);
  const cleanupRef = useRef<(() => void) | null>(null);

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

    const newColumns = reorder({
      list: stableData.current,
      startIndex,
      finishIndex,
    });

    const columnId = stableData.current[startIndex].fieldId;

    if (!columnId) {
      throw new Error('No fieldId provided');
    }

    const beforeColumnId = newColumns[finishIndex - 1]?.fieldId;

    reorderColumnDispatch(columnId, beforeColumnId);

  }, [reorderColumnDispatch]);

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

    // Clean up previous registration to prevent duplicate autoScroll warnings
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    // eslint-disable-next-line
    function canRespond ({ source }: Record<string, any>) {
      return source.data && source.data.instanceId === instanceId;
    }

    const cleanup = combine(
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

    cleanupRef.current = cleanup;

    return cleanup;
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