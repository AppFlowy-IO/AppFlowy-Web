import { act, fireEvent, render, screen } from '@testing-library/react';
import { MutableRefObject } from 'react';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { readDashboardLayoutSetting, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import {
  markDashboardCreatedThisSession,
  resetDashboardSessionForTests,
  wasDashboardCreatedThisSession,
} from '@/application/database-yjs/dashboard-session';
import { DashboardGlobalFilter, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';

import { Dashboard } from '../Dashboard';
import { DashboardActions } from '../DashboardActions';
import {
  DashboardContextValue,
  DashboardFiltersContextValue,
  DashboardProvider,
  useDashboardContext,
  useDashboardFilters,
} from '../DashboardContext';
import { WidgetPickerRequest } from '../DashboardUiContext';
import { DashboardModeSnapshot, DashboardModeStore } from '../hooks/useDashboardModeStore';

import { createDatabaseDoc as createDatabaseFixture, makeRowsFor, resizeTo } from './dashboardTestHarness';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) =>
      (options?.defaultValue ?? key).replace('{{count}}', String(options?.count ?? '')),
  }),
}));

// The indicator package ships compiled CSS that jest cannot parse.
jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({
  DropIndicator: ({ edge }: { edge: string }) => <div data-edge={edge} data-testid='drop-indicator' />,
}));

// jsdom computes no Tailwind overflow, so auto-scroll would warn on every mount.
jest.mock('@atlaskit/pragmatic-drag-and-drop-auto-scroll/element', () => ({
  autoScrollForElements: () => () => undefined,
}));

jest.mock('../global-filters/GlobalFilterBar', () => ({
  GlobalFilterBar: () => <div data-testid='global-filter-bar-stub' />,
}));

jest.mock('../global-filters/GlobalFilterButton', () => ({
  GlobalFilterButton: () => <button data-testid='global-filter-button-stub' type='button' />,
}));

jest.mock('../DashboardWidget', () => ({
  DashboardWidget: ({ widget }: { widget: { id: string; viewId: string } }) => (
    <div data-testid='dashboard-widget' data-view-id={widget.viewId} data-widget-id={widget.id} />
  ),
}));

jest.mock('../WidgetPicker', () => ({
  WidgetPicker: ({ request, onClose }: { request: WidgetPickerRequest | null; onClose: () => void }) =>
    request ? (
      <div data-testid='dashboard-widget-picker'>
        <button data-testid='close-picker' onClick={onClose} type='button' />
      </div>
    ) : null,
}));

jest.mock('../hooks/useWorkspaceDatabases', () => ({
  useWorkspaceDatabases: () => ({ databases: [], loading: false, error: null }),
}));

jest.mock('../hooks/useCreateWidgetView', () => ({
  useCreateWidgetView: () => ({ createView: jest.fn(), canCreateInOtherDatabases: true, bridge: null }),
}));

const DATABASE_ID = 'host-database';
const VIEW_ID = 'dashboard-view';
const initialWidth = window.innerWidth;

const GLOBAL_FILTER: DashboardGlobalFilter = {
  id: 'gf:status',
  name: 'Status',
  fieldType: FieldType.RichText,
  condition: 0,
  content: 'done',
  targets: { [DATABASE_ID]: 'status' },
};

const makeRows = makeRowsFor(DATABASE_ID);

/** The host database with its dashboard view holding `rows`. */
function createDatabaseDoc(rows: DashboardRow[]) {
  const fixture = createDatabaseFixture({ id: DATABASE_ID, views: [{ id: VIEW_ID, rows }] });

  return { doc: fixture.doc, database: fixture.database, view: fixture.view(VIEW_ID) };
}

type Probe = MutableRefObject<{
  context: DashboardContextValue;
  filters: DashboardFiltersContextValue;
} | null>;

function ContextProbe({ probe }: { probe: Probe }) {
  probe.current = { context: useDashboardContext(), filters: useDashboardFilters() };
  return null;
}

/**
 * Records the Edit preference the provider would remember, without ever
 * handing it back: to the provider it is the same as having no store.
 */
class PreferenceRecorder extends Map<string, DashboardModeSnapshot> {
  get(_viewId: string): DashboardModeSnapshot | undefined {
    return undefined;
  }

  recorded(viewId: string) {
    return super.get(viewId);
  }
}

/** The Dashboard.test harness, plus a probe and an optional mode store. */
function renderDashboard(
  rows: DashboardRow[],
  { readOnly = false, modeStore }: { readOnly?: boolean; modeStore?: DashboardModeStore } = {}
) {
  const db = createDatabaseDoc(rows);
  const probe: Probe = { current: null };
  let currentStore: DashboardModeStore = modeStore ?? new PreferenceRecorder();
  const tree = (nextReadOnly: boolean, store: DashboardModeStore | undefined) => {
    const value: DatabaseContextState = {
      readOnly: nextReadOnly,
      databaseDoc: db.doc,
      databasePageId: VIEW_ID,
      activeViewId: VIEW_ID,
      rowMap: {},
      workspaceId: 'workspace-id',
    };

    return (
      <DatabaseContext.Provider value={value}>
        <DashboardProvider modeStore={store}>
          <ContextProbe probe={probe} />
          {/* As the database toolbar renders it: the host database as primitives. */}
          <DashboardActions activeViewId={VIEW_ID} databasePageId={VIEW_ID} readOnly={nextReadOnly} />
          <Dashboard />
        </DashboardProvider>
      </DatabaseContext.Provider>
    );
  };

  let currentReadOnly = readOnly;
  let result = render(tree(readOnly, currentStore));

  return {
    // The app drops write access while it re-probes permissions (back on the tab, a reconnect).
    setReadOnly: (nextReadOnly: boolean) => {
      currentReadOnly = nextReadOnly;
      result.rerender(tree(nextReadOnly, currentStore));
    },
    // Unmount and mount the provider again on the same doc (a tab switch and back).
    remount: (store: DashboardModeStore | undefined = modeStore) => {
      result.unmount();
      currentStore = store ?? new PreferenceRecorder();
      result = render(tree(currentReadOnly, currentStore));
    },
    unmount: () => result.unmount(),
    context: () => probe.current?.context as DashboardContextValue,
    /** The Edit preference behind `isEditing`: what the provider hands its mode store. */
    preference: () =>
      (currentStore instanceof PreferenceRecorder ? currentStore.recorded(VIEW_ID) : currentStore.get(VIEW_ID))
        ?.preference,
    filters: () => probe.current?.filters as DashboardFiltersContextValue,
    persisted: () => readDashboardLayoutSetting(db.database, VIEW_ID),
    // A write that bypasses the provider: the server sync or a collaborator.
    writeRows: (next: DashboardRow[]) =>
      act(() => {
        db.doc.transact(() => updateDashboardLayoutSetting(db.view, { rows: next }));
      }),
    countUpdates: () => {
      const listener = jest.fn();

      db.doc.on('update', listener);
      return listener;
    },
  };
}

function editing() {
  return screen.getByTestId('dashboard-view').getAttribute('data-editing');
}

describe('DashboardProvider R-MODE', () => {
  beforeEach(() => {
    resizeTo(1440);
  });

  afterEach(() => {
    resizeTo(initialWidth);
    resetDashboardSessionForTests();
    jest.restoreAllMocks();
  });

  it('(a) #39: an empty dashboard enters Edit mode when write access arrives after it opened', () => {
    const { setReadOnly, context, preference } = renderDashboard([], { readOnly: true });

    expect(editing()).toBe('false');
    expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
    expect(screen.queryByTestId('dashboard-empty-edit-button')).toBeNull();
    expect(preference()).toBe('auto_on');

    setReadOnly(false);

    expect(editing()).toBe('true');
    expect(screen.getByTestId('dashboard-done-button')).toBeTruthy();
    expect(context().canEnterEdit).toBe(true);
  });

  it('(b) Edit mode comes back after a brief loss of write access', () => {
    const { setReadOnly, preference } = renderDashboard(makeRows(['a', 'b']));

    fireEvent.click(screen.getByTestId('dashboard-edit-button'));
    expect(editing()).toBe('true');

    setReadOnly(true);
    expect(editing()).toBe('false');
    expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
    expect(screen.queryByTestId('dashboard-done-button')).toBeNull();
    expect(preference()).toBe('on');

    setReadOnly(false);
    expect(editing()).toBe('true');
    expect(screen.getByTestId('dashboard-done-button')).toBeTruthy();
    expect(screen.getAllByTestId('dashboard-width-handle')).toHaveLength(1);
  });

  it('(c) Done stays done after a brief loss of write access', () => {
    const { setReadOnly, preference } = renderDashboard(makeRows(['a', 'b']));

    fireEvent.click(screen.getByTestId('dashboard-edit-button'));
    fireEvent.click(screen.getByTestId('dashboard-done-button'));
    setReadOnly(true);
    setReadOnly(false);

    expect(editing()).toBe('false');
    expect(preference()).toBe('off');
    expect(screen.getByTestId('dashboard-edit-button')).toBeTruthy();
  });

  it('(d) a narrow window hides Edit mode and keeps the preference for a wide one', () => {
    const { context, preference } = renderDashboard(makeRows(['a', 'b']));

    fireEvent.click(screen.getByTestId('dashboard-edit-button'));
    resizeTo(390);

    expect(editing()).toBe('false');
    expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
    expect(screen.queryByTestId('dashboard-done-button')).toBeNull();
    expect(screen.queryByTestId('dashboard-width-handle')).toBeNull();
    expect(screen.getByTestId('dashboard-actions').getAttribute('data-mobile')).toBe('true');
    expect(context().mobileContext).toBe(true);
    expect(context().canEnterEdit).toBe(false);
    expect(context().canEdit).toBe(true);
    expect(preference()).toBe('on');

    // Edit cannot be entered from a mobile context.
    act(() => context().setEditing(true));
    expect(context().isEditing).toBe(false);

    resizeTo(1440);
    expect(editing()).toBe('true');
    expect(screen.getByTestId('dashboard-done-button')).toBeTruthy();
    expect(screen.getByTestId('dashboard-actions').hasAttribute('data-mobile')).toBe(false);
  });

  it('(e) a mobile context refuses Edit-only writes and keeps View-mode writes', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rows = makeRows(['a']);
    const { context, filters, persisted, countUpdates } = renderDashboard(rows);

    resizeTo(390);
    const updates = countUpdates();

    act(() =>
      context().updateRows((current) => [
        ...current,
        { id: 'r2', height: 360, widgets: [{ id: 'b', viewId: 'view-b', databaseId: DATABASE_ID, width: 12 }] },
      ])
    );
    act(() => context().updateSetting({ showWidgetTitles: false }));
    act(() => context().updateSetting({ rows: [], globalFilters: [GLOBAL_FILTER] }));

    expect(updates).not.toHaveBeenCalled();
    expect(persisted().rows).toEqual(rows);
    expect(persisted().showWidgetTitles).toBe(true);
    expect(persisted().globalFilters).toEqual([]);
    expect(warn).toHaveBeenCalledWith('[Dashboard] edit-only write refused on mobile', ['rows']);
    expect(warn).toHaveBeenCalledWith('[Dashboard] edit-only write refused on mobile', ['showWidgetTitles']);

    // Global filters and "Save for everyone" are View-mode writes.
    act(() => context().updateSetting({ globalFilters: [GLOBAL_FILTER] }));
    expect(persisted().globalFilters).toEqual([GLOBAL_FILTER]);

    const saved = { ...GLOBAL_FILTER, content: 'doing' };

    act(() => filters().commitViewOverlays([saved]));
    expect(persisted().globalFilters).toEqual([saved]);
    expect(persisted().rows).toEqual(rows);
    expect(updates).toHaveBeenCalledTimes(2);
  });

  it('(e) a mobile context refuses the "Show icons in heading" toggle', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { context, persisted, countUpdates } = renderDashboard(makeRows(['a']));

    resizeTo(390);
    const updates = countUpdates();

    act(() => context().updateSetting({ showIconsInHeading: true }));

    expect(updates).not.toHaveBeenCalled();
    expect(persisted().showIconsInHeading).toBe(false);
    expect(warn).toHaveBeenCalledWith('[Dashboard] edit-only write refused on mobile', ['showIconsInHeading']);

    // Outside a mobile context the same write persists.
    resizeTo(1440);
    act(() => context().updateSetting({ showIconsInHeading: true }));
    expect(persisted().showIconsInHeading).toBe(true);
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it('(f) a dashboard created in this session opens in Edit mode once, even with widgets', () => {
    markDashboardCreatedThisSession(VIEW_ID);
    const { remount, preference } = renderDashboard(makeRows(['a']), { modeStore: new Map() });

    expect(editing()).toBe('true');
    expect(preference()).toBe('auto_on');
    // Consumed by the first open.
    expect(wasDashboardCreatedThisSession(VIEW_ID)).toBe(false);

    // Reopened later (a new page, so a new store): its rows decide.
    remount(new Map());
    expect(editing()).toBe('false');
    expect(preference()).toBe('off');
  });

  it('(g) remote widgets end the automatic Edit mode unless the editor started building', () => {
    const first = renderDashboard([]);

    expect(editing()).toBe('true');
    first.writeRows(makeRows(['a']));
    expect(editing()).toBe('false');
    expect(first.preference()).toBe('off');
    first.unmount();

    const second = renderDashboard([]);

    fireEvent.click(screen.getByTestId('dashboard-add-widget-button'));
    expect(second.preference()).toBe('on');
    fireEvent.click(screen.getByTestId('close-picker'));
    second.writeRows(makeRows(['a']));
    expect(editing()).toBe('true');
    second.unmount();

    const third = renderDashboard([]);

    act(() => third.context().pinEditing());
    third.writeRows(makeRows(['a']));
    expect(editing()).toBe('true');
  });

  it('(h) the mode store keeps Edit mode across a provider remount (a tab switch and back)', () => {
    const store: DashboardModeStore = new Map();
    const { remount, preference } = renderDashboard(makeRows(['a', 'b']), { modeStore: store });

    fireEvent.click(screen.getByTestId('dashboard-edit-button'));
    expect(store.get(VIEW_ID)?.preference).toBe('on');

    remount();
    expect(editing()).toBe('true');
    expect(preference()).toBe('on');

    fireEvent.click(screen.getByTestId('dashboard-done-button'));
    remount();
    expect(editing()).toBe('false');
  });

  it('(h) widgets that arrived while another tab was shown still end the automatic Edit mode', () => {
    const store: DashboardModeStore = new Map();
    const { remount, writeRows, unmount } = renderDashboard([], { modeStore: store });

    expect(editing()).toBe('true');
    unmount();
    writeRows(makeRows(['a']));

    remount();
    expect(editing()).toBe('false');
    expect(store.get(VIEW_ID)).toEqual({ preference: 'off', rowsEmpty: false });
  });

  it("pins the automatic Edit mode as the editor's own, which a mobile context only hides", () => {
    const { context, preference } = renderDashboard([]);

    expect(context()).toMatchObject({ isEditing: true, canEnterEdit: true, mobileContext: false });
    expect(preference()).toBe('auto_on');

    act(() => context().pinEditing());
    expect(preference()).toBe('on');
    resizeTo(390);
    expect(context()).toMatchObject({ isEditing: false, canEnterEdit: false, mobileContext: true });
    expect(preference()).toBe('on');
  });

  it('keeps the context identity when the preference changes without changing the mode', () => {
    const { context, preference } = renderDashboard([]);
    const before = context();

    // `auto_on` to `on`: Edit mode before and after, so no consumer has anything to render.
    act(() => context().pinEditing());
    expect(preference()).toBe('on');
    expect(context()).toBe(before);
    expect('editPreference' in context()).toBe(false);
  });

  it('keeps the mode actions stable and never persists the mode', () => {
    const { context, countUpdates } = renderDashboard(makeRows(['a']));
    const updates = countUpdates();
    const { setEditing, pinEditing } = context();

    act(() => context().setEditing(true));
    act(() => context().pinEditing());

    expect(context().setEditing).toBe(setEditing);
    expect(context().pinEditing).toBe(pinEditing);
    expect(updates).not.toHaveBeenCalled();
  });
});
