import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { DatabaseViewLayout } from '@/application/types';

import { WIDGET_PICKER_LAYOUTS } from '../constants';
import { isWidgetLayout } from '../widget-status';
import {
  getDashboardWidgetTools,
  isWidgetToolVisible,
  SORTABLE_LAYOUTS,
  WIDGET_TOOL_CAPS,
  WIDGET_TOOL_SLOT_CLASS,
  WIDGET_TOOLS_CONTAINER_CLASS,
  WidgetTool,
  WidgetToolCaps,
} from '../widget-tools';

/** `dashboard-parity/widget-tools.json` (WP03), shared with desktop. */
interface WidgetToolsFixture {
  caps: Record<string, { content_tools: boolean; sort_layouts: string[] }>;
  cases: {
    caps: string;
    role: string;
    layout: string;
    editing: boolean;
    can_write: boolean;
    can_edit_conditions: boolean;
    expected: WidgetTool[];
  }[];
  visibility: {
    tool: WidgetTool;
    active: boolean;
    editing: boolean;
    coarse_pointer: boolean;
    hovered: boolean;
    focus_within: boolean;
    popover_open: boolean;
    expected: boolean;
  }[];
}

const fixture = loadParityFixture<WidgetToolsFixture>('widget-tools.json');

const LAYOUTS: Record<string, DatabaseViewLayout> = {
  grid: DatabaseViewLayout.Grid,
  board: DatabaseViewLayout.Board,
  calendar: DatabaseViewLayout.Calendar,
  chart: DatabaseViewLayout.Chart,
  list: DatabaseViewLayout.List,
  gallery: DatabaseViewLayout.Gallery,
  feed: DatabaseViewLayout.Feed,
  timeline: DatabaseViewLayout.Timeline,
  form: DatabaseViewLayout.Form,
  dashboard: DatabaseViewLayout.Dashboard,
};

function layoutOf(name: string) {
  const layout = LAYOUTS[name];

  if (layout === undefined) throw new Error(`unknown fixture layout ${name}`);
  return layout;
}

function capsOf(name: string): WidgetToolCaps {
  const caps = fixture.caps[name];

  return { contentTools: caps.content_tools, sortLayouts: new Set(caps.sort_layouts.map(layoutOf)) };
}

describe('WIDGET_TOOL_CAPS', () => {
  it('equals the fixture wp03 capabilities', () => {
    expect(WIDGET_TOOL_CAPS.contentTools).toBe(fixture.caps.wp03.content_tools);
    expect([...WIDGET_TOOL_CAPS.sortLayouts].sort()).toEqual(fixture.caps.wp03.sort_layouts.map(layoutOf).sort());
  });

  it('sorts where the toolbar sorts: one set for both', () => {
    expect(WIDGET_TOOL_CAPS.sortLayouts).toBe(SORTABLE_LAYOUTS);
    expect(SORTABLE_LAYOUTS.has(DatabaseViewLayout.Chart)).toBe(false);
  });
});

describe('which layouts can be a widget', () => {
  it('is every database layout but Dashboard', () => {
    Object.values(LAYOUTS).forEach((layout) => {
      expect(isWidgetLayout(layout)).toBe(layout !== DatabaseViewLayout.Dashboard);
    });
  });

  it('offers a new view of every widget layout but Form', () => {
    expect([...WIDGET_PICKER_LAYOUTS].sort()).toEqual(
      Object.values(LAYOUTS)
        .filter((layout) => isWidgetLayout(layout) && layout !== DatabaseViewLayout.Form)
        .sort()
    );
  });

  it('gives a Form widget and a nested dashboard no tools', () => {
    for (const layout of [DatabaseViewLayout.Form, DatabaseViewLayout.Dashboard]) {
      expect(getDashboardWidgetTools({ layout, editing: true, canWrite: true, canEditConditions: true })).toEqual([]);
    }
  });
});

describe('getDashboardWidgetTools', () => {
  it.each(
    fixture.cases.map((entry) => [entry.caps, entry.role, entry.layout, entry.editing ? 'Edit' : 'View', entry] as const)
  )('%s: a %s gets these %s tools in %s mode', (_caps, _role, _layout, _mode, entry) => {
    expect(
      getDashboardWidgetTools({
        layout: layoutOf(entry.layout),
        editing: entry.editing,
        canWrite: entry.can_write,
        canEditConditions: entry.can_edit_conditions,
        caps: capsOf(entry.caps),
      })
    ).toEqual(entry.expected);
  });

  it('defaults to the WP03 capabilities', () => {
    expect(
      getDashboardWidgetTools({
        layout: DatabaseViewLayout.Board,
        editing: false,
        canWrite: true,
        canEditConditions: true,
      })
    ).toEqual(['filter']);
  });
});

describe('isWidgetToolVisible', () => {
  it.each(fixture.visibility.map((entry, index) => [index, entry.tool, entry] as const))(
    'row %s (%s)',
    (_index, _tool, entry) => {
      expect(
        isWidgetToolVisible({
          tool: entry.tool,
          active: entry.active,
          editing: entry.editing,
          coarsePointer: entry.coarse_pointer,
          hovered: entry.hovered,
          focusWithin: entry.focus_within,
          popoverOpen: entry.popover_open,
        })
      ).toBe(entry.expected);
    }
  );
});

describe('the visibility rule and its CSS', () => {
  const HIDDEN = {
    active: false,
    editing: false,
    coarsePointer: false,
    hovered: false,
    focusWithin: false,
    popoverOpen: false,
  };

  it.each([
    ['hovered', { hovered: true }, 'group-hover/widget:opacity-100', 'group-hover/widget:opacity-100'],
    [
      'focusWithin',
      { focusWithin: true },
      'group-focus-within/widget:opacity-100',
      'group-focus-within/widget:opacity-100',
    ],
    [
      'popoverOpen',
      { popoverOpen: true },
      'group-has-[[data-state=open]]/tools:opacity-100',
      'has-[[data-state=open]]:opacity-100',
    ],
    [
      'editing',
      { editing: true },
      'group-data-[force-visible=true]/tools:opacity-100',
      'data-[force-visible=true]:opacity-100',
    ],
    ['active', { active: true }, 'data-[active=true]:opacity-100', 'data-[has-active=true]:opacity-100'],
    [
      'coarsePointer',
      { coarsePointer: true },
      '[@media(pointer:coarse)]:opacity-100',
      '[@media(pointer:coarse)]:opacity-100',
    ],
  ] as const)(
    'shows a filter tool when %s holds, in the rule and in both classes',
    (_name, condition, slot, container) => {
      expect(isWidgetToolVisible({ tool: 'filter', ...HIDDEN })).toBe(false);
      expect(isWidgetToolVisible({ tool: 'filter', ...HIDDEN, ...condition })).toBe(true);
      expect(WIDGET_TOOL_SLOT_CLASS.split(' ')).toContain(slot);
      expect(WIDGET_TOOLS_CONTAINER_CLASS.split(' ')).toContain(container);
    }
  );

  it('has exactly one class per condition', () => {
    const shown = (className: string) => className.split(' ').filter((name) => name.endsWith(':opacity-100'));

    expect(shown(WIDGET_TOOL_SLOT_CLASS)).toHaveLength(6);
    expect(shown(WIDGET_TOOLS_CONTAINER_CLASS)).toHaveLength(6);
  });
});

describe('WIDGET_TOOL_SLOT_CLASS', () => {
  it('expresses the visibility rule in CSS, fading with the fast motion token and never disabling the pointer', () => {
    const className = WIDGET_TOOL_SLOT_CLASS;

    // Each class once: the rule table adds no duplicate.
    expect(new Set(className.split(' ')).size).toBe(className.split(' ').length);
    for (const name of [
      'opacity-0',
      'transition-opacity',
      'duration-[var(--dash-motion-fast)]',
      'ease-[var(--dash-motion-ease)]',
      'motion-reduce:transition-none',
      'group-hover/widget:opacity-100',
      'group-focus-within/widget:opacity-100',
      'group-has-[[data-state=open]]/tools:opacity-100',
      'group-data-[force-visible=true]/tools:opacity-100',
      'data-[active=true]:opacity-100',
      '[@media(pointer:coarse)]:opacity-100',
    ]) {
      expect(className.split(' ')).toContain(name);
    }

    expect(className).not.toContain('pointer-events-none');
  });
});

describe('WIDGET_TOOLS_CONTAINER_CLASS', () => {
  it('hides the whole group at rest and shows it whenever one of its tools may show', () => {
    const className = WIDGET_TOOLS_CONTAINER_CLASS;

    // Each class once: the rule table adds no duplicate.
    expect(new Set(className.split(' ')).size).toBe(className.split(' ').length);
    for (const name of [
      'opacity-0',
      'transition-opacity',
      'duration-[var(--dash-motion-fast)]',
      'ease-[var(--dash-motion-ease)]',
      'motion-reduce:transition-none',
      'group-hover/widget:opacity-100',
      'group-focus-within/widget:opacity-100',
      'has-[[data-state=open]]:opacity-100',
      'data-[force-visible=true]:opacity-100',
      // An active filter or sort keeps the group (and that tool) visible at rest.
      'data-[has-active=true]:opacity-100',
      '[@media(pointer:coarse)]:opacity-100',
    ]) {
      expect(className.split(' ')).toContain(name);
    }

    expect(className).not.toContain('pointer-events-none');
  });
});
