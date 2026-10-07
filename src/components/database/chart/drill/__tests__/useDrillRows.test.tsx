import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import {
  DatabaseExtraFiltersContext,
  DatabaseSearchQueryContext,
  DatabaseViewOverlayContext,
} from '@/application/database-yjs/context';
import type { DashboardExtraFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { drillFiltersForGroupKey } from '@/application/database-yjs/drill-query';
import { createViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import { RowId } from '@/application/types';

import { useDrillRows } from '../useDrillRows';

import { contextOf, createDrillFixture, DatabaseWrapper, DrillFixture, setCell } from './drillTestFixture';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function categoryNodes(key: string): DashboardExtraFilter[] {
  const part = drillFiltersForGroupKey(
    { id: 'severity', name: 'Severity', type: FieldType.SingleSelect },
    key,
    new Date(),
    'x'
  );

  return part.kind === 'filters' ? part.nodes : [];
}

function renderDrillRows(
  fixture: DrillFixture,
  {
    extras,
    query = '',
    rowAllowList = null,
    context = {},
  }: {
    extras: DashboardExtraFilter[];
    query?: string;
    rowAllowList?: RowId[] | null;
    context?: Parameters<typeof contextOf>[1];
  }
) {
  const overlay = createViewConditionsOverlay(fixture.view);
  const props = { query, extras };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseWrapper value={contextOf(fixture, context)}>
      <DatabaseViewOverlayContext.Provider value={overlay.view}>
        <DatabaseExtraFiltersContext.Provider value={props.extras}>
          <DatabaseSearchQueryContext.Provider value={props.query}>{children}</DatabaseSearchQueryContext.Provider>
        </DatabaseExtraFiltersContext.Provider>
      </DatabaseViewOverlayContext.Provider>
    </DatabaseWrapper>
  );
  const hook = renderHook(({ allow }: { allow: RowId[] | null }) => useDrillRows({ rowAllowList: allow }), {
    wrapper,
    initialProps: { allow: rowAllowList },
  });

  return {
    ...hook,
    overlay,
    setQuery(next: string) {
      props.query = next;
      hook.rerender({ allow: rowAllowList });
    },
  };
}

const ids = (rows: { id: string }[] | undefined) => rows?.map((row) => row.id);

describe('useDrillRows', () => {
  it('lists only the rows of the select category', async () => {
    const fixture = createDrillFixture();
    const { result } = renderDrillRows(fixture, { extras: categoryNodes('o_blocker') });

    await waitFor(() => expect(ids(result.current.rows)).toEqual(['r1', 'r2']));
    expect(result.current.loading).toBe(false);
  });

  it('is live: editing a cell adds and removes rows (no snapshot)', async () => {
    const fixture = createDrillFixture();
    const { result } = renderDrillRows(fixture, { extras: categoryNodes('o_blocker') });

    await waitFor(() => expect(ids(result.current.rows)).toEqual(['r1', 'r2']));
    act(() => setCell(fixture, 'r3', 'severity', 'o_blocker'));
    await waitFor(() => expect(ids(result.current.rows)).toEqual(['r1', 'r2', 'r3']));
    act(() => setCell(fixture, 'r1', 'severity', 'o_major'));
    await waitFor(() => expect(ids(result.current.rows)).toEqual(['r2', 'r3']));
  });

  it('narrows with the search', async () => {
    const fixture = createDrillFixture();
    const hook = renderDrillRows(fixture, { extras: [] });

    await waitFor(() => expect(ids(hook.result.current.rows)).toEqual(['r1', 'r2', 'r3', 'r4']));
    hook.setQuery('token');
    await waitFor(() => expect(ids(hook.result.current.rows)).toEqual(['r3']));
  });

  it('intersects the live rows with the allow-list of the row-set fallback', async () => {
    const fixture = createDrillFixture();
    const { result } = renderDrillRows(fixture, { extras: [], rowAllowList: ['r2', 'r4', 'gone'] });

    await waitFor(() => expect(ids(result.current.rows)).toEqual(['r2', 'r4']));
    // A row of the allow-list can leave (a drill filter hides it); none can join.
    act(() => setCell(fixture, 'r3', 'severity', 'o_blocker'));
    await waitFor(() => expect(ids(result.current.rows)).toEqual(['r2', 'r4']));
  });

  it('is loading while the row orders are not known (the conditions hydrate)', async () => {
    const fixture = createDrillFixture();
    const seen: Array<{ loading: boolean; rows?: unknown[] }> = [];
    const overlay = createViewConditionsOverlay(fixture.view);
    const extras = categoryNodes('o_blocker');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseWrapper value={contextOf(fixture)}>
        <DatabaseViewOverlayContext.Provider value={overlay.view}>
          <DatabaseExtraFiltersContext.Provider value={extras}>{children}</DatabaseExtraFiltersContext.Provider>
        </DatabaseViewOverlayContext.Provider>
      </DatabaseWrapper>
    );
    const { result } = renderHook(
      () => {
        const value = useDrillRows({ rowAllowList: null });

        seen.push(value);
        return value;
      },
      { wrapper }
    );

    expect(seen[0]).toEqual({ rows: undefined, loading: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
