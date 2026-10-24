import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseExtraFiltersContext, DatabaseViewOverlayContext } from '@/application/database-yjs/context';
import type { DashboardExtraFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { ChartDrillTarget, DrillGroupField } from '@/application/database-yjs/drill-query';
import * as overlayModule from '@/application/database-yjs/view-conditions-overlay';
import { createViewConditionsOverlay, ViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import { YDatabaseView, YjsDatabaseKey } from '@/application/types';

import { useDrillSession } from '../useDrillSession';

import { contextOf, createDrillFixture, DatabaseWrapper, selectFilterPlain, toYFilter } from './drillTestFixture';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) =>
      (options?.defaultValue ?? key).replace('{{count}}', String(options?.count ?? '')),
  }),
}));

const TARGET: ChartDrillTarget = { xKey: 'o_blocker', xLabel: 'Blocker', xIsEmpty: false, rowIds: ['r1', 'r2'] };
const SEVERITY: DrillGroupField = { id: 'severity', name: 'Severity', type: FieldType.SingleSelect };
const GLOBAL: DashboardExtraFilter = {
  id: 'gf1',
  filter_type: 2,
  field_id: 'component',
  ty: FieldType.SingleSelect,
  condition: 0,
  content: 'o_mobile',
};

const filtersOf = (view: YDatabaseView | undefined) =>
  ((view as unknown as Y.Map<unknown> | undefined)?.get(YjsDatabaseKey.filters) as Y.Array<Y.Map<unknown>>).toJSON();

function setup({
  widgetOverlay,
  extras,
}: { widgetOverlay?: ViewConditionsOverlay; extras?: DashboardExtraFilter[] } = {}) {
  const fixture = createDrillFixture();
  const overlay = widgetOverlay ?? null;

  return { fixture, overlay, extras };
}

function wrapperFor(
  fixture: ReturnType<typeof createDrillFixture>,
  overlayView: YDatabaseView | undefined,
  extras: DashboardExtraFilter[] | undefined
) {
  return ({ children }: { children: ReactNode }) => (
    <DatabaseWrapper value={contextOf(fixture)}>
      <DatabaseViewOverlayContext.Provider value={overlayView}>
        <DatabaseExtraFiltersContext.Provider value={extras}>{children}</DatabaseExtraFiltersContext.Provider>
      </DatabaseViewOverlayContext.Provider>
    </DatabaseWrapper>
  );
}

describe('useDrillSession', () => {
  it('seeds the drill from the widget overlay private filter, and nothing the drill edits reaches the widget or the view', () => {
    const { fixture } = setup();
    const widgetOverlay = createViewConditionsOverlay(fixture.view);

    act(() => {
      (widgetOverlay.view.get(YjsDatabaseKey.filters) as unknown as Y.Array<unknown>).push([
        toYFilter(selectFilterPlain('private', 'status', 'o_done')),
      ]);
    });
    expect(widgetOverlay.isDirty()).toBe(true);

    const { result } = renderHook(
      () => useDrillSession({ target: TARGET, xField: SEVERITY, subGroupField: null, ready: true }),
      { wrapper: wrapperFor(fixture, widgetOverlay.view, undefined) }
    );

    expect(result.current.ready).toBe(true);
    expect(filtersOf(result.current.overlayView).map((filter) => filter.id)).toEqual(['private']);
    expect(result.current.seedFilters.map((filter) => filter.id)).toEqual(['private']);

    act(() => {
      (result.current.overlayView?.get(YjsDatabaseKey.filters) as unknown as Y.Array<unknown>).push([
        toYFilter(selectFilterPlain('drill-local', 'component', 'o_web')),
      ]);
    });
    expect(filtersOf(result.current.overlayView).map((filter) => filter.id)).toEqual(['private', 'drill-local']);
    expect(filtersOf(widgetOverlay.view).map((filter) => filter.id)).toEqual(['private']);
    expect(filtersOf(fixture.view)).toEqual([]);
    widgetOverlay.destroy();
  });

  it('adds the category filters after the widget global filters', () => {
    const { fixture } = setup();
    const { result } = renderHook(
      () => useDrillSession({ target: TARGET, xField: SEVERITY, subGroupField: null, ready: true }),
      { wrapper: wrapperFor(fixture, undefined, [GLOBAL]) }
    );

    expect(result.current.extraFilters.map((filter) => filter.id)).toEqual(['gf1', 'drill:x:0']);
    expect(result.current.extraFilters[1]).toMatchObject({ field_id: 'severity', condition: 0, content: 'o_blocker' });
    expect(result.current.category.chips).toEqual([
      { kind: 'category', text: 'Severity: Blocker', fieldId: 'severity' },
    ]);
  });

  it('destroys its overlay on unmount', () => {
    const { fixture } = setup();
    const created: ViewConditionsOverlay[] = [];
    const realCreate = overlayModule.createViewConditionsOverlay;
    const spy = jest.spyOn(overlayModule, 'createViewConditionsOverlay').mockImplementation((view, options) => {
      const overlay = realCreate(view, options);

      jest.spyOn(overlay, 'destroy');
      created.push(overlay);
      return overlay;
    });

    try {
      const { unmount } = renderHook(
        () => useDrillSession({ target: TARGET, xField: SEVERITY, subGroupField: null, ready: true }),
        { wrapper: wrapperFor(fixture, undefined, undefined) }
      );

      expect(created).toHaveLength(1);
      unmount();
      expect(created[0].destroy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('in Edit mode (no widget overlay) follows a collaborator saving a view filter', () => {
    const { fixture } = setup();
    const { result } = renderHook(
      () => useDrillSession({ target: TARGET, xField: SEVERITY, subGroupField: null, ready: true }),
      { wrapper: wrapperFor(fixture, undefined, undefined) }
    );

    expect(filtersOf(result.current.overlayView)).toEqual([]);
    act(() => {
      (fixture.view.get(YjsDatabaseKey.filters) as unknown as Y.Array<unknown>).push([
        toYFilter(selectFilterPlain('saved', 'status', 'o_new')),
      ]);
    });
    expect(filtersOf(result.current.overlayView).map((filter) => filter.id)).toEqual(['saved']);
  });

  it('is not ready until the chart fields are', () => {
    const { fixture } = setup();
    const { result } = renderHook(
      () => useDrillSession({ target: TARGET, xField: null, subGroupField: null, ready: false }),
      { wrapper: wrapperFor(fixture, undefined, undefined) }
    );

    expect(result.current.ready).toBe(false);
  });
});
