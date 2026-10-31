import type { Page } from '@playwright/test';
import * as Y from 'yjs';

import type { DatabaseContextState } from '../../src/application/database-yjs';
import { readChartLayoutSetting } from '../../src/application/database-yjs/chart-layout-setting';
import { exposeDatabaseTestContext, type DatabaseTestWindow } from '../../src/components/database/database-test-context';

import { configureView } from './dashboard-usecase-helpers';

jest.mock('@playwright/test', () => ({ expect }));

type FixtureWindow = DatabaseTestWindow & {
  Y?: typeof Y;
  __DASHBOARD_TEST__?: { byDatabase: () => { databaseDoc: Y.Doc } };
};

describe('dashboard chart fixture wire format', () => {
  it.each(Array.from({ length: 17 }, (_, index) => index))('preserves calculation %i through Yjs replication', async (aggregationType) => {
    const doc = new Y.Doc();
    const replica = new Y.Doc();
    const database = new Y.Map<unknown>();
    const views = new Y.Map<Y.Map<unknown>>();

    doc.getMap('data').set('database', database);
    database.set('fields', new Y.Map());
    database.set('views', views);
    views.set('chart-view', new Y.Map());

    const testWindow = window as FixtureWindow;
    const cleanup = exposeDatabaseTestContext(testWindow, Symbol('fixture'), {
      databaseDoc: doc,
      activeViewId: 'chart-view',
    } as DatabaseContextState);

    testWindow.Y = Y;
    testWindow.__DASHBOARD_TEST__ = { byDatabase: () => ({ databaseDoc: doc }) };
    const page = {
      evaluate: (callback: (arg: unknown) => unknown, arg: unknown) => Promise.resolve(callback(arg)),
    } as unknown as Page;

    try {
      await configureView(page, 'database', 'chart-view', {
        layout: 3,
        filters: [],
        sorts: [],
        chart: { chartType: 4, xFieldId: '', yFieldId: 'value', aggregationType },
      });
      Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
      const copiedDatabase = replica.getMap('data').get('database') as Y.Map<unknown>;
      const copiedViews = copiedDatabase.get('views') as Y.Map<Y.Map<unknown>>;
      const settings = copiedViews.get('chart-view')!.get('layout_settings') as Y.Map<Y.Map<unknown>>;
      const chart = settings.get('3')!;

      expect(readChartLayoutSetting(chart)).toMatchObject({
        chartType: 4,
        aggregationType,
        yFieldId: 'value',
        omitEmptyValues: false,
        dateCondition: 3,
      });
      expect(chart.get('aggregation_type_pb')).toBe(BigInt(aggregationType));
      expect(chart.get('date_condition')).toBe(3n);
    } finally {
      cleanup();
      delete testWindow.Y;
      delete testWindow.__DASHBOARD_TEST__;
      doc.destroy();
      replica.destroy();
    }
    expect(testWindow.__TEST_DATABASE_SET_BIGINT__).toBeUndefined();
  });
});
