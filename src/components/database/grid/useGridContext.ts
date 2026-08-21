import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

import type { Row } from '@/application/database-yjs';
import type { RenderRow } from '@/components/database/components/grid/grid-row';

export type GridActiveCell = {
  rowId: string;
  rowKey: string;
  fieldId: string;
};

type GridInteractionListener = () => void;

export type GridInteractionStore = {
  getActiveCell: () => GridActiveCell | undefined;
  getHoverRowKey: () => string | undefined;
  setActiveCell: (activeCell?: GridActiveCell) => void;
  setHoverRowKey: (hoverRowKey?: string) => void;
  subscribeActiveCell: (listener: GridInteractionListener) => () => void;
  subscribeHoverRowKey: (listener: GridInteractionListener) => () => void;
  subscribe: (listener: GridInteractionListener) => () => void;
};

export function createGridInteractionStore(initial?: {
  activeCell?: GridActiveCell;
  hoverRowKey?: string;
}): GridInteractionStore {
  let activeCell = initial?.activeCell;
  let hoverRowKey = initial?.hoverRowKey;
  const activeCellListeners = new Set<GridInteractionListener>();
  const hoverRowKeyListeners = new Set<GridInteractionListener>();
  const interactionListeners = new Set<GridInteractionListener>();
  const subscribe = (listeners: Set<GridInteractionListener>, listener: GridInteractionListener) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  };

  return {
    getActiveCell: () => activeCell,
    getHoverRowKey: () => hoverRowKey,
    setActiveCell: (nextActiveCell) => {
      if (
        activeCell?.rowId === nextActiveCell?.rowId &&
        activeCell?.rowKey === nextActiveCell?.rowKey &&
        activeCell?.fieldId === nextActiveCell?.fieldId
      ) {
        return;
      }

      activeCell = nextActiveCell;
      activeCellListeners.forEach((listener) => listener());
      interactionListeners.forEach((listener) => listener());
    },
    setHoverRowKey: (nextHoverRowKey) => {
      if (hoverRowKey === nextHoverRowKey) return;

      hoverRowKey = nextHoverRowKey;
      hoverRowKeyListeners.forEach((listener) => listener());
      interactionListeners.forEach((listener) => listener());
    },
    subscribeActiveCell: (listener) => subscribe(activeCellListeners, listener),
    subscribeHoverRowKey: (listener) => subscribe(hoverRowKeyListeners, listener),
    subscribe: (listener) => subscribe(interactionListeners, listener),
  };
}

const subscribeToNothing = () => () => undefined;

type GridInteractionContextType = {
  setActiveCell: GridInteractionStore['setActiveCell'];
  setHoverRowKey: GridInteractionStore['setHoverRowKey'];
  store: GridInteractionStore;
};

export const GridInteractionContext = createContext<GridInteractionContextType | undefined>(undefined);

function useGridInteractionContext() {
  const context = useContext(GridInteractionContext);

  if (!context) throw new Error('Grid interaction hooks must be used within GridProvider');

  return context;
}

export function useGridInteractionActions() {
  const { setActiveCell, setHoverRowKey } = useGridInteractionContext();

  return { setActiveCell, setHoverRowKey };
}

export function useIsGridRowHovered(rowKey: string, enabled = true) {
  const { store } = useGridInteractionContext();
  const getSnapshot = useCallback(() => enabled && store.getHoverRowKey() === rowKey, [enabled, rowKey, store]);
  const subscribe = enabled ? store.subscribeHoverRowKey : subscribeToNothing;

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useIsGridRowActive(rowKey: string) {
  const { store } = useGridInteractionContext();
  const getSnapshot = useCallback(() => store.getActiveCell()?.rowKey === rowKey, [rowKey, store]);

  return useSyncExternalStore(store.subscribeActiveCell, getSnapshot, getSnapshot);
}

export function useIsGridCellActive(rowKey: string, fieldId: string) {
  const { store } = useGridInteractionContext();
  const getSnapshot = useCallback(() => {
    const activeCell = store.getActiveCell();

    return activeCell?.rowKey === rowKey && activeCell.fieldId === fieldId;
  }, [fieldId, rowKey, store]);

  return useSyncExternalStore(store.subscribeActiveCell, getSnapshot, getSnapshot);
}

type GridRowResizeListener = (rowKey: string, maxCellHeight: number) => void;

export type GridRowResizeStore = {
  report: (rowKey: string, maxCellHeight: number) => void;
  subscribe: (listener: GridRowResizeListener) => () => void;
};

export function createGridRowResizeStore(): GridRowResizeStore {
  const listeners = new Set<GridRowResizeListener>();
  const pending = new Map<string, number>();

  return {
    report: (rowKey, maxCellHeight) => {
      if (listeners.size === 0) {
        pending.set(rowKey, maxCellHeight);
        return;
      }

      listeners.forEach((listener) => listener(rowKey, maxCellHeight));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      pending.forEach((maxCellHeight, rowKey) => listener(rowKey, maxCellHeight));
      pending.clear();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type GridContextType = {
  rowOrders?: Row[];
  rows: RenderRow[];
  setRows: (rows: RenderRow[]) => void;
  activePropertyId?: string;
  setActivePropertyId: (activePropertyId?: string) => void;
  rowResizeStore: GridRowResizeStore;
  remainingRowCount: number;
  lastVisibleRowId?: string;
  loadMoreRows: () => void;
  revealCreatedRow: () => void;
  showStickyHeader: boolean;
  setShowStickyHeader: (show: boolean) => void;
  isGrouped: boolean;
};

export const GridContext = createContext<GridContextType | undefined>(undefined);

export function useGridContext() {
  const context = useContext(GridContext);

  if (!context) {
    throw new Error('useGridContext must be used within the context');
  }

  return context;
}
