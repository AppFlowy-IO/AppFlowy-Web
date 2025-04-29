import { useDatabaseViewId, useReadOnly } from '@/application/database-yjs';
import { useReorderColumnDispatch } from '@/application/database-yjs/dispatch';
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

export interface Property {
  id: string,
  visible: boolean
}

export interface PropertyDragContextState {
  getData: () => Property[];
  reorderProperty: (args: ReorderPayload) => void;
  registerProperty: (args: {
    id: string;
    element: HTMLDivElement;
  }) => CleanupFn;
  instanceId: symbol;
}

export const PropertyDragContext = createContext<PropertyDragContextState | undefined>(undefined);

export function usePropertyDragContext (): PropertyDragContextState {
  const context = useContext(PropertyDragContext);

  if (!context) {
    throw new Error('usePropertyDragContext must be used within a PropertyDragProvider');
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
    console.log(`getElement: ${id}`);

    return registry.get(id) ?? null;
  }

  return { register, getElement };
}

export function usePropertyDragContextValue (data: Property[], scrollContainer: HTMLDivElement | null): PropertyDragContextState {
  const readOnly = useReadOnly();
  const [registry] = useState(getRegistry);
  const viewId = useDatabaseViewId();
  const [instanceId] = useState(() => Symbol(`property-drag-context-${viewId}`));
  const stableData = useRef<Property[]>(data);
  const onReorderProperty = useReorderColumnDispatch();

  useEffect(() => {
    stableData.current = data;
  }, [data]);

  const getData = () => {
    return stableData.current;
  };

  const reorderProperty = useCallback(({
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

    const newProperties = reorder({
      list: stableData.current,
      startIndex,
      finishIndex,
    });

    if (!newProperties) {
      throw new Error('No newProperties provided');
    }

    const id = stableData.current[startIndex].id;

    if (!id) {
      throw new Error('No property id provided');
    }

    const beforeId = newProperties[finishIndex - 1]?.id;

    onReorderProperty(id, beforeId);
  }, [onReorderProperty]);

  useEffect(() => {
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
            (item) => item.id === targetData.id,
          );

          console.log(`onDrop:`, {
            indexOfTarget,
            sourceData,
          });

          if (indexOfTarget < 0) {
            return;
          }

          const closestEdgeOfTarget = extractClosestEdge(targetData);

          const startIndex = stableData.current.findIndex(item => item.id === sourceData.id);

          reorderProperty({
            startIndex,
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
  }, [readOnly, instanceId, data, reorderProperty, scrollContainer]);

  const contextValue = useMemo(() => ({
    getData,
    reorderProperty,
    registerProperty: registry.register,
    instanceId,
  }), [reorderProperty, registry.register, instanceId]);

  return contextValue;
}

