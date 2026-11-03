import { expect } from '@jest/globals';
import * as Y from 'yjs';

import {
  hasDashboardWidgets,
  seedConvertedDashboardLayout,
  seedConvertedDashboardRows,
} from '@/application/database-yjs/dashboard-convert';
import { serializeDashboardRows } from '@/application/database-yjs/dashboard-layout';
import { DASHBOARD_LAYOUT_KEY } from '@/application/database-yjs/dashboard.type';
import { toPlainValue } from '@/application/database-yjs/layout-codec';
import { YDatabase, YjsDatabaseKey } from '@/application/types';

import { decodeParityJson, loadParityFixture, normalizeNumbers, seedParityMap } from './dashboard-parity-helpers';

interface ConvertedSeedFixture {
  idPatterns: Record<'<row-id>' | '<widget-id>', string>;
  seed: { view_id: string; database_id: string; rows: unknown };
  cases: { name: string; stored: Record<string, unknown> | null; seeded: boolean; expected: unknown }[];
}

const fixture = loadParityFixture<ConvertedSeedFixture>('layouts/converted-seed.json');
const rowIdPattern = new RegExp(fixture.idPatterns['<row-id>']);
const widgetIdPattern = new RegExp(fixture.idPatterns['<widget-id>']);
const VIEW_ID = 'v:converted';

/** Replace the random ids of a seeded row list with the fixture masks, after checking their shape. */
function maskSeedIds(rows: unknown): unknown {
  return (rows as { id: string; widgets: { id: string }[] }[]).map((row) => {
    if (!rowIdPattern.test(row.id)) return row;
    return {
      ...row,
      id: '<row-id>',
      widgets: row.widgets.map((widget) =>
        widgetIdPattern.test(widget.id) ? { ...widget, id: '<widget-id>' } : widget
      ),
    };
  });
}

function createDatabase(stored: Record<string, unknown> | null) {
  const doc = new Y.Doc();
  const database = doc.getMap('database');
  const views = new Y.Map<Y.Map<unknown>>();
  const view = new Y.Map<unknown>();
  const layoutSettings = new Y.Map<unknown>();

  database.set(YjsDatabaseKey.id, 'db:host');
  database.set(YjsDatabaseKey.views, views);
  views.set(VIEW_ID, view);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  if (stored) {
    const setting = new Y.Map<unknown>();

    layoutSettings.set(DASHBOARD_LAYOUT_KEY, setting);
    seedParityMap(setting, decodeParityJson(stored) as Record<string, unknown>);
  }

  return { doc, database: database as unknown as YDatabase, layoutSettings };
}

describe('seedConvertedDashboardRows (dashboard-parity/layouts/converted-seed.json)', () => {
  it('is one full-width widget showing the copy in a default-height row', () => {
    const rows = seedConvertedDashboardRows(fixture.seed.view_id, fixture.seed.database_id);
    const serialized = serializeDashboardRows(rows);

    expect(serialized).toHaveLength(1);
    expect(serialized[0].id).toMatch(rowIdPattern);
    expect(serialized[0].widgets[0].id).toMatch(widgetIdPattern);
    expect(maskSeedIds(serialized)).toEqual(fixture.seed.rows);
  });

  it('draws fresh ids every time', () => {
    const [first] = seedConvertedDashboardRows('v:a', 'db:a');
    const [second] = seedConvertedDashboardRows('v:a', 'db:a');

    expect(first.id).not.toBe(second.id);
    expect(first.widgets[0].id).not.toBe(second.widgets[0].id);
  });
});

describe('seedConvertedDashboardLayout (dashboard-parity/layouts/converted-seed.json)', () => {
  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const { doc, database, layoutSettings } = createDatabase(entry.stored);
    let seeded = false;

    doc.transact(() => {
      seeded = seedConvertedDashboardLayout(database, VIEW_ID, fixture.seed.view_id, fixture.seed.database_id);
    });

    expect(seeded).toBe(entry.seeded);
    const stored = toPlainValue(layoutSettings.get(DASHBOARD_LAYOUT_KEY)) as Record<string, unknown>;

    expect(normalizeNumbers({ ...stored, rows: maskSeedIds(stored.rows) })).toEqual(
      normalizeNumbers(decodeParityJson(entry.expected))
    );
    expect(hasDashboardWidgets(database, VIEW_ID)).toBe(true);
  });

  it('never reseeds a converted view and keeps its widgets', () => {
    const { database, layoutSettings } = createDatabase(null);

    expect(seedConvertedDashboardLayout(database, VIEW_ID, 'v:first', 'db:host')).toBe(true);
    const first = toPlainValue(layoutSettings.get(DASHBOARD_LAYOUT_KEY));

    expect(seedConvertedDashboardLayout(database, VIEW_ID, 'v:second', 'db:host')).toBe(false);
    expect(toPlainValue(layoutSettings.get(DASHBOARD_LAYOUT_KEY))).toEqual(first);
  });

  it('writes nothing for a view that is not in the database', () => {
    const { database } = createDatabase(null);

    expect(seedConvertedDashboardLayout(database, 'v:missing', 'v:copy', 'db:host')).toBe(false);
    expect(seedConvertedDashboardLayout(undefined, VIEW_ID, 'v:copy', 'db:host')).toBe(false);
  });
});
