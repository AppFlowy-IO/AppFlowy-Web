import * as Y from 'yjs';

import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  addDashboardWidget,
  canAddDashboardWidget,
  createDashboardWidget,
  getDashboardAddToNewRowState,
  readDashboardLayoutSetting,
  readStoredDashboardWidgets,
  removeDashboardWidget,
  updateDashboardLayoutSetting,
} from '../dashboard-layout';
import { DASHBOARD_LAYOUT_KEY, DASHBOARD_MAX_WIDGETS, DashboardRow } from '../dashboard.type';
import { getOrCreateDatabaseHistoryManager, runDatabaseAction } from '../history';

/**
 * The 12-widget limit across editors and history (missing-tests M13): two
 * editors adding at the same time, and undo or redo after a collaborator's
 * write. The rows are one whole-value key (last writer wins), so a merge never
 * concatenates two lists, and Yjs refuses to restore a value a collaborator
 * overwrote. Whatever happens, every client reads at most 12 widgets and no
 * widget twice.
 */

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const VIEW_ID = 'dashboard';
const DATABASE_ID = 'host';
const ROWS_ACTION = { type: 'database.updateDashboardSetting' };

function rowsOf(...counts: number[]): DashboardRow[] {
  let next = 0;

  return counts.map((count, rowIndex) => ({
    id: `r:${rowIndex + 1}`,
    height: 360,
    widgets: Array.from({ length: count }, () => {
      next += 1;
      return { id: `w:${next}`, viewId: `view-${next}`, databaseId: DATABASE_ID, width: 12 / count };
    }),
  }));
}

/** A host database doc whose dashboard view holds `rows`, and a second editor's replica of it. */
function createEditors(rows: DashboardRow[]) {
  const user = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  user.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.views, views as never);
  views.set(VIEW_ID, view);
  user.transact(() => updateDashboardLayoutSetting(view, { rows }), 'seed');

  const collaborator = new Y.Doc() as unknown as YDoc;

  Y.applyUpdate(collaborator, Y.encodeStateAsUpdate(user), 'remote');
  return { user, collaborator };
}

function viewOf(doc: YDoc) {
  const view = (doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
    .get(YjsDatabaseKey.views)
    .get(VIEW_ID);

  if (!view) throw new Error('The dashboard view is missing');
  return view;
}

function databaseOf(doc: YDoc) {
  return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
}

function shownRows(doc: YDoc) {
  return readDashboardLayoutSetting(databaseOf(doc), VIEW_ID).rows;
}

function storedIds(doc: YDoc) {
  return readStoredDashboardWidgets(databaseOf(doc), VIEW_ID).map((widget) => widget.id);
}

/** The raw stored rows value, as a sync would carry it. */
function storedRows(doc: YDoc) {
  return JSON.stringify(
    (viewOf(doc).get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY) as Y.Map<unknown>).get(
      YjsDatabaseKey.dashboard_rows
    )
  );
}

/** One editor's local write through the layout writer, as an undoable step for the user. */
function write(doc: YDoc, update: (rows: DashboardRow[]) => DashboardRow[], undoable = false) {
  const next = update(shownRows(doc));
  const apply = () => updateDashboardLayoutSetting(viewOf(doc), { rows: next });

  if (undoable) runDatabaseAction(doc, ROWS_ACTION, apply);
  else doc.transact(apply);
}

/** Both editors receive what the other wrote, as the sync server would deliver it. */
function sync(user: YDoc, collaborator: YDoc) {
  const toUser = Y.encodeStateAsUpdate(collaborator, Y.encodeStateVector(user));
  const toCollaborator = Y.encodeStateAsUpdate(user, Y.encodeStateVector(collaborator));

  Y.applyUpdate(user, toUser, 'remote');
  Y.applyUpdate(collaborator, toCollaborator, 'remote');
}

function addInNewRow(widgetId: string) {
  return (rows: DashboardRow[]) =>
    addDashboardWidget(rows, createDashboardWidget(`view-${widgetId}`, DATABASE_ID, 12, widgetId), { type: 'new_row' });
}

function expectWithinLimit(doc: YDoc) {
  const ids = storedIds(doc);

  expect(ids.length).toBeLessThanOrEqual(DASHBOARD_MAX_WIDGETS);
  expect(new Set(ids).size).toBe(ids.length);
  expect(shownRows(doc).flatMap((row) => row.widgets)).toHaveLength(ids.length);
}

describe('the widget limit with two editors', () => {
  it('converges on one layout of at most 12 widgets when both add the twelfth at the same time', () => {
    const { user, collaborator } = createEditors(rowsOf(4, 4, 3));

    write(user, addInNewRow('mine'), true);
    write(collaborator, addInNewRow('theirs'));
    // Each editor alone is at the limit before it hears of the other.
    expect(storedIds(user)).toHaveLength(12);
    expect(storedIds(collaborator)).toHaveLength(12);

    sync(user, collaborator);

    expect(storedRows(user)).toBe(storedRows(collaborator));
    expectWithinLimit(user);
    expect(storedIds(user)).toHaveLength(12);
    // One add wins whole: never both, so never 13.
    expect(['mine', 'theirs'].filter((id) => storedIds(user).includes(id))).toHaveLength(1);
    expect(canAddDashboardWidget(shownRows(user))).toBe(false);
    expect(getDashboardAddToNewRowState(shownRows(collaborator))).toBe('disabled');
  });

  it('converges on at most 12 widgets when one editor adds to a row while the other adds a row', () => {
    const { user, collaborator } = createEditors(rowsOf(4, 4, 3));

    write(user, (rows) =>
      addDashboardWidget(rows, createDashboardWidget('view-mine', DATABASE_ID, 3, 'mine'), {
        type: 'existing_row',
        rowId: 'r:3',
      })
    );
    write(collaborator, addInNewRow('theirs'));
    sync(user, collaborator);

    expect(storedRows(user)).toBe(storedRows(collaborator));
    expectWithinLimit(user);
    expectWithinLimit(collaborator);
  });
});

describe('undo and redo across the widget limit', () => {
  it('switches the add controls off and on as a delete at the limit is undone and redone', () => {
    const { user } = createEditors(rowsOf(4, 4, 4));
    const history = getOrCreateDatabaseHistoryManager(user);

    expect(getDashboardAddToNewRowState(shownRows(user))).toBe('disabled');
    write(user, (rows) => removeDashboardWidget(rows, 'w:12'), true);
    expect(storedIds(user)).toHaveLength(11);
    expect(getDashboardAddToNewRowState(shownRows(user))).toBe('enabled');

    history.undo();
    expect(storedIds(user)).toHaveLength(12);
    expect(getDashboardAddToNewRowState(shownRows(user))).toBe('disabled');

    history.redo();
    expect(storedIds(user)).toHaveLength(11);
    expect(getDashboardAddToNewRowState(shownRows(user))).toBe('enabled');
  });

  it('never goes past 12 when a delete is undone after a collaborator filled the dashboard', () => {
    const { user, collaborator } = createEditors(rowsOf(4, 4, 4));
    const history = getOrCreateDatabaseHistoryManager(user);

    write(user, (rows) => removeDashboardWidget(rows, 'w:12'), true);
    sync(user, collaborator);
    write(collaborator, addInNewRow('theirs'));
    sync(user, collaborator);
    expect(storedIds(user)).toHaveLength(12);

    history.undo();
    sync(user, collaborator);

    expectWithinLimit(user);
    expect(storedRows(user)).toBe(storedRows(collaborator));
    // The collaborator's newer value stays: Yjs does not restore an overwritten value.
    expect(storedIds(user)).toContain('theirs');
    expect(storedIds(user)).not.toContain('w:12');

    history.redo();
    expectWithinLimit(user);
  });

  it('never goes past 12 when an add at the limit is undone and redone around a concurrent add', () => {
    const { user, collaborator } = createEditors(rowsOf(4, 4, 3));
    const history = getOrCreateDatabaseHistoryManager(user);

    write(user, addInNewRow('mine'), true);
    write(collaborator, addInNewRow('theirs'));
    sync(user, collaborator);
    history.undo();
    sync(user, collaborator);
    expectWithinLimit(user);
    expect(storedRows(user)).toBe(storedRows(collaborator));

    history.redo();
    sync(user, collaborator);
    expectWithinLimit(user);
    expect(storedRows(user)).toBe(storedRows(collaborator));
  });
});
