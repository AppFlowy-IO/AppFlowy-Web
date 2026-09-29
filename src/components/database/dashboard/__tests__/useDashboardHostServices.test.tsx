import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { YDoc } from '@/application/types';

import { useDashboardHostServices } from '../hooks/useDashboardHostServices';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

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

function renderServices(initial: DatabaseContextState) {
  let value = initial;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
  );
  const hook = renderHook(() => useDashboardHostServices(), { wrapper });

  return {
    ...hook,
    update(next: DatabaseContextState) {
      value = next;
      hook.rerender();
    },
  };
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
});
