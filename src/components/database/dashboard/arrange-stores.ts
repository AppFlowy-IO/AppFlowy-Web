import { ViewLayout } from '@/application/types';

/**
 * Small external stores of the dashboard's arrange interactions (WP04). A
 * drag updates them on every pointer move, so they live outside React state:
 * only the row that shows the drop line, and the drag ghost on a drag start
 * or drop, re-render (`useSyncExternalStore`); the ghost follows the pointer
 * through a style write.
 */

type Listener = () => void;

function createListeners() {
  const listeners = new Set<Listener>();

  return {
    notify: () => listeners.forEach((listener) => listener()),
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The vertical drop line of a widget drag, in CSS px relative to the row
 * element: `left` is the line's centre, `top` / `height` span the card. Owned
 * by the widget under the pointer (`widgetId`).
 */
export interface DropIndicatorGeometry {
  widgetId: string;
  rowId: string;
  left: number;
  top: number;
  height: number;
}

export interface DropIndicatorStore {
  get: () => DropIndicatorGeometry | null;
  set: (geometry: DropIndicatorGeometry) => void;
  /** Clears the line, or with `widgetId` only the line that widget drew. */
  clear: (widgetId?: string) => void;
  subscribe: (listener: Listener) => () => void;
}

function sameGeometry(a: DropIndicatorGeometry | null, b: DropIndicatorGeometry | null) {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.widgetId === b.widgetId &&
      a.rowId === b.rowId &&
      a.left === b.left &&
      a.top === b.top &&
      a.height === b.height)
  );
}

export function createDropIndicatorStore(): DropIndicatorStore {
  let value: DropIndicatorGeometry | null = null;
  const { notify, subscribe } = createListeners();
  const write = (next: DropIndicatorGeometry | null) => {
    if (sameGeometry(value, next)) return;
    value = next;
    notify();
  };

  return {
    get: () => value,
    set: write,
    clear: (widgetId) => {
      if (widgetId === undefined || value?.widgetId === widgetId) write(null);
    },
    subscribe,
  };
}

/** What the drag ghost replicates: the dragged widget box's size and title, and where it was grabbed. */
export interface DragGhostState {
  widgetId: string;
  name: string;
  layout: ViewLayout;
  /** The widget box size in CSS px. */
  width: number;
  height: number;
  /** The grab point inside the box, kept while the ghost follows the pointer. */
  offsetX: number;
  offsetY: number;
}

export interface DragGhostStore {
  get: () => DragGhostState | null;
  /** A drag started at client point (`x`, `y`). */
  start: (state: DragGhostState, x: number, y: number) => void;
  /** The pointer moved: only the attached element's transform changes, nothing renders. */
  move: (x: number, y: number) => void;
  clear: () => void;
  /** The ghost element (ref callback); it takes the latest position at once. */
  attach: (element: HTMLElement | null) => void;
  subscribe: (listener: Listener) => () => void;
}

export function createDragGhostStore(): DragGhostStore {
  let state: DragGhostState | null = null;
  let position = { x: 0, y: 0 };
  let element: HTMLElement | null = null;
  const { notify, subscribe } = createListeners();
  const place = () => {
    if (!element || !state) return;
    element.style.transform = `translate3d(${position.x - state.offsetX}px, ${position.y - state.offsetY}px, 0)`;
  };

  return {
    get: () => state,
    start: (next, x, y) => {
      state = next;
      position = { x, y };
      notify();
      place();
    },
    move: (x, y) => {
      if (position.x === x && position.y === y) return;
      position = { x, y };
      place();
    },
    clear: () => {
      if (!state) return;
      state = null;
      notify();
    },
    attach: (next) => {
      element = next;
      place();
    },
    subscribe,
  };
}

export type RowMoveControlId = 'up' | 'down';

/**
 * The row move arrow to focus once a moved row renders at its new place:
 * moving a focused button through the DOM drops the focus.
 */
export interface RowFocusRequests {
  request: (rowId: string, control: RowMoveControlId) => void;
  /** The pending request of `rowId`, taken (so it applies once), or `null`. */
  consume: (rowId: string) => RowMoveControlId | null;
}

export function createRowFocusRequests(): RowFocusRequests {
  let pending: { rowId: string; control: RowMoveControlId } | null = null;

  return {
    request: (rowId, control) => {
      pending = { rowId, control };
    },
    consume: (rowId) => {
      if (pending?.rowId !== rowId) return null;
      const { control } = pending;

      pending = null;
      return control;
    },
  };
}
