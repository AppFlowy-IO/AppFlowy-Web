import { SelectOption, useDatabaseViewId, useReadOnly } from '@/application/database-yjs';
import { useReorderSelectFieldOptions } from '@/application/database-yjs/dispatch';
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

export interface OptionDragContextState {
  getData: () => SelectOption[];
  reorderOption: (args: ReorderPayload) => void;
  registerOption: (args: {
    id: string;
    element: HTMLDivElement;
  }) => CleanupFn;
  instanceId: symbol;
}

export const OptionDragContext = createContext<OptionDragContextState | undefined>(undefined);

export function useOptionDragContext (): OptionDragContextState {
  const context = useContext(OptionDragContext);

  if (!context) {
    throw new Error('useOptionDragContext must be used within a OptionDragProvider');
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

export function useOptionDragContextValue (fieldId: string, data: SelectOption[], container: HTMLDivElement | null): OptionDragContextState {
  const readOnly = useReadOnly();
  const [registry] = useState(getRegistry);
  const viewId = useDatabaseViewId();
  const [instanceId] = useState(() => Symbol(`option-drag-context-${fieldId}-${viewId}`));
  const stableData = useRef<SelectOption[]>(data);
  const onReorderOptions = useReorderSelectFieldOptions(fieldId);

  useEffect(() => {
    stableData.current = data;
  }, [data]);

  const getData = () => {
    return stableData.current;
  };

  const reorderOption = useCallback(({
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

    const newOptions = reorder({
      list: stableData.current,
      startIndex,
      finishIndex,
    });

    const optionId = stableData.current[startIndex].id;

    if (!optionId) {
      throw new Error('No optionId provided');
    }

    const beforeId = newOptions[finishIndex - 1]?.id;

    onReorderOptions(optionId, beforeId);
  }, [onReorderOptions]);

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

          reorderOption({
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
  }, [readOnly, instanceId, data, reorderOption, container]);

  const contextValue = useMemo(() => ({
    getData,
    reorderOption,
    registerOption: registry.register,
    instanceId,
  }), [reorderOption, registry.register, instanceId]);

  return contextValue;
}

