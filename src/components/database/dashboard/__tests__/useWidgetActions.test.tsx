import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { toast } from 'sonner';

import { DashboardRow } from '@/application/database-yjs/dashboard.type';

import { DashboardHostContext, DashboardHostServices, DashboardUiContext, DashboardUiContextValue } from '../DashboardUiContext';
import { useWidgetActions } from '../hooks/useWidgetActions';

jest.mock('react-i18next', () => {
  // Stable, like the real `t` of one language.
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() } }));

const toastError = toast.error as jest.Mock;

const ROWS: DashboardRow[] = [
  { id: 'r1', height: 360, widgets: [{ id: 'w1', viewId: 'v1', databaseId: 'db', width: 12 }] },
];

function renderActions(host: Partial<DashboardHostServices>) {
  let rows = ROWS;
  const ui: DashboardUiContextValue = {
    hostDatabaseId: 'host-db',
    openPicker: jest.fn(),
    showLimitMessage: jest.fn(),
    dndInstanceId: Symbol('actions-test'),
    getRows: () => rows,
    updateRows: (updater) => {
      rows = updater(rows);
    },
    acquireSourceDoc: () => () => undefined,
    selectWidget: jest.fn(),
  };
  const openSettings = jest.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DashboardHostContext.Provider value={host as DashboardHostServices}>
      <DashboardUiContext.Provider value={ui}>{children}</DashboardUiContext.Provider>
    </DashboardHostContext.Provider>
  );
  const hook = renderHook(
    () => useWidgetActions({ widgetId: 'w1', viewId: 'v1', databaseId: 'db', openSettings }),
    { wrapper }
  );

  return { ...hook, ui, openSettings, rows: () => rows };
}

/** "Open view" from the widget menu, with its navigation settled. */
async function open(actions: { open: () => void }) {
  await act(async () => {
    actions.open();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  toastError.mockClear();
});

describe('useWidgetActions: Open view', () => {
  it('opens the widget view and says nothing', async () => {
    const navigateToView = jest.fn().mockResolvedValue(undefined);
    const getViewIdFromDatabaseId = jest.fn();
    const { result } = renderActions({ navigateToView, getViewIdFromDatabaseId });

    await open(result.current);
    expect(navigateToView.mock.calls).toEqual([['v1']]);
    expect(getViewIdFromDatabaseId).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('opens the page of the database when the view cannot be opened', async () => {
    const navigateToView = jest.fn().mockRejectedValueOnce(new Error('View not found')).mockResolvedValue(undefined);
    const getViewIdFromDatabaseId = jest.fn().mockResolvedValue('db-page');
    const { result } = renderActions({ navigateToView, getViewIdFromDatabaseId });

    await open(result.current);
    expect(getViewIdFromDatabaseId).toHaveBeenCalledWith('db');
    expect(navigateToView.mock.calls).toEqual([['v1'], ['db-page']]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each([
    ['the database page cannot be opened either', () => Promise.resolve('db-page')],
    ['the database has no page', () => Promise.resolve(null)],
    ['the database page cannot be found', () => Promise.reject(new Error('offline'))],
  ])('tells the user when %s', async (_name, lookup) => {
    const navigateToView = jest.fn().mockRejectedValue(new Error('View not found'));
    const { result } = renderActions({ navigateToView, getViewIdFromDatabaseId: jest.fn(lookup) });

    await open(result.current);
    expect(toastError.mock.calls).toEqual([['Could not open the view']]);
  });

  it('does nothing where the host cannot navigate (a published page)', async () => {
    const { result } = renderActions({});

    await open(result.current);
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('useWidgetActions: layout', () => {
  it('keeps its identity, and hands the settings request to the widget', () => {
    const { result, rerender, openSettings } = renderActions({});
    const actions = result.current;

    rerender();
    expect(result.current).toBe(actions);
    actions.openSettings();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('duplicates, moves and removes the widget in the latest rows', () => {
    const { result, rows, ui } = renderActions({});

    result.current.duplicate();
    expect(rows()[0].widgets.map((widget) => widget.viewId)).toEqual(['v1', 'v1']);
    result.current.move('right');
    expect(rows()[0].widgets[1].id).toBe('w1');
    result.current.remove();
    expect(rows()[0].widgets.map((widget) => widget.id)).not.toContain('w1');

    result.current.changeView();
    expect(ui.openPicker).toHaveBeenCalledWith({ mode: 'replace', widgetId: 'w1' });
  });
});
