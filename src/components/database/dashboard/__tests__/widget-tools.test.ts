import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { DatabaseViewLayout } from '@/application/types';

import {
  getDashboardWidgetTools,
  isWidgetToolVisible,
  WIDGET_TOOL_CAPS,
  WidgetTool,
  WidgetToolCaps,
  widgetToolsContainerClass,
  widgetToolSlotClass,
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

describe('widgetToolSlotClass', () => {
  it('expresses the visibility rule in CSS, fading over 150ms and never disabling the pointer', () => {
    const className = widgetToolSlotClass();

    for (const name of [
      'opacity-0',
      'duration-150',
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

describe('widgetToolsContainerClass', () => {
  it('hides the whole group at rest and shows it whenever one of its tools may show', () => {
    const className = widgetToolsContainerClass();

    for (const name of [
      'opacity-0',
      'transition-opacity',
      'duration-150',
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
