/**
 * The seed pass of the background row loader on a settled source
 * (PERFORMANCE-REPORT W4 c, theme 6 of 3.4): when a view that already shows
 * its rows gains conditions (a dashboard's global filter), the rows read
 * again are published once, when the pass ends, so the view recomputes and
 * changes once. A view that mounts with conditions keeps publishing as rows
 * arrive.
 */
import { act, renderHook } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import {
  type BackgroundRowDocChange,
  useBackgroundRowDocLoader,
} from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import { YDatabaseRowOrders, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));
jest.mock('@/application/db', () => ({
  openRowCollabDBWithProvider: jest.fn(async () => {
    throw new Error('record not found');
  }),
}));

const ROWS = 300;
let fixtureCount = 0;

/** A settled source: its walk is over, every row has a seed doc, none is in the row map. */
function createSettledSource() {
  fixtureCount += 1;
  const databaseId = `publish-once-${fixtureCount}`;
  const viewId = 'view-id';
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const rowIds = Array.from({ length: ROWS }, (_, index) => `row-${index}`);
  const seedDocs = Object.fromEntries(rowIds.map((id) => [id, createRowDoc(id, databaseId, {})]));

  rowOrders.push(rowIds.map((id) => ({ id, height: 36 })));
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const contextValue = {
    activeViewId: viewId,
    databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace-id',
    seedsReady: true,
    blobPrefetchComplete: true,
    loadRowFromSeed: jest.fn(async (id: string) => seedDocs[id]),
    ensureRow: jest.fn(),
    peekRowDocFromSeed: (id: string) => seedDocs[id] ?? null,
  } as DatabaseContextState;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );

  return {
    wrapper,
    destroy: () => {
      Object.values(seedDocs).forEach((doc) => doc.destroy());
      databaseDoc.destroy();
    },
  };
}

/** The loader as a row selector uses it, recording each publish of its cache. */
function renderLoader(source: ReturnType<typeof createSettledSource>, active: boolean) {
  const publishes: BackgroundRowDocChange[] = [];

  return {
    publishes,
    ...renderHook(
      ({ conditions }: { conditions: boolean }) => {
        const { cachedRowDocs, subscribeToCachedRowDocChanges } = useBackgroundRowDocLoader(conditions, 'publish-once');

        useEffect(
          () => subscribeToCachedRowDocChanges((change) => publishes.push(change)),
          [subscribeToCachedRowDocChanges]
        );
        return cachedRowDocs;
      },
      { wrapper: source.wrapper, initialProps: { conditions: active } }
    ),
  };
}

/** Runs the animation frames of the seed pass until it is done. */
async function finishPass() {
  for (let frame = 0; frame < 20; frame += 1) {
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
  }
}

describe('useBackgroundRowDocLoader on a settled source', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('publishes a re-read started by a conditions change once, when the pass ends', async () => {
    const source = createSettledSource();
    // The view shows its rows with no condition: the loader reads nothing.
    const { publishes, result, rerender, unmount } = renderLoader(source, false);

    await finishPass();
    expect(publishes).toHaveLength(0);

    // A global filter gives the view conditions: every row is read again.
    rerender({ conditions: true });
    await finishPass();

    expect(Object.keys(result.current)).toHaveLength(ROWS);
    expect(publishes.map(({ added }) => Object.keys(added).length)).toEqual([ROWS]);
    unmount();
    source.destroy();
  });

  it('keeps publishing as rows arrive for a view that mounts with conditions', async () => {
    const source = createSettledSource();
    const { publishes, result, unmount } = renderLoader(source, true);

    await finishPass();

    expect(Object.keys(result.current)).toHaveLength(ROWS);
    // 128 rows per frame, each frame published.
    expect(publishes.map(({ added }) => Object.keys(added).length)).toEqual([128, 128, 44]);
    unmount();
    source.destroy();
  });
});
