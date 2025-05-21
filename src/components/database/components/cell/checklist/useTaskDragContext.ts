import { SelectOption, useDatabaseViewId, useReadOnly } from '@/application/database-yjs';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { Edge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import {
  getReorderDestinationIndex,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import type { CleanupFn } from '@atlaskit/pragmatic-drag-and-drop/types';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export interface ReorderPayload {
  startIndex: number;
  indexOfTarget: number;
  closestEdgeOfTarget: Edge | null;
}

export interface TaskDragContextState {
  getData: () => SelectOption[];
  reorderTask: (args: ReorderPayload) => void;
  registerTask: (args: {
    id: string;
    element: HTMLDivElement;
  }) => CleanupFn;
  instanceId: symbol;
}

export const TaskDragContext = createContext<TaskDragContextState | undefined>(undefined);

export function useTaskDragContext (): TaskDragContextState {
  const context = useContext(TaskDragContext);

  if (!context) {
    throw new Error('useTaskDragContext must be used within a TaskDragProvider');
  }

  return context;
}

export function getRegistry () {
  const registry = new Map<string, HTMLElement>();

  function register ({ id, element }: { id: string, element: HTMLDivElement }) {
    registry.set(id, element);

    return function unregister () {
      if (registry.get(id) === element) {
        registry.delete(id);
      }
    };
  }

  function getElement (id: string): HTMLElement | null {
    return registry.get(id) ?? null;
  }

  return { register, getElement };
}

export function useTaskDragContextValue (fieldId: string, data: SelectOption[], reorderAction: (
  tasks: SelectOption[],
) => void, container: HTMLDivElement | null): TaskDragContextState {
  const readOnly = useReadOnly();
  const [registry] = useState(getRegistry);
  const viewId = useDatabaseViewId();
  const [instanceId] = useState(() => Symbol(`option-drag-context-${fieldId}-${viewId}`));
  const stableData = useRef<SelectOption[]>(data);

  useEffect(() => {
    stableData.current = data;
  }, [data]);

  const getData = () => {
    return stableData.current;
  };

  const reorderTask = useCallback(({
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

    const newTasks = reorder({
      list: stableData.current,
      startIndex,
      finishIndex,
    });

    reorderAction(newTasks);

  }, [reorderAction]);

  useEffect(() => {
    if (readOnly || !container) return;

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
            (item) => item.id === targetData.id,
          );

          if (indexOfTarget < 0) {
            return;
          }

          const closestEdgeOfTarget = extractClosestEdge(targetData);

          const startIndex = stableData.current.findIndex(item => item.id === sourceData.id);

          reorderTask({
            startIndex,
            indexOfTarget,
            closestEdgeOfTarget,
          });
        },
      }),
      autoScrollForElements({
        canScroll: canRespond,
        element: container,
      }),
    );
  }, [readOnly, instanceId, data, reorderTask, container]);

  const contextValue = useMemo(() => ({
    getData,
    reorderTask,
    registerTask: registry.register,
    instanceId,
  }), [reorderTask, registry.register, instanceId]);

  return contextValue;
}

