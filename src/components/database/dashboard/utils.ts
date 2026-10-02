import { DASHBOARD_MAX_ROW_HEIGHT, DASHBOARD_MIN_ROW_HEIGHT } from '@/application/database-yjs/dashboard.type';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';

import {
  DASHBOARD_CONTROL_GUTTER,
  WIDGET_BOX_PADDING,
  WIDGET_HEADER_HEIGHT,
  WIDGET_MIN_VIEWPORT_HEIGHT,
} from './constants';

const DATABASE_TO_VIEW_LAYOUT: Record<DatabaseViewLayout, ViewLayout> = {
  [DatabaseViewLayout.Grid]: ViewLayout.Grid,
  [DatabaseViewLayout.Board]: ViewLayout.Board,
  [DatabaseViewLayout.Calendar]: ViewLayout.Calendar,
  [DatabaseViewLayout.Chart]: ViewLayout.Chart,
  [DatabaseViewLayout.List]: ViewLayout.List,
  [DatabaseViewLayout.Gallery]: ViewLayout.Gallery,
  [DatabaseViewLayout.Feed]: ViewLayout.Feed,
  [DatabaseViewLayout.Form]: ViewLayout.Form,
  [DatabaseViewLayout.Timeline]: ViewLayout.Timeline,
  [DatabaseViewLayout.Dashboard]: ViewLayout.Dashboard,
};

/** Folder layout (icons, catalog) of a database-side layout value. */
export function databaseLayoutToViewLayout(layout: DatabaseViewLayout | null | undefined): ViewLayout {
  if (layout === null || layout === undefined) return ViewLayout.Grid;
  return DATABASE_TO_VIEW_LAYOUT[layout] ?? ViewLayout.Grid;
}

/** Database-side layout of a folder layout value; `null` for non-database layouts. */
export function viewLayoutToDatabaseLayout(layout: ViewLayout | null | undefined): DatabaseViewLayout | null {
  const entry = Object.entries(DATABASE_TO_VIEW_LAYOUT).find(([, value]) => value === layout);

  return entry ? (Number(entry[0]) as DatabaseViewLayout) : null;
}

/** Translation key + English fallback of a layout's menu name. */
export function getLayoutLabel(layout: ViewLayout): { key: string; defaultValue: string } {
  switch (layout) {
    case ViewLayout.Board:
      return { key: 'board.menuName', defaultValue: 'Board' };
    case ViewLayout.Calendar:
      return { key: 'calendar.menuName', defaultValue: 'Calendar' };
    case ViewLayout.Chart:
      return { key: 'chart.menuName', defaultValue: 'Chart' };
    case ViewLayout.List:
      return { key: 'list.menuName', defaultValue: 'List' };
    case ViewLayout.Gallery:
      return { key: 'gallery.menuName', defaultValue: 'Gallery' };
    case ViewLayout.Feed:
      return { key: 'feed.menuName', defaultValue: 'Feed' };
    case ViewLayout.Form:
      return { key: 'form.builderName', defaultValue: 'Form builder' };
    case ViewLayout.Timeline:
      return { key: 'timeline.menuName', defaultValue: 'Timeline' };
    case ViewLayout.Dashboard:
      return { key: 'dashboard.menuName', defaultValue: 'Dashboard' };
    default:
      return { key: 'grid.menuName', defaultValue: 'Grid' };
  }
}

export interface WidgetChromeInput {
  showWidgetTitles: boolean;
}

/** Height of the header band above the card: 40 with titles, none without, in both modes. */
export function getWidgetHeaderHeight({ showWidgetTitles }: WidgetChromeInput) {
  return showWidgetTitles ? WIDGET_HEADER_HEIGHT : 0;
}

/**
 * Height handed to the nested database: the card, which fills the box under
 * the header (or under the top padding when titles are hidden) down to the
 * box's bottom padding. The card's ring is a shadow and takes no space.
 */
export function getWidgetViewportHeight(rowHeight: number, chrome: WidgetChromeInput) {
  const chromeHeight = chrome.showWidgetTitles ? WIDGET_HEADER_HEIGHT + WIDGET_BOX_PADDING : 2 * WIDGET_BOX_PADDING;

  return Math.max(WIDGET_MIN_VIEWPORT_HEIGHT, rowHeight - chromeHeight);
}

export function clampRowHeight(height: number) {
  if (!Number.isFinite(height)) return DASHBOARD_MIN_ROW_HEIGHT;
  return Math.min(DASHBOARD_MAX_ROW_HEIGHT, Math.max(DASHBOARD_MIN_ROW_HEIGHT, Math.round(height)));
}

/**
 * Inline padding of the dashboard content. For users who can edit it is
 * floored on both sides so the row controls fit in the gutter, in View and
 * Edit mode alike: entering Edit mode never moves a widget.
 */
export function getDashboardInlinePadding({
  paddingStart,
  paddingEnd,
  reserveControlGutter,
}: {
  paddingStart: number;
  paddingEnd: number;
  reserveControlGutter: boolean;
}) {
  return {
    paddingLeft: reserveControlGutter ? Math.max(paddingStart, DASHBOARD_CONTROL_GUTTER) : paddingStart,
    paddingRight: reserveControlGutter ? Math.max(paddingEnd, DASHBOARD_CONTROL_GUTTER) : paddingEnd,
  };
}
