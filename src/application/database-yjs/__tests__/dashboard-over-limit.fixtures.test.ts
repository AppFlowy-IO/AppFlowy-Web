import * as Y from 'yjs';

import { YDatabase, YDatabaseView, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  readDashboardLayoutSetting,
  readStoredDashboardWidgets,
  serializeDashboardRows,
  updateDashboardLayoutSetting,
} from '../dashboard-layout';
import { DASHBOARD_LAYOUT_KEY, DASHBOARD_MAX_WIDGETS, DashboardLayoutUpdate } from '../dashboard.type';
import { toPlainValue } from '../layout-codec';

import { decodeParityJson, loadParityFixture, normalizeNumbers, seedParityMap } from './dashboard-parity-helpers';

/**
 * Layouts another client saved over the limits (`dashboard-parity/layouts/over-limit.json`,
 * the bytes desktop and Rust read too): the first 12 widgets are read, rows of more
 * than 4 are split, heights are clamped, and no write ever drops a stored widget.
 */
interface OverLimitCase {
  name: string;
  stored: Record<string, unknown>;
  parsed?: { rows: unknown[] };
  write: Record<string, unknown>;
  writtenKeys: string[];
  expected: Record<string, unknown>;
}

const VIEW_ID = 'dashboard';
const { dashboardCases } = loadParityFixture<{ dashboardCases: OverLimitCase[] }>('layouts/over-limit.json');

function createFixture(entries: Record<string, unknown>) {
  const doc = new Y.Doc();
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const layouts = new Y.Map<unknown>();
  const setting = new Y.Map<unknown>();

  doc.transact(() => {
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.views, views);
    views.set(VIEW_ID, view);
    view.set(YjsDatabaseKey.layout_settings, layouts as never);
    layouts.set(DASHBOARD_LAYOUT_KEY, setting);
    seedParityMap(setting, decodeParityJson(entries) as Record<string, unknown>);
  });
  return { doc, database, view, setting };
}

/** The typed update a client submits for the `write` keys, read with the same reader. */
function parseWrite(write: Record<string, unknown>): DashboardLayoutUpdate {
  const parsed = readDashboardLayoutSetting(createFixture(write).database, VIEW_ID);
  const update: DashboardLayoutUpdate = {};

  if (YjsDatabaseKey.dashboard_rows in write) update.rows = parsed.rows;
  if (YjsDatabaseKey.dashboard_global_filters in write) update.globalFilters = parsed.globalFilters;
  if (YjsDatabaseKey.show_widget_titles in write) update.showWidgetTitles = parsed.showWidgetTitles;
  return update;
}

function storedWidgetCount(rows: unknown) {
  return (decodeParityJson(rows) as { widgets: unknown[] }[]).reduce((sum, row) => sum + row.widgets.length, 0);
}

describe('layouts saved over the limit (dashboard-parity/layouts/over-limit.json)', () => {
  it.each(dashboardCases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const fixture = createFixture(entry.stored);
    const read = readDashboardLayoutSetting(fixture.database, VIEW_ID);

    expect(read.rows.flatMap((row) => row.widgets).length).toBeLessThanOrEqual(DASHBOARD_MAX_WIDGETS);
    if (entry.parsed) {
      expect(normalizeNumbers(serializeDashboardRows(read.rows))).toEqual(
        normalizeNumbers(decodeParityJson(entry.parsed.rows))
      );
    }

    const changed = new Set<string>();
    const observer = (event: Y.YMapEvent<unknown>) => event.keysChanged.forEach((key) => changed.add(key));

    fixture.setting.observe(observer);
    fixture.doc.transact(() => updateDashboardLayoutSetting(fixture.view, parseWrite(entry.write)));
    fixture.setting.unobserve(observer);

    expect([...changed].sort()).toEqual([...entry.writtenKeys].sort());
    expect(normalizeNumbers(toPlainValue(fixture.setting))).toEqual(normalizeNumbers(decodeParityJson(entry.expected)));
  });

  it('never stores fewer widgets than another client saved, whatever this client writes', () => {
    dashboardCases.forEach((entry) => {
      const fixture = createFixture(entry.stored);
      const before = readStoredDashboardWidgets(fixture.database, VIEW_ID).map((widget) => widget.id);
      const written = parseWrite(entry.write).rows?.flatMap((row) => row.widgets.map((widget) => widget.id)) ?? [];

      fixture.doc.transact(() => updateDashboardLayoutSetting(fixture.view, parseWrite(entry.write)));
      const after = readStoredDashboardWidgets(fixture.database, VIEW_ID).map((widget) => widget.id);
      // Only a widget the write removed from what it showed may go.
      const removed = before.filter((id) => !after.includes(id));
      const shownBefore = readDashboardLayoutSetting(createFixture(entry.stored).database, VIEW_ID)
        .rows.flatMap((row) => row.widgets.map((widget) => widget.id));

      expect(removed.every((id) => shownBefore.includes(id) && !written.includes(id))).toBe(true);
      expect(after.length).toBe(storedWidgetCount(entry.expected.rows));
    });
  });
});
