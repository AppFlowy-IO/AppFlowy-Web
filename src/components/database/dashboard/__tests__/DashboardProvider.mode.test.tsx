import { act, fireEvent, render, screen } from '@testing-library/react';
import { MutableRefObject } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { readDashboardLayoutSetting, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import {
  markDashboardCreatedThisSession,
  resetDashboardSessionForTests,
  wasDashboardCreatedThisSession,
} from '@/application/database-yjs/dashboard-session';
import { DashboardGlobalFilter, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

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
import { useDashboardMode } from '../hooks/useDashboardMode';
import { DashboardModeStore } from '../hooks/useDashboardModeStore';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

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

function makeRows(...layout: string[][]): DashboardRow[] {
  return layout.map((ids, index) => ({
    id: `r${index + 1}`,
    height: 360,
    widgets: ids.map((id) => ({ id, viewId: `view-${id}`, databaseId: DATABASE_ID, width: 12 / ids.length })),
  }));
}

function createDatabaseDoc(rows: DashboardRow[]) {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.views, views as never);
  views.set(VIEW_ID, view);
  doc.transact(() => updateDashboardLayoutSetting(view, { rows }));
  return { doc, database, view };
}

type Probe = MutableRefObject<{
  context: DashboardContextValue;
  filters: DashboardFiltersContextValue;
  mode: ReturnType<typeof useDashboardMode>;
} | null>;

function ContextProbe({ probe }: { probe: Probe }) {
  probe.current = { context: useDashboardContext(), filters: useDashboardFilters(), mode: useDashboardMode() };
  return null;
}

/** The Dashboard.test harness, plus a probe and an optional mode store. */
function renderDashboard(
  rows: DashboardRow[],
  { readOnly = false, modeStore }: { readOnly?: boolean; modeStore?: DashboardModeStore } = {}
) {
  const db = createDatabaseDoc(rows);
  const probe: Probe = { current: null };
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
          <DashboardActions />
          <Dashboard />
        </DashboardProvider>
      </DatabaseContext.Provider>
    );
  };

  let currentReadOnly = readOnly;
  let result = render(tree(readOnly, modeStore));

  return {
    // The app drops write access while it re-probes permissions (back on the tab, a reconnect).
    setReadOnly: (nextReadOnly: boolean) => {
      currentReadOnly = nextReadOnly;
      result.rerender(tree(nextReadOnly, modeStore));
    },
    // Unmount and mount the provider again on the same doc (a tab switch and back).
    remount: (store: DashboardModeStore | undefined = modeStore) => {
      result.unmount();
      result = render(tree(currentReadOnly, store));
    },
    unmount: () => result.unmount(),
    context: () => probe.current?.context as DashboardContextValue,
    mode: () => probe.current?.mode as ReturnType<typeof useDashboardMode>,
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

function resizeTo(width: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  });
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
    const { setReadOnly, context } = renderDashboard([], { readOnly: true });

    expect(editing()).toBe('false');
    expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
    expect(screen.queryByTestId('dashboard-empty-edit-button')).toBeNull();
    expect(context().editPreference).toBe('auto_on');

    setReadOnly(false);

    expect(editing()).toBe('true');
    expect(screen.getByTestId('dashboard-done-button')).toBeTruthy();
    expect(context().canEnterEdit).toBe(true);
  });

  it('(b) Edit mode comes back after a brief loss of write access', () => {
    const { setReadOnly, context } = renderDashboard(makeRows(['a', 'b']));

    fireEvent.click(screen.getByTestId('dashboard-edit-button'));
    expect(editing()).toBe('true');

    setReadOnly(true);
    expect(editing()).toBe('false');
    expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
    expect(screen.queryByTestId('dashboard-done-button')).toBeNull();
    expect(context().editPreference).toBe('on');

    setReadOnly(false);
    expect(editing()).toBe('true');
    expect(screen.getByTestId('dashboard-done-button')).toBeTruthy();
    expect(screen.getAllByTestId('dashboard-width-handle')).toHaveLength(1);
  });

  it('(c) Done stays done after a brief loss of write access', () => {
    const { setReadOnly, context } = renderDashboard(makeRows(['a', 'b']));

    fireEvent.click(screen.getByTestId('dashboard-edit-button'));
    fireEvent.click(screen.getByTestId('dashboard-done-button'));
    setReadOnly(true);
    setReadOnly(false);

    expect(editing()).toBe('false');
    expect(context().editPreference).toBe('off');
    expect(screen.getByTestId('dashboard-edit-button')).toBeTruthy();
  });

  it('(d) a narrow window hides Edit mode and keeps the preference for a wide one', () => {
    const { context } = renderDashboard(makeRows(['a', 'b']));

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
    expect(context().editPreference).toBe('on');

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
    const { remount, context } = renderDashboard(makeRows(['a']), { modeStore: new Map() });

    expect(editing()).toBe('true');
    expect(context().editPreference).toBe('auto_on');
    // Consumed by the first open.
    expect(wasDashboardCreatedThisSession(VIEW_ID)).toBe(false);

    // Reopened later (a new page, so a new store): its rows decide.
    remount(new Map());
    expect(editing()).toBe('false');
    expect(context().editPreference).toBe('off');
  });

  it('(g) remote widgets end the automatic Edit mode unless the editor started building', () => {
    const first = renderDashboard([]);

    expect(editing()).toBe('true');
    first.writeRows(makeRows(['a']));
    expect(editing()).toBe('false');
    expect(first.context().editPreference).toBe('off');
    first.unmount();

    const second = renderDashboard([]);

    fireEvent.click(screen.getByTestId('dashboard-add-widget-button'));
    expect(second.context().editPreference).toBe('on');
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
    const { remount, context } = renderDashboard(makeRows(['a', 'b']), { modeStore: store });

    fireEvent.click(screen.getByTestId('dashboard-edit-button'));
    expect(store.get(VIEW_ID)?.preference).toBe('on');

    remount();
    expect(editing()).toBe('true');
    expect(context().editPreference).toBe('on');

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

  it('exposes the mode API to later packages through useDashboardMode', () => {
    const { context, mode } = renderDashboard([]);

    expect(mode()).toEqual({
      isEditing: true,
      canEnterEdit: true,
      mobileContext: false,
      editPreference: 'auto_on',
      setEditing: context().setEditing,
      pinEditing: context().pinEditing,
    });

    act(() => mode().pinEditing());
    expect(mode().editPreference).toBe('on');
    resizeTo(390);
    expect(mode()).toMatchObject({ isEditing: false, canEnterEdit: false, mobileContext: true, editPreference: 'on' });
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
