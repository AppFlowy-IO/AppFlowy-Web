import { createContext, RefObject, useContext } from 'react';

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
  /** Open the widget's settings host (Edit mode); closes the menu. */
  openSettings: () => void;
}

/**
 * Per-widget state shared between the box (`DashboardWidget`) and the header
 * that `DatabaseViews` renders inside the widget's nested database tree. Only
 * what a consumer reads: the widget's position is not here, so a move or a
 * resize elsewhere on the dashboard never re-renders the nested shell.
 */
export interface WidgetContextValue {
  widgetId: string;
  /** The source database and view the widget shows. */
  databaseId: string;
  viewId: string;
  /** Resolved view name (folder name, else the database view name). */
  name: string;
  icon: ViewIcon | null;
  layout: ViewLayout;
  isEditing: boolean;
  canEdit: boolean;
  /** Effective Edit mode: `isEditing && canEdit`. */
  editing: boolean;
  /** The header band with the title pill shows (the same in both modes). */
  showWidgetTitles: boolean;
  /** The title pill shows the view icon ("Show icons in heading"). */
  showIcon: boolean;
  /** Vertical space the header takes (0 when the tools float over the card). */
  headerHeight: number;
  isDragging: boolean;
  /** Ref callback for the element that starts a drag (Edit mode). */
  setDragHandle: (element: HTMLElement | null) => void;
  /** The widget menu (opened by the title pill, the options button or a right-click). */
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  /** The settings host (opened by the Edit-mode settings tool). */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** The widget box, which anchors the settings host. */
  getBoxElement: () => HTMLElement | null;
  /** Focus returns here when the menu closes: the title pill, or the options button without titles. */
  titleRef: RefObject<HTMLButtonElement>;
  optionsRef: RefObject<HTMLButtonElement>;
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
