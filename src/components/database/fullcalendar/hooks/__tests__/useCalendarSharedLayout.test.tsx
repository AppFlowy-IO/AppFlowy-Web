import { act, renderHook } from '@testing-library/react';
import { ReactNode, useState } from 'react';
import * as Y from 'yjs';

import {
  calendarYrsDelta,
  calendarYrsInitial,
  calendarYrsWeekDelta,
} from '@/application/database-yjs/__tests__/fixtures/calendar-yrs';
import { updateCalendarLayoutSetting } from '@/application/database-yjs/calendar-layout';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { CalendarLayout } from '@/application/database-yjs/database.type';
import { useUpdateCalendarSetting } from '@/application/database-yjs/dispatch';
import { useCalendarLayoutSetting } from '@/application/database-yjs/selector';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import { CalendarViewType } from '../../types';
import { useCalendarHandlers } from '../useCalendarHandlers';

jest.mock('../useCalendarEvents', () => ({ useCalendarEvents: () => ({}) }));

function wrapperFor(doc: YDoc, readOnly = false) {
  const context: DatabaseContextState = {
    activeViewId: 'calendar',
    databaseDoc: doc,
    databasePageId: 'calendar',
    readOnly,
    rowMap: {},
    workspaceId: 'workspace',
  };

  return ({ children }: { children: ReactNode }) => (
    <AFConfigContext.Provider
      value={{ isAuthenticated: false, openLoginModal: () => undefined, updateCurrentUser: async () => undefined }}
    >
      <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );
}

function fixture(readOnly = false) {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const view = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.views, new Y.Map([['calendar', view]]));

  return { doc, database, view, wrapper: wrapperFor(doc, readOnly) };
}

function remoteCopy(doc: Y.Doc) {
  const remote = new Y.Doc();

  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const database = remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  return { remote, view: database.get(YjsDatabaseKey.views).get('calendar') };
}

function applyRemote(remote: Y.Doc, local: Y.Doc) {
  act(() => Y.applyUpdate(local, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(local)), 'remote'));
}

it('changes Month to Week through the real selector when native BigInt updates arrive and restores Week on reopen', () => {
  const doc = new Y.Doc() as YDoc;
  const wrapper = wrapperFor(doc);
  const localWrites = jest.fn();
  const { result, unmount } = renderHook(
    () => {
      const handlers = useCalendarHandlers();
      const settings = useCalendarLayoutSetting();
      const [editorDraft] = useState('draft title');

      return { currentView: handlers.currentView, settings, editorDraft };
    },
    { wrapper }
  );

  expect(result.current.currentView).toBe(CalendarViewType.DAY_GRID_MONTH);
  doc.on('afterTransaction', (transaction) => {
    if (transaction.local && transaction.changed.size) localWrites();
  });
  act(() => {
    for (const update of [calendarYrsInitial, calendarYrsDelta, calendarYrsWeekDelta]) {
      Y.applyUpdate(doc, Uint8Array.from(Buffer.from(update, 'base64')), 'desktop');
    }
  });
  expect(result.current.currentView).toBe(CalendarViewType.TIME_GRID_WEEK);
  expect(result.current.settings).toMatchObject({ layout: 1, numberOfDays: 7, firstDayOfWeek: 2 });
  expect(result.current.editorDraft).toBe('draft title');
  expect(localWrites).not.toHaveBeenCalled();
  unmount();

  const reopenedDoc = new Y.Doc() as YDoc;

  Y.applyUpdate(reopenedDoc, Y.encodeStateAsUpdate(doc));
  const reopened = renderHook(useCalendarHandlers, { wrapper: wrapperFor(reopenedDoc) });

  expect(reopened.result.current.currentView).toBe(CalendarViewType.TIME_GRID_WEEK);
});

it('restores the first render from Yrs-compatible config and responds to remote changes without writing back', () => {
  const { doc, view, wrapper } = fixture();

  updateCalendarLayoutSetting(view, { layout: CalendarLayout.WeekLayout, numberOfDays: 4, fieldId: 'date' });
  const renders: CalendarViewType[] = [];
  const { result } = renderHook(
    () => {
      const handlers = useCalendarHandlers();
      const [editorDraft, setEditorDraft] = useState('draft title');

      renders.push(handlers.currentView);
      return { ...handlers, editorDraft, setEditorDraft };
    },
    { wrapper }
  );

  expect(renders[0]).toBe(CalendarViewType.TIME_GRID_4_DAYS);
  const peer = remoteCopy(doc);
  const settings = peer.view.get(YjsDatabaseKey.layout_settings).get('2');
  const localWrites = jest.fn();

  doc.on('afterTransaction', (transaction) => {
    if (transaction.local && transaction.changed.size) localWrites();
  });
  peer.remote.transact(() => {
    settings.set(YjsDatabaseKey.layout_ty, 2);
    settings.set(YjsDatabaseKey.day_count, 1);
  });
  applyRemote(peer.remote, doc);
  expect(result.current.currentView).toBe(CalendarViewType.TIME_GRID_DAY);
  expect(result.current.editorDraft).toBe('draft title');
  expect(localWrites).not.toHaveBeenCalled();

  act(() => result.current.handleViewChange(CalendarViewType.TIME_GRID_8_DAYS, null));
  expect(result.current.currentView).toBe(CalendarViewType.TIME_GRID_8_DAYS);
  expect(view.get(YjsDatabaseKey.layout_settings).get('2').get(YjsDatabaseKey.day_count)).toBe(8);
  expect(localWrites).toHaveBeenCalledTimes(1);
  act(() => result.current.handleViewChange(CalendarViewType.TIME_GRID_8_DAYS, null));
  expect(localWrites).toHaveBeenCalledTimes(1);
});

it('readonly mode switching stays local until reopening even when shared layout changes', () => {
  const { doc, view, wrapper } = fixture(true);

  updateCalendarLayoutSetting(view, { layout: CalendarLayout.WeekLayout, numberOfDays: 7 });
  const { result, unmount } = renderHook(() => ({ ...useCalendarHandlers(), update: useUpdateCalendarSetting() }), {
    wrapper,
  });
  const before = Y.encodeStateAsUpdate(doc);

  act(() => result.current.handleViewChange(CalendarViewType.TIME_GRID_4_DAYS, null));
  expect(result.current.currentView).toBe(CalendarViewType.TIME_GRID_4_DAYS);
  act(() => result.current.update({ layout: CalendarLayout.MonthLayout }));
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  const peer = remoteCopy(doc);

  updateCalendarLayoutSetting(peer.view, { layout: CalendarLayout.DayLayout, numberOfDays: 1 });
  applyRemote(peer.remote, doc);
  expect(result.current.currentView).toBe(CalendarViewType.TIME_GRID_4_DAYS);
  updateCalendarLayoutSetting(peer.view, { layout: CalendarLayout.WeekLayout, numberOfDays: 7 });
  applyRemote(peer.remote, doc);
  expect(result.current.currentView).toBe(CalendarViewType.TIME_GRID_4_DAYS);
  unmount();
  const reopened = renderHook(useCalendarHandlers, { wrapper });

  expect(reopened.result.current.currentView).toBe(CalendarViewType.TIME_GRID_WEEK);
});

it('subscribes before calendar settings exist and skips rerenders for row changes', () => {
  const { doc, view, wrapper } = fixture();
  const render = jest.fn();
  const { result } = renderHook(
    () => {
      render();
      return useCalendarLayoutSetting();
    },
    { wrapper }
  );
  const renderCount = render.mock.calls.length;

  act(() => { view.set(YjsDatabaseKey.row_orders, new Y.Array()); });
  expect(render).toHaveBeenCalledTimes(renderCount);
  const peer = remoteCopy(doc);

  updateCalendarLayoutSetting(peer.view, { layout: CalendarLayout.WeekLayout, numberOfDays: 3 });
  applyRemote(peer.remote, doc);
  expect(result.current.numberOfDays).toBe(3);
});

it('writes into the current replacement view even when its config values did not change', () => {
  const { doc, database, view, wrapper } = fixture();

  updateCalendarLayoutSetting(view, { layout: CalendarLayout.MonthLayout });
  const { result } = renderHook(useUpdateCalendarSetting, { wrapper });
  const peer = remoteCopy(doc);
  const replacement = peer.view.clone() as YDatabaseView;
  const peerDatabase = peer.remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  peerDatabase.get(YjsDatabaseKey.views).set('calendar', replacement);
  applyRemote(peer.remote, doc);
  act(() => result.current({ layout: CalendarLayout.WeekLayout, numberOfDays: 6 }));
  expect(
    database
      .get(YjsDatabaseKey.views)
      .get('calendar')
      .get(YjsDatabaseKey.layout_settings)
      .get('2')
      .get(YjsDatabaseKey.day_count)
  ).toBe(6);
});
