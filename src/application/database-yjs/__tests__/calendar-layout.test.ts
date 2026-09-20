import * as Y from 'yjs';

import { YDatabase, YDatabaseView, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { createCalendarLayoutStore, readCalendarLayoutSetting, updateCalendarLayoutSetting } from '../calendar-layout';
import { CalendarLayout } from '../database.type';

import { calendarYrsDelta, calendarYrsInitial } from './fixtures/calendar-yrs';

test('decodes actual native Yrs BigInt updates and observes the delta before a web edit', () => {
  const doc = new Y.Doc();
  const store = createCalendarLayoutStore(doc, 'calendar', 0, false);
  const notify = jest.fn();
  const unsubscribe = store.subscribe(notify);

  Y.applyUpdate(doc, Uint8Array.from(Buffer.from(calendarYrsInitial, 'base64')), 'desktop');
  expect(store.getSnapshot()).toMatchObject({ layout: 1, numberOfDays: 4, firstDayOfWeek: 2 });
  Y.applyUpdate(doc, Uint8Array.from(Buffer.from(calendarYrsDelta, 'base64')), 'desktop');
  expect(store.getSnapshot()).toMatchObject({ layout: 1, numberOfDays: 8 });
  expect(notify).toHaveBeenCalledTimes(2);
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const view = database.get(YjsDatabaseKey.views).get('calendar');
  const setting = view.get(YjsDatabaseKey.layout_settings).get('2');

  expect(typeof setting.get(YjsDatabaseKey.layout_ty)).toBe('bigint');
  expect(typeof setting.get(YjsDatabaseKey.day_count)).toBe('bigint');
  expect(typeof setting.get(YjsDatabaseKey.first_day_of_week_v2)).toBe('bigint');
  doc.transact(() => updateCalendarLayoutSetting(view, { layout: CalendarLayout.WeekLayout, numberOfDays: 3 }));
  const reopened = new Y.Doc();

  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  const reopenedStore = createCalendarLayoutStore(reopened, 'calendar', 0, false);

  expect(reopenedStore.getSnapshot()).toMatchObject({ layout: 1, numberOfDays: 3, firstDayOfWeek: 2 });
  expect(typeof setting.get(YjsDatabaseKey.day_count)).toBe('number');
  unsubscribe();
});

function createFixture() {
  const doc = new Y.Doc();
  const database = new Y.Map() as YDatabase;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  database.set(YjsDatabaseKey.views, views);
  views.set('calendar', view);
  return { doc, database, view, views };
}

function sync(source: Y.Doc, target: Y.Doc) {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)), 'remote');
}

test('changes update the observing peer view; web changes round trip and reopen', () => {
  const desktop = createFixture();
  const webDoc = new Y.Doc();

  desktop.doc.transact(() =>
    updateCalendarLayoutSetting(desktop.view, {
      fieldId: 'date',
      firstDayOfWeek: 1,
      showWeekends: true,
      layout: CalendarLayout.WeekLayout,
      numberOfDays: 4,
    })
  );
  const setting = desktop.view.get(YjsDatabaseKey.layout_settings).get('2');

  setting.set(YjsDatabaseKey.layout_ty, 1);
  setting.set(YjsDatabaseKey.day_count, 4);
  sync(desktop.doc, webDoc);
  const web = webDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const store = createCalendarLayoutStore(webDoc, 'calendar', 0, true);
  const notify = jest.fn();
  const unsubscribe = store.subscribe(notify);

  expect(store.getSnapshot()).toMatchObject({ layout: 1, numberOfDays: 4, fieldId: 'date', firstDayOfWeek: 1 });
  desktop.doc.transact(() => setting.set(YjsDatabaseKey.day_count, 8));
  sync(desktop.doc, webDoc);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().numberOfDays).toBe(8);

  const webView = web.get(YjsDatabaseKey.views).get('calendar');

  webDoc.transact(() => updateCalendarLayoutSetting(webView, { layout: CalendarLayout.MonthLayout }));
  sync(webDoc, desktop.doc);
  expect(Number(setting.get(YjsDatabaseKey.layout_ty))).toBe(0);
  expect(setting.get(YjsDatabaseKey.day_count)).toBeUndefined();
  expect(readCalendarLayoutSetting(desktop.database, 'calendar', 0, true)).toMatchObject({
    layout: 0,
    fieldId: 'date',
    firstDayOfWeek: 1,
  });
  const reopened = new Y.Doc();

  sync(webDoc, reopened);
  expect(
    readCalendarLayoutSetting(
      reopened.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase,
      'calendar',
      0,
      false
    ).layout
  ).toBe(0);
  unsubscribe();
  setting.set(YjsDatabaseKey.layout_ty, 2);
  sync(desktop.doc, webDoc);
  expect(notify).toHaveBeenCalledTimes(2);
});

test.each(['layout_settings', 'calendar', 'view', 'views', 'database'] as const)(
  'observes insertion, replacement and removal of %s maps',
  (level) => {
    const desktop = createFixture();
    const webDoc = new Y.Doc();

    sync(desktop.doc, webDoc);
    const store = createCalendarLayoutStore(webDoc, 'calendar', 0, false);
    const notify = jest.fn();
    const unsubscribe = store.subscribe(notify);

    desktop.doc.transact(() =>
      updateCalendarLayoutSetting(desktop.view, { layout: CalendarLayout.WeekLayout, numberOfDays: 8 })
    );
    sync(desktop.doc, webDoc);
    expect(store.getSnapshot().numberOfDays).toBe(8);
    const newView = new Y.Map() as YDatabaseView;
    const layouts = new Y.Map();
    const setting = new Y.Map();

    setting.set(YjsDatabaseKey.layout_ty, 2);
    setting.set(YjsDatabaseKey.day_count, 1);
    layouts.set('2', setting);
    newView.set(YjsDatabaseKey.layout_settings, layouts);

    if (level === 'database')
      desktop.doc
        .getMap(YjsEditorKey.data_section)
        .set(YjsEditorKey.database, new Y.Map([[YjsDatabaseKey.views, new Y.Map([['calendar', newView]])]]));
    if (level === 'views') desktop.database.set(YjsDatabaseKey.views, new Y.Map([['calendar', newView]]));
    if (level === 'view') desktop.views.set('calendar', newView);
    if (level === 'layout_settings') desktop.view.set(YjsDatabaseKey.layout_settings, layouts);
    if (level === 'calendar') desktop.view.get(YjsDatabaseKey.layout_settings).set('2', setting);
    sync(desktop.doc, webDoc);
    expect(store.getSnapshot()).toMatchObject({ layout: 2, numberOfDays: 1 });
    const currentDatabase = desktop.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const currentViews = currentDatabase.get(YjsDatabaseKey.views);
    const currentView = currentViews.get('calendar');

    if (level === 'database') desktop.doc.getMap(YjsEditorKey.data_section).delete(YjsEditorKey.database);
    if (level === 'views') desktop.database.delete(YjsDatabaseKey.views);
    if (level === 'view') currentViews.delete('calendar');
    if (level === 'layout_settings') currentView.delete(YjsDatabaseKey.layout_settings);
    if (level === 'calendar') currentView.get(YjsDatabaseKey.layout_settings).delete('2');
    sync(desktop.doc, webDoc);
    expect(store.getSnapshot().layout).toBe(CalendarLayout.MonthLayout);
    expect(notify).toHaveBeenCalledTimes(3);
    unsubscribe();
  }
);

test('legacy day counts are readable, canonical valid counts win, invalid values fall back', () => {
  const { database, view } = createFixture();

  updateCalendarLayoutSetting(view, { fieldId: 'date' });
  const setting = view.get(YjsDatabaseKey.layout_settings).get('2');
  const read = () => readCalendarLayoutSetting(database, 'calendar', 1, false);

  setting.set(YjsDatabaseKey.layout_ty, 1);
  setting.set(YjsDatabaseKey.number_of_days, 5);
  expect(read()).toMatchObject({ layout: 1, numberOfDays: 5 });
  setting.set(YjsDatabaseKey.layout_ty, 2);
  setting.set(YjsDatabaseKey.day_count, 1);
  expect(read()).toMatchObject({ layout: 2, numberOfDays: 1 });
  setting.set(YjsDatabaseKey.number_of_days, 4);
  expect(read().numberOfDays).toBe(1);
  setting.set(YjsDatabaseKey.layout_ty, null);
  setting.set(YjsDatabaseKey.day_count, 2.5);
  expect(read()).toMatchObject({ layout: 0, numberOfDays: 7 });
  setting.set(YjsDatabaseKey.layout_ty, 99);
  setting.set(YjsDatabaseKey.number_of_days, 999999999999999999);
  expect(read()).toMatchObject({ layout: 0, numberOfDays: 7 });
});

test('native weekday key wins over old web settings and writes preserve unrelated options', () => {
  const { database, view } = createFixture();

  updateCalendarLayoutSetting(view, { fieldId: 'date' });
  const setting = view.get(YjsDatabaseKey.layout_settings).get('2');
  const read = () => readCalendarLayoutSetting(database, 'calendar', 4, false);

  expect(read().firstDayOfWeek).toBe(4);
  setting.set(YjsDatabaseKey.first_day_of_week, 0);
  expect(read().firstDayOfWeek).toBe(0);
  setting.set(YjsDatabaseKey.first_day_of_week_v2, 2);
  expect(read().firstDayOfWeek).toBe(2);
  setting.set(YjsDatabaseKey.first_day_of_week, 1);
  expect(read().firstDayOfWeek).toBe(2);
  setting.set(YjsDatabaseKey.first_day_of_week_v2, 99);
  expect(read().firstDayOfWeek).toBe(1);
  updateCalendarLayoutSetting(view, { firstDayOfWeek: 5 });
  expect(setting.get(YjsDatabaseKey.first_day_of_week_v2)).toBe(5);
  expect(setting.get(YjsDatabaseKey.first_day_of_week)).toBe(1);
  expect(read().fieldId).toBe('date');
});

test.each([
  [CalendarLayout.MonthLayout, 8, 7],
  [CalendarLayout.DayLayout, 8, 1],
  [CalendarLayout.WeekLayout, 1, 1],
  [CalendarLayout.WeekLayout, 7, 7],
  [CalendarLayout.WeekLayout, 8, 8],
  [CalendarLayout.WeekLayout, 2.5, 7],
])('normalizes layout %s with count %s to desktop day count %s', (layout, count, expected) => {
  const { database, view } = createFixture();

  updateCalendarLayoutSetting(view, { layout, numberOfDays: count });
  expect(readCalendarLayoutSetting(database, 'calendar', 0, false).numberOfDays).toBe(expected);
});

test('layout changes preserve unknown options and clear legacy custom ranges when selecting Month', () => {
  const { database, view } = createFixture();

  updateCalendarLayoutSetting(view, { fieldId: 'date', firstDayOfWeek: 1, showWeekNumbers: true });
  const setting = view.get(YjsDatabaseKey.layout_settings).get('2');

  setting.set('future_option', 'preserved');
  setting.set(YjsDatabaseKey.number_of_days, 8);
  updateCalendarLayoutSetting(view, { layout: CalendarLayout.WeekLayout, numberOfDays: 3 });
  expect(setting.get('future_option' as YjsDatabaseKey.field_id)).toBe('preserved');
  expect(readCalendarLayoutSetting(database, 'calendar', 0, false)).toMatchObject({
    fieldId: 'date',
    firstDayOfWeek: 1,
    showWeekNumbers: true,
    numberOfDays: 3,
  });
  updateCalendarLayoutSetting(view, { layout: CalendarLayout.MonthLayout });
  expect(setting.has(YjsDatabaseKey.day_count)).toBe(false);
  expect(setting.has(YjsDatabaseKey.number_of_days)).toBe(false);
  expect(setting.get(YjsDatabaseKey.layout_ty)).toBe(0);
});

test('unrelated row/view changes and unchanged calendar values do not invalidate snapshots', () => {
  const { doc, view, views } = createFixture();
  const store = createCalendarLayoutStore(doc, 'calendar', 0, false);
  const initial = store.getSnapshot();
  const notify = jest.fn();
  const unsubscribe = store.subscribe(notify);

  view.set(YjsDatabaseKey.row_orders, new Y.Array());
  views.set('other', new Y.Map() as YDatabaseView);
  updateCalendarLayoutSetting(view, { layout: CalendarLayout.MonthLayout });
  expect(store.getSnapshot()).toBe(initial);
  expect(notify).not.toHaveBeenCalled();
  unsubscribe();
});
