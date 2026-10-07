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
  WidgetToolContext,
  WP03_WIDGET_TOOL_CAPS,
} from '../widget-tools';

/** `dashboard-parity/widget-tools.json` (WP03), shared with desktop. */
interface WidgetToolsFixture {
  caps: Record<string, { content_tools: boolean; sort_layouts: string[] }>;
  cases: {
    caps: string;
    /** WP09: absent means widget. */
    context?: WidgetToolContext;
    /** WP14b: a mobile context; absent means false. */
    mobile?: boolean;
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
    /** WP07: absent means false. */
    dirty?: boolean;
    /** WP09: absent means false. */
    search_active?: boolean;
    /** WP14b: absent means false. */
    mobile?: boolean;
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
  // WP09 turned the content tools on and added Board to the sortable layouts, on both clients.
  it('equals the fixture wp09 capabilities', () => {
    expect(WIDGET_TOOL_CAPS.contentTools).toBe(fixture.caps.wp09.content_tools);
    expect([...WIDGET_TOOL_CAPS.sortLayouts].sort()).toEqual(fixture.caps.wp09.sort_layouts.map(layoutOf).sort());
  });

  it('keeps the earlier wp03 capabilities as WP03_WIDGET_TOOL_CAPS', () => {
    expect(WP03_WIDGET_TOOL_CAPS.contentTools).toBe(fixture.caps.wp03.content_tools);
    expect([...WP03_WIDGET_TOOL_CAPS.sortLayouts].sort()).toEqual(fixture.caps.wp03.sort_layouts.map(layoutOf).sort());
  });

  it('sorts where the toolbar sorts: one set for both, boards included', () => {
    expect(WIDGET_TOOL_CAPS.sortLayouts).toBe(SORTABLE_LAYOUTS);
    expect(SORTABLE_LAYOUTS.has(DatabaseViewLayout.Board)).toBe(true);
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
    fixture.cases.map(
      (entry) =>
        [
          entry.caps,
          entry.mobile ? 'mobile' : entry.context ?? 'widget',
          entry.role,
          entry.layout,
          entry.editing ? 'Edit' : 'View',
          entry,
        ] as const
    )
  )('%s %s: a %s gets these %s tools in %s mode', (_caps, _context, _role, _layout, _mode, entry) => {
    expect(
      getDashboardWidgetTools({
        layout: layoutOf(entry.layout),
        editing: entry.editing,
        canWrite: entry.can_write,
        canEditConditions: entry.can_edit_conditions,
        caps: capsOf(entry.caps),
        context: entry.context ?? 'widget',
        mobile: entry.mobile ?? false,
      })
    ).toEqual(entry.expected);
  });

  // WP14 §1.4.4: every widget layout, role and capability set has a mobile case.
  it('covers the mobile header of every widget layout, for writers, readers and published viewers', () => {
    const mobile = fixture.cases.filter((entry) => entry.mobile === true);
    const widgetLayouts = ['grid', 'board', 'calendar', 'chart', 'list', 'gallery', 'feed', 'timeline'];

    for (const caps of ['wp03', 'wp09']) {
      for (const role of ['writer', 'reader', 'published']) {
        const layouts = mobile
          .filter((entry) => entry.caps === caps && entry.role === role && !entry.editing)
          .map((entry) => entry.layout);

        expect(widgetLayouts.every((layout) => layouts.includes(layout))).toBe(true);
      }
    }

    // Search then Filter, never Sort, New or Settings, even with an editing input.
    mobile.forEach((entry) => {
      expect(entry.expected).toEqual(
        (['search', 'filter'] as WidgetTool[]).filter((tool) => entry.expected.includes(tool))
      );
    });
    expect(
      mobile.find((entry) => entry.caps === 'wp09' && entry.role === 'writer' && entry.layout === 'grid')?.expected
    ).toEqual(['search', 'filter']);
    expect(
      mobile.find((entry) => entry.caps === 'wp09' && entry.role === 'writer' && entry.layout === 'chart')?.expected
    ).toEqual(['filter']);
  });

  it('ignores the mobile flag in the standalone toolbar', () => {
    const input = { layout: DatabaseViewLayout.Grid, editing: false, canWrite: true, canEditConditions: true };

    expect(getDashboardWidgetTools({ ...input, context: 'standalone', mobile: true })).toEqual(
      getDashboardWidgetTools({ ...input, context: 'standalone' })
    );
  });

  it('defaults to the WP09 capabilities in a widget', () => {
    expect(
      getDashboardWidgetTools({
        layout: DatabaseViewLayout.Board,
        editing: false,
        canWrite: true,
        canEditConditions: true,
      })
    ).toEqual(['filter', 'sort', 'search', 'new']);
  });

  it('covers the standalone toolbar of every layout the fixture lists, for writers and read-only viewers', () => {
    const standalone = fixture.cases.filter((entry) => entry.context === 'standalone');

    expect(new Set(standalone.map((entry) => entry.role))).toEqual(new Set(['writer', 'read-only']));
    expect(standalone.every((entry) => !entry.editing)).toBe(true);
    // Read-only Grid/List/Board still search; the standalone toolbar adds Settings and New for writers.
    expect(standalone.find((entry) => entry.role === 'read-only' && entry.layout === 'board')?.expected).toEqual([
      'search',
    ]);
    expect(standalone.find((entry) => entry.role === 'writer' && entry.layout === 'grid')?.expected).toEqual([
      'filter',
      'sort',
      'search',
      'settings',
      'new',
    ]);
  });

  it('gives a Form view a standalone Filter only, and a dashboard none (its own toolbar)', () => {
    const input = { editing: false, canWrite: true, canEditConditions: true, context: 'standalone' as const };

    expect(getDashboardWidgetTools({ ...input, layout: DatabaseViewLayout.Form })).toEqual(['filter']);
    expect(getDashboardWidgetTools({ ...input, layout: DatabaseViewLayout.Dashboard })).toEqual([]);
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
          dirty: entry.dirty ?? false,
          searchActive: entry.search_active ?? false,
          mobile: entry.mobile ?? false,
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
      'searchActive',
      { searchActive: true },
      'group-has-[[data-search-active=true]]/tools:opacity-100',
      'has-[[data-search-active=true]]:opacity-100',
    ],
    [
      'coarsePointer',
      { coarsePointer: true },
      '[@media(pointer:coarse)]:opacity-100',
      '[@media(pointer:coarse)]:opacity-100',
    ],
    ['mobile', { mobile: true }, 'group-data-[mobile=true]/tools:opacity-100', 'data-[mobile=true]:opacity-100'],
  ] as const)(
    'shows a filter tool when %s holds, in the rule and in both classes',
    (_name, condition, slot, container) => {
      expect(isWidgetToolVisible({ tool: 'filter', ...HIDDEN })).toBe(false);
      expect(isWidgetToolVisible({ tool: 'filter', ...HIDDEN, ...condition })).toBe(true);
      expect(WIDGET_TOOL_SLOT_CLASS.split(' ')).toContain(slot);
      expect(WIDGET_TOOLS_CONTAINER_CLASS.split(' ')).toContain(container);
    }
  );

  it('keeps a filter or sort tool with an unsaved dot shown, through the active class', () => {
    // A dirty part can have no rule at all (a saved filter removed privately); its slot carries `data-active`.
    expect(isWidgetToolVisible({ tool: 'filter', ...HIDDEN, dirty: true })).toBe(true);
    expect(isWidgetToolVisible({ tool: 'sort', ...HIDDEN, dirty: true })).toBe(true);
    expect(isWidgetToolVisible({ tool: 'search', ...HIDDEN, dirty: true })).toBe(false);
    expect(isWidgetToolVisible({ tool: 'settings', ...HIDDEN, dirty: true })).toBe(false);
    expect(fixture.visibility.filter((entry) => entry.dirty === true).map((entry) => entry.tool)).toEqual([
      'filter',
      'sort',
      'search',
      'settings',
    ]);
  });

  it('keeps every tool shown while the search field is expanded (WP09)', () => {
    (['filter', 'sort', 'search', 'new', 'settings'] as WidgetTool[]).forEach((tool) => {
      expect(isWidgetToolVisible({ tool, ...HIDDEN, searchActive: true })).toBe(true);
    });
    expect(fixture.visibility.filter((entry) => entry.search_active === true).map((entry) => entry.tool)).toEqual([
      'filter',
      'sort',
      'search',
      'new',
      'settings',
    ]);
  });

  it('shows every tool in a mobile context, without hover (WP14b)', () => {
    (['filter', 'sort', 'search', 'new', 'settings'] as WidgetTool[]).forEach((tool) => {
      expect(isWidgetToolVisible({ tool, ...HIDDEN, mobile: true })).toBe(true);
      expect(isWidgetToolVisible({ tool, ...HIDDEN, mobile: false })).toBe(false);
    });
    expect(fixture.visibility.filter((entry) => entry.mobile === true).map((entry) => entry.tool)).toEqual([
      'search',
      'filter',
      'sort',
      'new',
      'settings',
    ]);
    expect(fixture.visibility.filter((entry) => entry.mobile === true).every((entry) => entry.expected)).toBe(true);
  });

  // Eight conditions since WP14b added the mobile context (WP09 added the expanded search field).
  it('has exactly one class per condition', () => {
    const shown = (className: string) => className.split(' ').filter((name) => name.endsWith(':opacity-100'));

    expect(shown(WIDGET_TOOL_SLOT_CLASS)).toHaveLength(8);
    expect(shown(WIDGET_TOOLS_CONTAINER_CLASS)).toHaveLength(8);
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
