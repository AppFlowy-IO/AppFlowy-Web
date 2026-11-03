import { render, screen } from '@testing-library/react';

import { DatabaseContext, DatabaseContextState, DatabaseViewOverlayContext } from '@/application/database-yjs';
import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { createViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import { DatabaseViewLayout } from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import { WidgetPrivateContext, WidgetPrivateSnapshot } from '../private/WidgetPrivateContext';
import { WidgetActions } from '../widget-tool-buttons/WidgetActions';
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
    /** WP09: absent means widget. */
    context?: 'widget' | 'standalone';
    /** WP14b: a mobile context; absent means false. */
    mobile?: boolean;
    role: 'writer' | 'reader' | 'published' | 'read-only';
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

/**
 * The rendered control of each tool, as the visual-parity probe and the BDD
 * steps find it. `+ New` is a split button: its container carries the parity
 * id, its `+` the accessible name.
 */
const TOOL_BUTTONS: Record<WidgetTool, { testId: string; parityId: string; label: string; labelTestId?: string }> = {
  filter: { testId: 'database-actions-filter', parityId: 'dash-widget-tool-filter', label: 'grid.settings.filter' },
  sort: { testId: 'database-actions-sort', parityId: 'dash-widget-tool-sort', label: 'grid.settings.sort' },
  search: { testId: 'database-actions-search', parityId: 'dash-widget-tool-search', label: 'search.label' },
  new: {
    testId: 'database-template-split-button',
    parityId: 'dash-widget-tool-new',
    label: 'New',
    labelTestId: 'database-new-row-button',
  },
  settings: { testId: 'dashboard-widget-settings-button', parityId: 'dash-widget-tool-settings', label: 'Settings' },
};

// The shipped capabilities (`WIDGET_TOOL_CAPS`, WP09) of a widget header, plus the
// form and dashboard rows (no tools under any capabilities), which only wp03 lists.
const CASES = loadParityFixture<WidgetToolsFixture>('widget-tools.json').cases.filter(
  (entry) =>
    (entry.context ?? 'widget') === 'widget' &&
    (entry.caps === 'wp09' || entry.layout === 'form' || entry.layout === 'dashboard')
);

/**
 * A widget's header tools as `WidgetHeader` renders them (`WidgetActions`
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
    <AFConfigContext.Provider
      value={{ isAuthenticated: false, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}
    >
      <DatabaseContext.Provider value={context}>
        <DatabaseViewOverlayContext.Provider value={overlay?.view}>
          <WidgetContext.Provider
            value={createWidgetContextValue({
              editing: entry.editing,
              canEdit: entry.can_write,
              mobileContext: entry.mobile ?? false,
            })}
          >
            <WidgetActions />
          </WidgetContext.Provider>
        </DatabaseViewOverlayContext.Provider>
      </DatabaseContext.Provider>
    </AFConfigContext.Provider>
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

  it.each(
    CASES.map(
      (entry) =>
        [
          entry.role,
          entry.layout,
          entry.editing ? 'Edit' : 'View',
          entry.mobile ? 'on a phone' : 'on desktop',
          entry,
        ] as const
    )
  )('a %s of a %s widget sees exactly its tools in %s mode %s', (_role, _layout, _mode, _platform, entry) => {
    const overlay = renderWidgetTools(entry);
    const tools = screen.queryByTestId('database-actions');

    if (entry.expected.length === 0) {
      expect(tools).toBeNull();
    } else {
      expect(tools?.getAttribute('data-parity-id')).toBe('dash-widget-tools');
      // A phone's tools are always shown (WP14 §1.4.4).
      expect(tools?.getAttribute('data-mobile')).toBe(entry.mobile ? 'true' : null);
      if (entry.mobile) expect(tools?.getAttribute('data-force-visible')).toBe('true');
      expect(
        Array.from(tools?.querySelectorAll('[data-widget-tool]') ?? []).map((slot) =>
          slot.getAttribute('data-widget-tool')
        )
      ).toEqual(entry.expected);
    }

    // Each slot holds its tool's control, and no other widget tool renders.
    entry.expected.forEach((tool) => {
      const button = TOOL_BUTTONS[tool];
      const element = screen.getByTestId(button.testId);

      expect(element.closest('[data-widget-tool]')?.getAttribute('data-widget-tool')).toBe(tool);
      expect(element.getAttribute('data-parity-id')).toBe(button.parityId);
      expect(screen.getByTestId(button.labelTestId ?? button.testId).getAttribute('aria-label')).toBe(button.label);
    });
    expect(
      Array.from(document.querySelectorAll('[data-parity-id^="dash-widget-tool-"]'))
        .map((element) => element.getAttribute('data-parity-id'))
        .filter((parityId) => !parityId?.includes('__'))
    ).toEqual(entry.expected.map((tool) => TOOL_BUTTONS[tool].parityId));
    // A widget never shows the database toolbar.
    expect(screen.queryByTestId('database-actions-settings')).toBeNull();
    expect(screen.queryByTestId('database-actions-open-as-page')).toBeNull();
    overlay?.destroy();
  });
});

describe('a tool with unsaved private changes (WP07)', () => {
  it('stays shown without hover and carries the dot', () => {
    const { doc, view } = createDatabaseDoc({
      id: 'source-db',
      views: [{ id: 'v1', name: 'Tasks', layout: DatabaseViewLayout.Grid }],
    });
    const overlay = createViewConditionsOverlay(view('v1'));
    const snapshot: WidgetPrivateSnapshot = { filters: false, sorts: true, canSave: false, suspended: false };
    const handle = { subscribe: () => () => undefined, getSnapshot: () => snapshot, reset: jest.fn(), save: jest.fn() };

    render(
      <DatabaseContext.Provider
        value={{
          databaseDoc: doc,
          databasePageId: 'v1',
          activeViewId: 'v1',
          readOnly: true,
          rowMap: {},
          workspaceId: 'workspace-id',
          isDocumentBlock: true,
          isDashboardWidget: true,
        }}
      >
        <DatabaseViewOverlayContext.Provider value={overlay.view}>
          <WidgetContext.Provider value={createWidgetContextValue({ canEdit: false })}>
            <WidgetPrivateContext.Provider value={{ getWidgetPrivateHandle: () => handle }}>
              <WidgetActions />
            </WidgetPrivateContext.Provider>
          </WidgetContext.Provider>
        </DatabaseViewOverlayContext.Provider>
      </DatabaseContext.Provider>
    );

    const slot = (tool: WidgetTool) => document.querySelector(`[data-widget-tool="${tool}"]`);

    // The sort part has no rule left (a saved sort removed privately) but is unsaved.
    expect(slot('sort')?.getAttribute('data-active')).toBe('true');
    expect(slot('filter')?.getAttribute('data-active')).toBe('false');
    expect(screen.getByTestId('database-actions').getAttribute('data-has-active')).toBe('true');
    expect(screen.getByTestId('database-actions-sort-dot')).toBeTruthy();
    expect(screen.queryByTestId('database-actions-filter-dot')).toBeNull();
    overlay.destroy();
  });
});
