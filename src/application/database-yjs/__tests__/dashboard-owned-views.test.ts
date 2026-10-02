import { expect } from '@jest/globals';
import * as Y from 'yjs';

import {
  collectDatabaseViewNames,
  DASHBOARD_OWNER_KEY,
  duplicateBaseName,
  filterOwnedTabViewIds,
  isOwnedByDashboard,
  nextViewName,
  readDashboardOwner,
} from '@/application/database-yjs/dashboard-owned-views';
import { YDatabase, YjsDatabaseKey } from '@/application/types';

import { loadParityFixture } from './dashboard-parity-helpers';

interface ViewNamesFixture {
  nextViewName: { name: string; base: string; existing: string[]; expected: string }[];
  duplicateBaseName: { name: string; input: string; expected: string }[];
}

interface OwnerMarkers {
  folder?: unknown;
  collab?: unknown;
}

interface TabVisibilityFixture {
  ownerCases: (OwnerMarkers & { name: string; expected: string | null })[];
  cases: {
    name: string;
    ids: string[];
    openedViewId: string;
    owners: Record<string, OwnerMarkers>;
    expected: string[];
  }[];
}

/** The two copies of the marker as each client stores them: a folder view's extra, a collab view map. */
function markerSources({ folder, collab }: OwnerMarkers = {}) {
  const doc = new Y.Doc();
  const collabView = doc.getMap<unknown>('view');

  if (collab !== undefined) collabView.set(DASHBOARD_OWNER_KEY, collab);
  return { folderView: { extra: folder === undefined ? {} : { dashboard_owner: folder } }, collabView };
}

describe('dashboard-owned views (dashboard-parity fixtures)', () => {
  const names = loadParityFixture<ViewNamesFixture>('view-names.json');
  const visibility = loadParityFixture<TabVisibilityFixture>('tab-visibility.json');

  it('covers every vector of view-names.json and tab-visibility.json', () => {
    expect(names.nextViewName.length).toBeGreaterThanOrEqual(7);
    expect(names.duplicateBaseName.length).toBeGreaterThanOrEqual(6);
    expect(visibility.ownerCases.length).toBeGreaterThan(0);
    expect(visibility.cases.length).toBeGreaterThanOrEqual(5);
  });

  it.each(names.nextViewName.map((entry) => [entry.name, entry] as const))('nextViewName: %s', (_, entry) => {
    expect(nextViewName(entry.base, entry.existing)).toBe(entry.expected);
  });

  it.each(names.duplicateBaseName.map((entry) => [entry.name, entry] as const))(
    'duplicateBaseName: %s',
    (_, entry) => {
      expect(duplicateBaseName(entry.input)).toBe(entry.expected);
    }
  );

  it('names a duplicate of "Board (1)" with the first free "Board (n)"', () => {
    expect(nextViewName(duplicateBaseName('Board (1)'), ['Board', 'Board (1)'])).toBe('Board (2)');
  });

  it.each(visibility.ownerCases.map((entry) => [entry.name, entry] as const))('readDashboardOwner: %s', (_, entry) => {
    const { folderView, collabView } = markerSources(entry);

    expect(readDashboardOwner(folderView, collabView)).toBe(entry.expected);
  });

  it.each(visibility.cases.map((entry) => [entry.name, entry] as const))('filterOwnedTabViewIds: %s', (_, entry) => {
    const isOwned = (viewId: string) => {
      const { folderView, collabView } = markerSources(entry.owners[viewId]);

      return readDashboardOwner(folderView, collabView) !== null;
    };

    expect(filterOwnedTabViewIds(entry.ids, entry.openedViewId, isOwned)).toEqual(entry.expected);
  });
});

describe('dashboard-owned views', () => {
  it('reads either copy, with the folder marker winning', () => {
    expect(readDashboardOwner(null, null)).toBeNull();
    expect(readDashboardOwner({ extra: null })).toBeNull();
    expect(readDashboardOwner({ extra: { dashboard_owner: 'v:a' } }, { get: () => 'v:b' })).toBe('v:a');
    expect(readDashboardOwner(undefined, { get: (key) => (key === 'dashboard_owner' ? 'v:b' : undefined) })).toBe(
      'v:b'
    );
  });

  it('tells which dashboard owns a view', () => {
    const owned = { extra: { dashboard_owner: 'v:dash' } };

    expect(isOwnedByDashboard('v:dash', owned)).toBe(true);
    expect(isOwnedByDashboard('v:other', owned)).toBe(false);
    expect(isOwnedByDashboard('v:dash', null, null)).toBe(false);
  });

  it('keeps the same tab list when nothing is owned', () => {
    const ids = ['v:grid', 'v:board'];

    expect(filterOwnedTabViewIds(ids, 'v:grid', () => false)).toBe(ids);
  });

  it('collects the folder names of a database, falling back to the collab name', () => {
    const doc = new Y.Doc();
    const database = doc.getMap('database') as unknown as YDatabase;
    const views = new Y.Map<Y.Map<unknown>>();

    ['v:grid', 'v:board', 'v:nameless'].forEach((viewId, index) => {
      const view = new Y.Map<unknown>();

      if (index < 2) view.set(YjsDatabaseKey.name, index === 0 ? 'Grid' : 'Collab board');
      views.set(viewId, view);
    });
    (database as unknown as Y.Map<unknown>).set(YjsDatabaseKey.views, views);

    expect(collectDatabaseViewNames(database, { 'v:board': 'Board' }).sort()).toEqual(['Board', 'Grid']);
    expect(collectDatabaseViewNames(database, new Map([['v:nameless', 'Calendar']])).sort()).toEqual([
      'Calendar',
      'Collab board',
      'Grid',
    ]);
    expect(collectDatabaseViewNames(undefined)).toEqual([]);
  });
});
