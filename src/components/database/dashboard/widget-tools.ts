import { DatabaseViewLayout } from '@/application/types';

/**
 * The tools a dashboard widget's header offers, and when they show (WP03).
 * Pure; desktop runs the same rules (`dashboard_widget_tools.dart`) and both
 * are checked against `dashboard-parity/widget-tools.json`.
 */
export type WidgetTool = 'filter' | 'sort' | 'search' | 'new' | 'settings';

/** Capability flags later packages flip on both clients in the same release. */
export interface WidgetToolCaps {
  /** Search and `+ New` in View mode (WP09). */
  contentTools: boolean;
  /** Layouts whose widgets offer Sort. */
  sortLayouts: ReadonlySet<DatabaseViewLayout>;
}

/** WP03 capabilities: no content tools yet, and Sort where the toolbar sorts today. */
export const WIDGET_TOOL_CAPS: WidgetToolCaps = {
  contentTools: false,
  sortLayouts: new Set([
    DatabaseViewLayout.Grid,
    DatabaseViewLayout.List,
    DatabaseViewLayout.Gallery,
    DatabaseViewLayout.Feed,
    DatabaseViewLayout.Timeline,
  ]),
};

/** Layouts whose View-mode widgets get the content tools (Search, `+ New`). */
const CONTENT_TOOL_LAYOUTS: ReadonlySet<DatabaseViewLayout> = new Set([
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Board,
]);

/** Layouts never rendered as widgets. */
const NO_WIDGET_LAYOUTS: ReadonlySet<DatabaseViewLayout> = new Set([
  DatabaseViewLayout.Form,
  DatabaseViewLayout.Dashboard,
]);

export interface WidgetToolsInput {
  layout: DatabaseViewLayout;
  /** Effective Edit mode (Edit mode implies write access). */
  editing: boolean;
  canWrite: boolean;
  /** The viewer may change the widget's filters and sorts (their own copy in View mode). */
  canEditConditions: boolean;
  caps?: WidgetToolCaps;
}

/**
 * The ordered tools of a widget header. View mode offers the conditions (and
 * the content tools once enabled); Edit mode swaps the content tools for the
 * view settings. Charts never sort.
 */
export function getDashboardWidgetTools({
  layout,
  editing,
  canWrite,
  canEditConditions,
  caps = WIDGET_TOOL_CAPS,
}: WidgetToolsInput): WidgetTool[] {
  if (NO_WIDGET_LAYOUTS.has(layout)) return [];
  const tools: WidgetTool[] = [];

  if (canEditConditions) tools.push('filter');
  if (canEditConditions && layout !== DatabaseViewLayout.Chart && caps.sortLayouts.has(layout)) tools.push('sort');

  if (!editing) {
    if (caps.contentTools && CONTENT_TOOL_LAYOUTS.has(layout)) {
      tools.push('search');
      if (canWrite) tools.push('new');
    }
  } else if (canWrite) {
    tools.push('settings');
  }

  return tools;
}

export interface WidgetToolVisibilityInput {
  tool: WidgetTool;
  /** A filter or sort tool whose part of the effective view has at least one rule. */
  active: boolean;
  editing: boolean;
  coarsePointer: boolean;
  /** The pointer is over the widget box. */
  hovered: boolean;
  focusWithin: boolean;
  /** A widget popover, the settings host, the widget menu or a search field is open. */
  popoverOpen: boolean;
}

/**
 * Whether a tool is shown. Hidden tools keep their slot and stay focusable and
 * clickable; only their opacity changes. An active filter or sort stays shown.
 */
export function isWidgetToolVisible({
  tool,
  active,
  editing,
  coarsePointer,
  hovered,
  focusWithin,
  popoverOpen,
}: WidgetToolVisibilityInput): boolean {
  return (
    editing ||
    coarsePointer ||
    hovered ||
    focusWithin ||
    popoverOpen ||
    ((tool === 'filter' || tool === 'sort') && active)
  );
}

/**
 * `isWidgetToolVisible` in CSS, for a tool slot inside the widget box
 * (`group/widget`) and the tools container (`group/tools`, which carries
 * `data-force-visible` in Edit mode or while the menu or settings are open).
 * The slot carries `data-active` for an active filter or sort.
 */
export function widgetToolSlotClass() {
  return [
    'opacity-0 transition-opacity duration-150 ease-in-out motion-reduce:transition-none',
    'group-hover/widget:opacity-100 group-focus-within/widget:opacity-100',
    'group-has-[[data-state=open]]/tools:opacity-100 group-data-[force-visible=true]/tools:opacity-100',
    'data-[active=true]:opacity-100 [@media(pointer:coarse)]:opacity-100',
  ].join(' ');
}

/**
 * The tools container: shown while any of its tools is (the same rule, with
 * `data-has-active` for an active filter or sort), so at rest in View mode
 * the whole group is transparent and fades in with the widget's hover.
 */
export function widgetToolsContainerClass() {
  return [
    'opacity-0 transition-opacity duration-150 ease-in-out motion-reduce:transition-none',
    'group-hover/widget:opacity-100 group-focus-within/widget:opacity-100',
    'has-[[data-state=open]]:opacity-100 data-[force-visible=true]:opacity-100',
    'data-[has-active=true]:opacity-100 [@media(pointer:coarse)]:opacity-100',
  ].join(' ');
}
