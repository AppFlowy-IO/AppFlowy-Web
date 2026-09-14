import * as Y from 'yjs';

import { YDatabase, YDatabaseView, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  TimelineDependencyDirection,
  TimelineDependencyShift,
  TimelineDependencyType,
  TimelineLayout,
} from '../database.type';
import {
  createTimelineLayoutStore,
  initializeTimelineLayoutSetting,
  readTimelineLayoutSetting,
  TIMELINE_LAYOUT_KEY,
  updateTimelineLayoutSetting,
} from '../timeline-layout';

function createFixture() {
  const doc = new Y.Doc();
  const database = new Y.Map() as YDatabase;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  database.set(YjsDatabaseKey.views, views);
  views.set('timeline', view);
  return { doc, database, view, views };
}

function sync(source: Y.Doc, target: Y.Doc) {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)), 'remote');
}

test('missing setting falls back to month scale, docked table, and the user week start', () => {
  const { database } = createFixture();

  expect(readTimelineLayoutSetting(database, 'timeline', 1, false)).toEqual({
    fieldId: '',
    layout: TimelineLayout.Month,
    showTable: true,
    firstDayOfWeek: 1,
    endFieldId: '',
    dependencyFieldId: '',
    dependencyDirection: TimelineDependencyDirection.BlockedBy,
    dependencyLinks: {},
    dependencyShift: TimelineDependencyShift.OverlapOnly,
    avoidWeekends: false,
    progressFieldId: '',
    tableFieldIds: [],
    use24Hour: false,
  });
});

test('initialize seeds the field once and repairs a stale field without touching the scale', () => {
  const { doc, view, database } = createFixture();

  doc.transact(() => initializeTimelineLayoutSetting(view, 'date'));
  doc.transact(() => updateTimelineLayoutSetting(view, { layout: TimelineLayout.Week, showTable: false }));
  doc.transact(() => initializeTimelineLayoutSetting(view, 'date'));
  expect(readTimelineLayoutSetting(database, 'timeline', 0, false)).toMatchObject({
    fieldId: 'date',
    layout: TimelineLayout.Week,
    showTable: false,
  });

  doc.transact(() => initializeTimelineLayoutSetting(view, 'other-date'));
  expect(readTimelineLayoutSetting(database, 'timeline', 0, false)).toMatchObject({
    fieldId: 'other-date',
    layout: TimelineLayout.Week,
    showTable: false,
  });
});

test('integers written by the server as BigInt decode like web numbers', () => {
  // Yjs cannot author BigInt values, so stub the map chain the reader walks.
  const values: Record<string, unknown> = {
    [YjsDatabaseKey.field_id]: 'date',
    [YjsDatabaseKey.layout_ty]: BigInt(TimelineLayout.Quarter),
    [YjsDatabaseKey.show_table]: false,
    [YjsDatabaseKey.first_day_of_week_v2]: BigInt(1),
  };
  const setting = { get: (key: string) => values[key] };
  const layouts = { get: (key: string) => (key === TIMELINE_LAYOUT_KEY ? setting : undefined) };
  const view = { get: (key: string) => (key === YjsDatabaseKey.layout_settings ? layouts : undefined) };
  const views = { get: (viewId: string) => (viewId === 'timeline' ? view : undefined) };
  const database = { get: (key: string) => (key === YjsDatabaseKey.views ? views : undefined) } as unknown as YDatabase;

  expect(readTimelineLayoutSetting(database, 'timeline', 0, false)).toEqual({
    fieldId: 'date',
    layout: TimelineLayout.Quarter,
    showTable: false,
    firstDayOfWeek: 1,
    endFieldId: '',
    dependencyFieldId: '',
    dependencyDirection: TimelineDependencyDirection.BlockedBy,
    dependencyLinks: {},
    dependencyShift: TimelineDependencyShift.OverlapOnly,
    avoidWeekends: false,
    progressFieldId: '',
    tableFieldIds: [],
    use24Hour: false,
  });
});

test('dependency and progress bindings are optional keys that an empty id removes', () => {
  const { doc, view, database } = createFixture();

  doc.transact(() =>
    updateTimelineLayoutSetting(view, { fieldId: 'date', dependencyFieldId: 'rel', progressFieldId: 'num' })
  );
  expect(readTimelineLayoutSetting(database, 'timeline', 0, false)).toMatchObject({
    dependencyFieldId: 'rel',
    progressFieldId: 'num',
  });
  doc.transact(() => updateTimelineLayoutSetting(view, { dependencyFieldId: '' }));
  const setting = view.get(YjsDatabaseKey.layout_settings).get(TIMELINE_LAYOUT_KEY);

  expect(setting.has(YjsDatabaseKey.dependency_field_id)).toBe(false);
  expect(setting.get(YjsDatabaseKey.progress_field_id)).toBe('num');
});

test('dependency shift, avoid-weekends and the end field round-trip like the calendar keys', () => {
  const { doc, view, database } = createFixture();

  doc.transact(() =>
    updateTimelineLayoutSetting(view, {
      fieldId: 'date',
      endFieldId: 'date-end',
      dependencyShift: TimelineDependencyShift.MaintainGap,
      avoidWeekends: true,
    })
  );
  expect(readTimelineLayoutSetting(database, 'timeline', 0, false)).toMatchObject({
    endFieldId: 'date-end',
    dependencyShift: TimelineDependencyShift.MaintainGap,
    avoidWeekends: true,
  });
  const setting = view.get(YjsDatabaseKey.layout_settings).get(TIMELINE_LAYOUT_KEY);

  expect(setting.get(YjsDatabaseKey.dependency_shift_ty)).toBe(1);
  doc.transact(() =>
    updateTimelineLayoutSetting(view, { endFieldId: '', dependencyShift: 99 as TimelineDependencyShift })
  );
  expect(setting.has(YjsDatabaseKey.end_field_id)).toBe(false);
  doc.transact(() => updateTimelineLayoutSetting(view, { tableFieldIds: ['num', 'sel'] }));
  expect(readTimelineLayoutSetting(database, 'timeline', 0, false).tableFieldIds).toEqual(['num', 'sel']);
  doc.transact(() => updateTimelineLayoutSetting(view, { tableFieldIds: [] }));
  expect(setting.has(YjsDatabaseKey.table_field_ids)).toBe(false);
  // Out-of-range wire values fall back to Notion's default.
  expect(readTimelineLayoutSetting(database, 'timeline', 0, false).dependencyShift).toBe(
    TimelineDependencyShift.OverlapOnly
  );
});

test('the store notifies on remote changes only for this view and tolerates bad values', () => {
  const desktop = createFixture();
  const webDoc = new Y.Doc();

  desktop.doc.transact(() =>
    updateTimelineLayoutSetting(desktop.view, {
      fieldId: 'date',
      layout: TimelineLayout.Quarter,
      showTable: false,
      firstDayOfWeek: 1,
    })
  );
  const setting = desktop.view.get(YjsDatabaseKey.layout_settings).get(TIMELINE_LAYOUT_KEY);

  sync(desktop.doc, webDoc);

  const store = createTimelineLayoutStore(webDoc, 'timeline', 0, false);
  const notify = jest.fn();
  const unsubscribe = store.subscribe(notify);

  expect(store.getSnapshot()).toEqual({
    fieldId: 'date',
    layout: TimelineLayout.Quarter,
    showTable: false,
    firstDayOfWeek: 1,
    endFieldId: '',
    dependencyFieldId: '',
    dependencyDirection: TimelineDependencyDirection.BlockedBy,
    dependencyLinks: {},
    dependencyShift: TimelineDependencyShift.OverlapOnly,
    avoidWeekends: false,
    progressFieldId: '',
    tableFieldIds: [],
    use24Hour: false,
  });

  desktop.doc.transact(() => setting.set(YjsDatabaseKey.layout_ty, TimelineLayout.Year));
  sync(desktop.doc, webDoc);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().layout).toBe(TimelineLayout.Year);

  // An unrelated layout's setting must not notify timeline consumers.
  desktop.doc.transact(() => {
    const calendar = new Y.Map();

    desktop.view.get(YjsDatabaseKey.layout_settings).set('2', calendar);
    calendar.set(YjsDatabaseKey.field_id, 'date');
  });
  sync(desktop.doc, webDoc);
  expect(notify).toHaveBeenCalledTimes(1);

  // Out-of-range values fall back rather than crash.
  desktop.doc.transact(() => setting.set(YjsDatabaseKey.layout_ty, 99));
  sync(desktop.doc, webDoc);
  expect(store.getSnapshot().layout).toBe(TimelineLayout.Month);
  unsubscribe();
});

test('reads the week start like the calendar: v2 key, then the legacy key, then the user preference', () => {
  const { doc, view, database } = createFixture();

  expect(readTimelineLayoutSetting(database, 'timeline', 3, true)).toMatchObject({ firstDayOfWeek: 3, use24Hour: true });

  doc.transact(() => {
    updateTimelineLayoutSetting(view, { fieldId: 'date' });
    view.get(YjsDatabaseKey.layout_settings).get(TIMELINE_LAYOUT_KEY).set(YjsDatabaseKey.first_day_of_week, 1);
  });
  expect(readTimelineLayoutSetting(database, 'timeline', 3, false).firstDayOfWeek).toBe(1);

  doc.transact(() => updateTimelineLayoutSetting(view, { firstDayOfWeek: 0 }));
  expect(readTimelineLayoutSetting(database, 'timeline', 3, false).firstDayOfWeek).toBe(0);
});

test('the scale is stored under layout_ty, the key the calendar uses for its mode', () => {
  const { doc, view } = createFixture();

  doc.transact(() => updateTimelineLayoutSetting(view, { fieldId: 'date', layout: TimelineLayout.Quarter }));
  const setting = view.get(YjsDatabaseKey.layout_settings).get(TIMELINE_LAYOUT_KEY);

  expect(setting.get(YjsDatabaseKey.layout_ty)).toBe(TimelineLayout.Quarter);
  expect(setting.has('zoom')).toBe(false);
});

test('dependency direction and per-link type / lag round-trip; default links need no entry', () => {
  const { doc, view, database } = createFixture();

  doc.transact(() =>
    updateTimelineLayoutSetting(view, {
      fieldId: 'date',
      dependencyDirection: TimelineDependencyDirection.Blocking,
      dependencyLinks: {
        'a:b': { type: TimelineDependencyType.StartToStart, lag: 2 },
        'b:c': { type: TimelineDependencyType.FinishToStart, lag: 0 },
        'c:d': { type: TimelineDependencyType.FinishToStart, lag: -1 },
      },
    })
  );
  const read = readTimelineLayoutSetting(database, 'timeline', 0, false);

  expect(read.dependencyDirection).toBe(TimelineDependencyDirection.Blocking);
  expect(read.dependencyLinks).toEqual({
    'a:b': { type: TimelineDependencyType.StartToStart, lag: 2 },
    'c:d': { type: TimelineDependencyType.FinishToStart, lag: -1 },
  });
  const setting = view.get(YjsDatabaseKey.layout_settings).get(TIMELINE_LAYOUT_KEY);

  expect(setting.get(YjsDatabaseKey.dependency_links)).toEqual({ 'a:b': { ty: 1, lag: 2 }, 'c:d': { ty: 0, lag: -1 } });
  doc.transact(() => updateTimelineLayoutSetting(view, { dependencyLinks: {} }));
  expect(setting.has(YjsDatabaseKey.dependency_links)).toBe(false);
});
