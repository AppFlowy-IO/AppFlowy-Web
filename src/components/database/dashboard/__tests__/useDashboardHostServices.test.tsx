import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { YDoc } from '@/application/types';
import { AppOperationsContext, AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';

import { useDashboardHostServices } from '../hooks/useDashboardHostServices';

function createState(overrides: Partial<DatabaseContextState> = {}): DatabaseContextState {
  return {
    readOnly: false,
    databaseDoc: new Y.Doc() as unknown as YDoc,
    databasePageId: 'page',
    activeViewId: 'view',
    rowMap: {},
    workspaceId: 'workspace',
    ...overrides,
  };
}

function renderServices(initial: DatabaseContextState, initialApp: AppOperationsContextType | null = null) {
  let value = initial;
  let app = initialApp;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppOperationsContext.Provider value={app}>
      <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
    </AppOperationsContext.Provider>
  );
  const hook = renderHook(() => useDashboardHostServices(), { wrapper });

  return {
    ...hook,
    update(next: DatabaseContextState, nextApp: AppOperationsContextType | null = app) {
      value = next;
      app = nextApp;
      hook.rerender();
    },
  };
}

/** The app's operations: only what the dashboard reads from them. */
function appOperations(operations: Pick<AppOperationsContextType, 'createRow' | 'getSubscriptions'>) {
  return operations as AppOperationsContextType;
}

describe('useDashboardHostServices', () => {
  it('keeps its identity when the host recreates a service, and calls the latest one', async () => {
    const first = jest.fn().mockResolvedValue(undefined);
    const second = jest.fn().mockResolvedValue(undefined);
    const state = createState({ navigateToView: first, rowMap: {} });
    const { result, update } = renderServices(state);
    const services = result.current;

    // Row-map churn and a recreated service leave the object alone.
    update({ ...state, rowMap: { r1: state.databaseDoc }, navigateToView: second });
    expect(result.current).toBe(services);

    await services.navigateToView?.('view-1');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('view-1');
  });

  it('changes when a service appears or a plain value changes', () => {
    const state = createState();
    const { result, update } = renderServices(state);
    const services = result.current;

    expect(services.loadViewMeta).toBeUndefined();

    update({ ...state, loadViewMeta: jest.fn() });
    expect(result.current).not.toBe(services);
    expect(typeof result.current.loadViewMeta).toBe('function');

    const withService = result.current;

    update({ ...state, loadViewMeta: jest.fn(), readOnly: true });
    expect(result.current).not.toBe(withService);
    expect(result.current.readOnly).toBe(true);
  });

  it("hands widgets the app's own row creation and plan lookup, not the host database's", async () => {
    const hostCreateRow = jest.fn();
    const appCreateRow = jest.fn().mockResolvedValue(undefined);
    const getSubscriptions = jest.fn().mockResolvedValue([]);
    const state = createState({ createRow: hostCreateRow });
    const { result } = renderServices(state, appOperations({ createRow: appCreateRow, getSubscriptions }));

    // The host context wraps `createRow` for its own rows; a widget's database needs the app's.
    await result.current.createRow?.('row-key', { forceSync: true });
    expect(appCreateRow).toHaveBeenCalledWith('row-key', { forceSync: true });
    expect(hostCreateRow).not.toHaveBeenCalled();

    await result.current.getSubscriptions?.();
    expect(getSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('keeps its identity when the app rebuilds its operations, and calls the latest ones', async () => {
    const first = jest.fn().mockResolvedValue([]);
    const second = jest.fn().mockResolvedValue([]);
    const state = createState();
    const { result, update } = renderServices(state, appOperations({ getSubscriptions: first }));
    const services = result.current;

    // The app rebuilds its operations with the trash list: widgets must not render for it.
    update(state, appOperations({ getSubscriptions: second }));
    expect(result.current).toBe(services);

    await services.getSubscriptions?.();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("falls back to the host's own services without the app (a published page)", async () => {
    const hostCreateRow = jest.fn().mockResolvedValue(undefined);
    const { result } = renderServices(createState({ createRow: hostCreateRow }));

    await result.current.createRow?.('row-key');
    expect(hostCreateRow).toHaveBeenCalledWith('row-key');
    expect(result.current.getSubscriptions).toBeUndefined();
  });
});
