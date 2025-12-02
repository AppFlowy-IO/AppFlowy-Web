import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { Edge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { getReorderDestinationIndex } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { Log } from '@/utils/log';
import type { CleanupFn } from '@atlaskit/pragmatic-drag-and-drop/types';

export interface ReorderPayload {
  startIndex: number;
  indexOfTarget: number;
  closestEdgeOfTarget: Edge | null;
}

export interface DragContextState {
  reorderItem: (args: ReorderPayload) => void;
  registerItem: (args: { id: string; element: HTMLDivElement }) => CleanupFn;
  instanceId: symbol;
  enabled: boolean;
}

export const DragContext = createContext<DragContextState | undefined>(undefined);

export function useDragContext(): DragContextState {
  const context = useContext(DragContext);

  if (!context) {
    throw new Error('useOptionDragContext must be used within a OptionDragProvider');
  }

  return context;
}

export function getRegistry() {
  const registry = new Map<string, HTMLElement>();

  function register({ id, element }: { id: string; element: HTMLDivElement }) {
    registry.set(id, element);

    return function unregister() {
      if (registry.get(id) === element) {
        registry.delete(id);
      }
    };
  }

  function getElement(id: string): HTMLElement | null {
    Log.debug(`getElement: ${id}`);

    return registry.get(id) ?? null;
  }

  return { register, getElement };
}

export function useDragContextValue<
  T extends {
    id: string;
  }
>({
  enabled = true,
  data,
  container,
  reorderAction,
}: {
  enabled?: boolean;
  data: T[];
  container: HTMLDivElement | null;
  reorderAction: (args: { oldData: T[]; newData: T[]; startIndex: number; finishIndex: number }) => void;
}): DragContextState {
  const [registry] = useState(getRegistry);
  const [instanceId] = useState(() => Symbol(`drag-context-${Math.random()}`));
  const stableData = useRef<T[]>(data);

  useEffect(() => {
    stableData.current = data;
  }, [data]);

  const getData = useCallback(() => {
    return stableData.current;
  }, []);

  const reorderItem = useCallback(
    ({ startIndex, indexOfTarget, closestEdgeOfTarget }: ReorderPayload) => {
      const finishIndex = getReorderDestinationIndex({
        startIndex,
        closestEdgeOfTarget,
        indexOfTarget,
        axis: 'vertical',
      });

      if (finishIndex === startIndex) {
        return;
      }

      const newOptions = reorder({
        list: stableData.current,
        startIndex,
        finishIndex,
      });

      reorderAction({
        oldData: stableData.current,
        newData: newOptions,
        startIndex,
        finishIndex,
      });
    },
    [reorderAction]
  );

  useEffect(() => {
    if (!enabled || !container) return;

    // eslint-disable-next-line
    function canRespond({ source }: Record<string, any>) {
      return source.data && source.data.instanceId === instanceId;
    }

    return combine(
      monitorForElements({
        canMonitor: canRespond,
        // eslint-disable-next-line
        onDrop({ location, source }) {
          const target = location.current.dropTargets[0];

          if (!target) {
            return;
          }

          const sourceData = source.data;
          const targetData = target.data;

          const indexOfTarget = data.findIndex((item) => item.id === targetData.id);

          if (indexOfTarget < 0) {
            return;
          }

          const closestEdgeOfTarget = extractClosestEdge(targetData);

          const startIndex = stableData.current.findIndex((item) => item.id === sourceData.id);

          reorderItem({
            startIndex,
            indexOfTarget,
            closestEdgeOfTarget,
          });
        },
      }),
      autoScrollForElements({
        canScroll: canRespond,
        element: container,
      })
    );
  }, [enabled, instanceId, data, reorderItem, container]);

  const contextValue = useMemo(
    () => ({
      getData,
      reorderItem,
      registerItem: registry.register,
      instanceId,
      enabled,
    }),
    [getData, reorderItem, registry.register, instanceId, enabled]
  );

  return contextValue;
}
