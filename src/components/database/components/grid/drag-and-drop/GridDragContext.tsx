import { RenderRow } from '@/components/database/components/grid/grid-row';
import { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { createContext, useContext } from 'react';

type RowEntry = { rowId: string; element: HTMLElement };
type CleanupFn = () => void;

export type GridDragContextValue = {
  getRows: () => RenderRow[];
  registerRow: (entry: RowEntry) => CleanupFn;
  reorderRow: (args: {
    startIndex: number;
    targetIndex: number;
    closestEdge: Edge | null;
  }) => void;
  instanceId: symbol;
};

export const GridDragContext = createContext<GridDragContextValue | null>(null);

export function useGridDragContext () {
  const context = useContext(GridDragContext);

  if (!context) throw new Error('useGridDragContext must be used within a GridDragProvider');

  return context;
}

export function getColumnRegistry () {
  
}

export function getRowRegistry () {
  const registry = new Map<string, HTMLElement>();

  function register ({ rowId, element }: RowEntry) {
    registry.set(rowId, element);

    return function unregister () {
      if (registry.get(rowId) === element) {
        registry.delete(rowId);
      }
    };
  }

  function getElement (rowId: string): HTMLElement | null {
    console.log(`getElement: ${rowId}`);

    return registry.get(rowId) ?? null;
  }

  return { register, getElement };
}

export interface RowData {
  instanceId: symbol;
  rowId: string;
  index: number;
}

export enum GridDragState {
  IDLE = 'idle',
  DRAGGING = 'dragging',
  IS_OVER = 'is-over',
  PREVIEW = 'preview',
}

export type ItemState =
  | { type: GridDragState.IDLE }
  | { type: GridDragState.PREVIEW; container: HTMLElement }
  | { type: GridDragState.DRAGGING }
  | { type: GridDragState.IS_OVER; closestEdge: string | null };