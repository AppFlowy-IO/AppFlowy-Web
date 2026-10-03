import { DatabaseViewLayout } from '@/application/types';

import { DASHBOARD_MOTION_FAST_CLASS } from './constants';
import { isWidgetLayout } from './widget-status';

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

/** Layouts whose toolbar, and whose widget header, offer Sort. */
export const SORTABLE_LAYOUTS: ReadonlySet<DatabaseViewLayout> = new Set([
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Gallery,
  DatabaseViewLayout.Feed,
  DatabaseViewLayout.Timeline,
]);

/** WP03 capabilities: no content tools yet, and Sort where the toolbar sorts today. */
export const WIDGET_TOOL_CAPS: WidgetToolCaps = { contentTools: false, sortLayouts: SORTABLE_LAYOUTS };

// WP09: layouts whose View-mode widgets get the content tools (Search, `+ New`).
const CONTENT_TOOL_LAYOUTS: ReadonlySet<DatabaseViewLayout> = new Set([
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Board,
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
 * view settings. Sort is offered for the layouts of `caps.sortLayouts`, which
 * never lists Chart.
 */
export function getDashboardWidgetTools({
  layout,
  editing,
  canWrite,
  canEditConditions,
  caps = WIDGET_TOOL_CAPS,
}: WidgetToolsInput): WidgetTool[] {
  // A dashboard is never a widget. A Form view can be one (the picker offers
  // existing ones) and shows its form without tools.
  if (!isWidgetLayout(layout) || layout === DatabaseViewLayout.Form) return [];
  const tools: WidgetTool[] = [];

  if (canEditConditions) tools.push('filter');
  if (canEditConditions && caps.sortLayouts.has(layout)) tools.push('sort');

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
 * When a tool shows: each condition, and the CSS that expresses it on a tool
 * slot inside the widget box (`group/widget`) and on the tools container
 * (`group/tools`, which carries `data-force-visible` in Edit mode or while
 * the menu or the settings are open, and `data-has-active` for an active
 * filter or sort; a slot carries `data-active`). One table, so the rule and
 * its CSS cannot drift apart.
 */
const TOOL_VISIBILITY_RULES: {
  holds: (input: WidgetToolVisibilityInput) => boolean;
  slot: string;
  container: string;
}[] = [
  {
    holds: ({ hovered }) => hovered,
    slot: 'group-hover/widget:opacity-100',
    container: 'group-hover/widget:opacity-100',
  },
  {
    holds: ({ focusWithin }) => focusWithin,
    slot: 'group-focus-within/widget:opacity-100',
    container: 'group-focus-within/widget:opacity-100',
  },
  {
    holds: ({ popoverOpen }) => popoverOpen,
    slot: 'group-has-[[data-state=open]]/tools:opacity-100',
    container: 'has-[[data-state=open]]:opacity-100',
  },
  {
    holds: ({ editing }) => editing,
    slot: 'group-data-[force-visible=true]/tools:opacity-100',
    container: 'data-[force-visible=true]:opacity-100',
  },
  {
    holds: ({ tool, active }) => (tool === 'filter' || tool === 'sort') && active,
    slot: 'data-[active=true]:opacity-100',
    container: 'data-[has-active=true]:opacity-100',
  },
  {
    holds: ({ coarsePointer }) => coarsePointer,
    slot: '[@media(pointer:coarse)]:opacity-100',
    container: '[@media(pointer:coarse)]:opacity-100',
  },
];

/**
 * Whether a tool is shown. Hidden tools keep their slot and stay focusable and
 * clickable; only their opacity changes. An active filter or sort stays shown.
 */
export function isWidgetToolVisible(input: WidgetToolVisibilityInput): boolean {
  return TOOL_VISIBILITY_RULES.some((rule) => rule.holds(input));
}

const HIDDEN_AT_REST_CLASS = `opacity-0 transition-opacity ${DASHBOARD_MOTION_FAST_CLASS} motion-reduce:transition-none`;

/** `isWidgetToolVisible` in CSS, for a tool slot. */
export const WIDGET_TOOL_SLOT_CLASS = [HIDDEN_AT_REST_CLASS, ...TOOL_VISIBILITY_RULES.map((rule) => rule.slot)].join(
  ' '
);

/**
 * The tools container: shown while any of its tools is, so at rest in View
 * mode the whole group is transparent and fades in with the widget's hover.
 */
export const WIDGET_TOOLS_CONTAINER_CLASS = [
  HIDDEN_AT_REST_CLASS,
  ...TOOL_VISIBILITY_RULES.map((rule) => rule.container),
].join(' ');
