import { render, screen } from '@testing-library/react';

import { DatabaseContext, DatabaseContextState, DatabaseViewOverlayContext } from '@/application/database-yjs';
import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { createViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import { DatabaseViewLayout } from '@/application/types';
import { DatabaseActions } from '@/components/database/components/conditions/DatabaseActions';

import { WidgetTool } from '../widget-tools';
import { WidgetContext } from '../WidgetContext';

import { createDatabaseDoc, createWidgetContextValue } from './dashboardTestHarness';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

/** `dashboard-parity/widget-tools.json` (WP03), shared with desktop. */
interface WidgetToolsFixture {
  cases: {
    caps: string;
    role: 'writer' | 'reader' | 'published';
    layout: string;
    editing: boolean;
    can_write: boolean;
    can_edit_conditions: boolean;
    expected: WidgetTool[];
  }[];
}

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

/** The rendered button of each tool, as the visual-parity probe and the BDD steps find it. */
const TOOL_BUTTONS: Partial<Record<WidgetTool, { testId: string; parityId: string; label: string }>> = {
  filter: { testId: 'database-actions-filter', parityId: 'dash-widget-tool-filter', label: 'grid.settings.filter' },
  sort: { testId: 'database-actions-sort', parityId: 'dash-widget-tool-sort', label: 'grid.settings.sort' },
  settings: { testId: 'dashboard-widget-settings-button', parityId: 'dash-widget-tool-settings', label: 'Settings' },
};

// The shipped capabilities (`WIDGET_TOOL_CAPS`); the WP09 tools have no component yet.
const CASES = loadParityFixture<WidgetToolsFixture>('widget-tools.json').cases.filter((entry) => entry.caps === 'wp03');

/**
 * A widget's header tools as `WidgetHeader` renders them (`DatabaseActions`
 * inside the widget's nested database): a writer edits the shared view, a
 * reader its own copy (the View-mode overlay), a published page nothing.
 */
function renderWidgetTools(entry: WidgetToolsFixture['cases'][number]) {
  const { doc, view } = createDatabaseDoc({
    id: 'source-db',
    views: [{ id: 'v1', name: 'Tasks', layout: LAYOUTS[entry.layout] }],
  });
  const overlay = entry.role === 'reader' ? createViewConditionsOverlay(view('v1')) : undefined;
  const context: DatabaseContextState = {
    databaseDoc: doc,
    databasePageId: 'v1',
    activeViewId: 'v1',
    readOnly: !entry.can_write,
    rowMap: {},
    workspaceId: 'workspace-id',
    isDocumentBlock: true,
    isDashboardWidget: true,
  };

  render(
    <DatabaseContext.Provider value={context}>
      <DatabaseViewOverlayContext.Provider value={overlay?.view}>
        <WidgetContext.Provider value={createWidgetContextValue({ editing: entry.editing, canEdit: entry.can_write })}>
          <DatabaseActions />
        </WidgetContext.Provider>
      </DatabaseViewOverlayContext.Provider>
    </DatabaseContext.Provider>
  );
  return overlay;
}

describe('the rendered widget tools (widget-tools.json)', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error');
  });

  afterEach(() => {
    // No React warning (keys, act, refs) while the tools render.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('covers every layout in both modes', () => {
    expect(new Set(CASES.map((entry) => entry.layout))).toEqual(new Set(Object.keys(LAYOUTS)));
    expect(new Set(CASES.map((entry) => entry.editing))).toEqual(new Set([false, true]));
  });

  it.each(CASES.map((entry) => [entry.role, entry.layout, entry.editing ? 'Edit' : 'View', entry] as const))(
    'a %s of a %s widget sees exactly its tools in %s mode',
    (_role, _layout, _mode, entry) => {
      const overlay = renderWidgetTools(entry);
      const tools = screen.queryByTestId('database-actions');

      if (entry.expected.length === 0) {
        expect(tools).toBeNull();
      } else {
        expect(tools?.getAttribute('data-parity-id')).toBe('dash-widget-tools');
        expect(
          Array.from(tools?.querySelectorAll('[data-widget-tool]') ?? []).map((slot) =>
            slot.getAttribute('data-widget-tool')
          )
        ).toEqual(entry.expected);
      }

      // Each slot holds its tool's button, and no other widget tool renders.
      entry.expected.forEach((tool) => {
        const button = TOOL_BUTTONS[tool];

        expect(button).toBeDefined();
        const element = screen.getByTestId(button?.testId ?? '');

        expect(element.closest('[data-widget-tool]')?.getAttribute('data-widget-tool')).toBe(tool);
        expect(element.getAttribute('data-parity-id')).toBe(button?.parityId);
        expect(element.getAttribute('aria-label')).toBe(button?.label);
      });
      expect(
        Array.from(document.querySelectorAll('button[data-parity-id^="dash-widget-tool-"]')).map((element) =>
          element.getAttribute('data-parity-id')
        )
      ).toEqual(entry.expected.map((tool) => TOOL_BUTTONS[tool]?.parityId));
      // A widget never shows the database toolbar.
      expect(screen.queryByTestId('database-actions-settings')).toBeNull();
      expect(screen.queryByTestId('database-actions-open-as-page')).toBeNull();
      overlay?.destroy();
    }
  );
});
