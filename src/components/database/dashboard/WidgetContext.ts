import { createContext, useContext } from 'react';

import { DashboardWidget } from '@/application/database-yjs/dashboard.type';
import { ViewIcon, ViewLayout } from '@/application/types';

import { WidgetMoveDirection } from './widget-moves';

/**
 * What a widget's options menu does. Stable per widget: which entries are
 * enabled is read from the rows by the menu itself while it is open.
 */
export interface WidgetActions {
  /** Navigate to the widget's view (falls back to the source database page). */
  open: () => void;
  /** Open the widget picker in replace mode (explains the limit when full). */
  changeView: () => void;
  /** Duplicate next to the widget, or show the widget limit when the dashboard is full. */
  duplicate: () => void;
  remove: () => void;
  move: (direction: WidgetMoveDirection) => void;
}

/**
 * Per-widget state shared between the card (`DashboardWidget`) and the header
 * that `DatabaseViews` renders inside the widget's nested database tree.
 */
export interface WidgetContextValue {
  widget: DashboardWidget;
  rowId: string;
  rowIndex: number;
  index: number;
  /** Resolved view name (folder name, else the database view name). */
  name: string;
  icon: ViewIcon | null;
  layout: ViewLayout;
  isEditing: boolean;
  canEdit: boolean;
  /** Whether the header renders the view title (always in Edit mode). */
  showTitle: boolean;
  /** Vertical space the header takes (0 when the actions float over the card). */
  headerHeight: number;
  isDragging: boolean;
  /** Ref callback for the element that starts a drag (Edit mode). */
  setDragHandle: (element: HTMLElement | null) => void;
  actions: WidgetActions;
}

export const WidgetContext = createContext<WidgetContextValue | null>(null);

export function useWidgetContext(): WidgetContextValue {
  const context = useContext(WidgetContext);

  if (!context) {
    throw new Error('WidgetContext is not provided');
  }

  return context;
}

export function useWidgetContextOptional(): WidgetContextValue | null {
  return useContext(WidgetContext);
}
