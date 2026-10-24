import { DatabaseViewLayout } from '@/application/types';

import { DASHBOARD_MOTION_FAST_CLASS } from './constants';
import { isWidgetLayout } from './widget-status';

/**
 * The tools a dashboard widget's header offers, and when they show (WP03),
 * and the tools of a standalone database toolbar (WP09 §1.1): one resolver.
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

/** Layouts whose toolbar, and whose widget header, offer Sort (Board since WP09). */
export const SORTABLE_LAYOUTS: ReadonlySet<DatabaseViewLayout> = new Set([
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Board,
  DatabaseViewLayout.Gallery,
  DatabaseViewLayout.Feed,
  DatabaseViewLayout.Timeline,
]);

/** WP03 capabilities: no content tools, and Sort where the toolbar sorted before WP09. */
export const WP03_WIDGET_TOOL_CAPS: WidgetToolCaps = {
  contentTools: false,
  sortLayouts: new Set([...SORTABLE_LAYOUTS].filter((layout) => layout !== DatabaseViewLayout.Board)),
};

/** The active capabilities (WP09): Search and `+ New` in View mode, and Sort for boards too. */
export const WIDGET_TOOL_CAPS: WidgetToolCaps = { contentTools: true, sortLayouts: SORTABLE_LAYOUTS };

// WP09: layouts whose View-mode widgets get the content tools (Search, `+ New`).
const CONTENT_TOOL_LAYOUTS: ReadonlySet<DatabaseViewLayout> = new Set([
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Board,
]);

/** Layouts whose standalone toolbar searches cards (Gallery, Feed) whatever the capabilities. */
const CARD_SEARCH_LAYOUTS: ReadonlySet<DatabaseViewLayout> = new Set([
  DatabaseViewLayout.Gallery,
  DatabaseViewLayout.Feed,
]);

/** Layouts whose standalone toolbar offers the `+ New` template button. */
export const TEMPLATE_LAYOUTS: ReadonlySet<DatabaseViewLayout> = new Set([
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.Board,
  DatabaseViewLayout.Calendar,
  DatabaseViewLayout.Chart,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Gallery,
  DatabaseViewLayout.Feed,
  DatabaseViewLayout.Timeline,
]);

/**
 * Where the tools render: a dashboard widget's header (the default), or the
 * standalone toolbar of a database page, document block or row page.
 */
export type WidgetToolContext = 'widget' | 'standalone';

export interface WidgetToolsInput {
  layout: DatabaseViewLayout;
  /** Effective Edit mode (Edit mode implies write access). Always false standalone. */
  editing: boolean;
  canWrite: boolean;
  /** The viewer may change the widget's filters and sorts (their own copy in View mode). */
  canEditConditions: boolean;
  caps?: WidgetToolCaps;
  context?: WidgetToolContext;
  /**
   * A widget header in a mobile context (WP14 §1.4.4): Search then Filter,
   * never Sort, `+ New` or Settings. Ignored by the standalone toolbar.
   */
  mobile?: boolean;
}

/**
 * The standalone toolbar (WP09 §1.1): Filter, Sort, Search, Settings and
 * `+ New` for writers, Search alone for read-only viewers. A dashboard's own
 * toolbar is `DashboardActions`, and "Open as page" is outside the resolver.
 */
function getStandaloneToolbarTools({
  layout,
  canWrite,
  canEditConditions,
  caps,
}: Required<Pick<WidgetToolsInput, 'layout' | 'canWrite' | 'canEditConditions' | 'caps'>>): WidgetTool[] {
  if (layout === DatabaseViewLayout.Dashboard) return [];
  const tools: WidgetTool[] = [];
  const searches = CARD_SEARCH_LAYOUTS.has(layout) || (caps.contentTools && CONTENT_TOOL_LAYOUTS.has(layout));

  if (canEditConditions) tools.push('filter');
  if (canEditConditions && caps.sortLayouts.has(layout)) tools.push('sort');
  if (searches) tools.push('search');
  // A Form view has no view settings panel.
  if (canWrite && layout !== DatabaseViewLayout.Form) tools.push('settings');
  if (canWrite && TEMPLATE_LAYOUTS.has(layout)) tools.push('new');

  return tools;
}

/**
 * The tools of a widget header in a mobile context (WP14 §1.4.4), in Notion's
 * order: Search (tables, lists and boards, once the content tools are on),
 * then Filter at the far right for a viewer who can change the conditions. A
 * mobile context never edits, so there is no Sort, `+ New` or Settings.
 */
function getMobileWidgetTools({
  layout,
  canEditConditions,
  caps,
}: Required<Pick<WidgetToolsInput, 'layout' | 'canEditConditions' | 'caps'>>): WidgetTool[] {
  const tools: WidgetTool[] = [];

  if (caps.contentTools && CONTENT_TOOL_LAYOUTS.has(layout)) tools.push('search');
  if (canEditConditions) tools.push('filter');

  return tools;
}

/**
 * The ordered tools of a widget header. View mode offers the conditions (and
 * the content tools once enabled); Edit mode swaps the content tools for the
 * view settings. Sort is offered for the layouts of `caps.sortLayouts`, which
 * never lists Chart. A mobile context has its own, shorter set.
 */
export function getDashboardWidgetTools({
  layout,
  editing,
  canWrite,
  canEditConditions,
  caps = WIDGET_TOOL_CAPS,
  context = 'widget',
  mobile = false,
}: WidgetToolsInput): WidgetTool[] {
  if (context === 'standalone') return getStandaloneToolbarTools({ layout, canWrite, canEditConditions, caps });
  // A dashboard is never a widget. A Form view can be one (the picker offers
  // existing ones) and shows its form without tools.
  if (!isWidgetLayout(layout) || layout === DatabaseViewLayout.Form) return [];
  if (mobile) return getMobileWidgetTools({ layout, canEditConditions, caps });
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
  /**
   * A filter or sort tool whose part differs from the saved view (WP07): it
   * carries the unsaved dot, so it stays shown. Absent means `false`.
   */
  dirty?: boolean;
  editing: boolean;
  coarsePointer: boolean;
  /** The pointer is over the widget box. */
  hovered: boolean;
  focusWithin: boolean;
  /** A widget popover, the settings host or the widget menu is open. */
  popoverOpen: boolean;
  /**
   * The widget's search field is expanded (focused or holding a query, WP09
   * §1.2): every tool stays shown. Absent means `false`.
   */
  searchActive?: boolean;
  /**
   * A mobile context (WP14 §1.4.4): touch has no hover, so every tool is
   * always shown. Absent means `false`.
   */
  mobile?: boolean;
}

/**
 * When a tool shows: each condition, and the CSS that expresses it on a tool
 * slot inside the widget box (`group/widget`) and on the tools container
 * (`group/tools`, which carries `data-force-visible` in Edit mode or while
 * the menu or the settings are open, `data-has-active` for an active or
 * unsaved filter or sort, and `data-mobile` in a mobile context; a slot
 * carries `data-active`, set for either). One table, so the rule and its CSS
 * cannot drift apart.
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
    holds: ({ searchActive = false }) => searchActive,
    slot: 'group-has-[[data-search-active=true]]/tools:opacity-100',
    container: 'has-[[data-search-active=true]]:opacity-100',
  },
  {
    holds: ({ editing }) => editing,
    slot: 'group-data-[force-visible=true]/tools:opacity-100',
    container: 'data-[force-visible=true]:opacity-100',
  },
  {
    holds: ({ tool, active, dirty = false }) => (tool === 'filter' || tool === 'sort') && (active || dirty),
    slot: 'data-[active=true]:opacity-100',
    container: 'data-[has-active=true]:opacity-100',
  },
  {
    holds: ({ coarsePointer }) => coarsePointer,
    slot: '[@media(pointer:coarse)]:opacity-100',
    container: '[@media(pointer:coarse)]:opacity-100',
  },
  {
    holds: ({ mobile = false }) => mobile,
    slot: 'group-data-[mobile=true]/tools:opacity-100',
    container: 'data-[mobile=true]:opacity-100',
  },
];

/**
 * Whether a tool is shown. Hidden tools keep their slot and stay focusable and
 * clickable; only their opacity changes. An active filter or sort stays shown,
 * and so does one with an unsaved dot; an expanded search field keeps them all,
 * and a mobile context always shows every tool.
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
