import { createContext, RefObject, useContext } from 'react';

import { ViewIcon, ViewLayout } from '@/application/types';

import { WidgetMoveDirection } from './widget-moves';

/**
 * What a widget's menu and settings host do. Stable per widget: which entries
 * are enabled is read from the rows by the menu itself while it is open.
 */
export interface WidgetActions {
  /** "View data source": navigate to the widget's view (falls back to the source database page). */
  open: () => void;
  /** Settings › Source: the Source panel docked to the widget (replace mode). */
  changeView: () => void;
  /**
   * Duplicate next to the widget with an owned copy of its view; on a full
   * dashboard the refusal is announced and nothing is created.
   */
  duplicate: () => void;
  remove: () => void;
  /** Move left / right, or "Move to row" › Create new row above / below. */
  move: (direction: WidgetMoveDirection) => void;
  /** "Edit view": open the widget's settings host (Edit mode); closes the menu. */
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
  /**
   * A phone or a web viewport below 768px (WP14 §1.4): the header shows the
   * mobile tools, and the menu and the filters open as bottom sheets.
   */
  mobileContext: boolean;
  /**
   * The mobile search field replaces the title (WP14 §1.4.5). Owned by the
   * widget box, which drops it when the mobile context ends.
   */
  searchActive: boolean;
  setSearchActive: (active: boolean) => void;
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
  /**
   * The Edit-mode settings tool: it toggles the settings host itself (so a
   * press on it is not an outside press), and focus returns to it when the
   * host closes.
   */
  settingsToolRef: RefObject<HTMLButtonElement>;
  actions: WidgetActions;
  /**
   * The rows of the widget's view failed to load (LOADING-DESIGN R8): the
   * card says "Some rows haven't loaded yet" and offers a retry.
   */
  rowsLoadFailed?: boolean;
  /** Loads the rows again after a failure (mounts the nested database again). */
  retryRowsLoad?: () => void;
}

/**
 * What the widget frame (`WidgetSource`) knows without the source database:
 * the `WidgetContextValue` minus the view's name and layout, which the source
 * doc has the last word on, and minus the drag handle, which belongs to the
 * rendered header. `WidgetContextProvider` completes it.
 */
export type WidgetFrame = Omit<WidgetContextValue, 'name' | 'layout' | 'setDragHandle'> & {
  /** Folder name of the view (`''` until the folder answers); it wins over the name stored in the database. */
  folderName: string;
  /** Folder layout of the view, used until the source database tells. */
  folderLayout: ViewLayout | undefined;
};

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
