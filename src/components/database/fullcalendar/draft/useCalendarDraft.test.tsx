import { EventInput } from '@fullcalendar/core';
import { act, cleanup, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { useCalendarLayoutSetting, useDatabaseContext, usePrimaryFieldId } from '@/application/database-yjs';
import { DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch/row';
import { YDatabase, YDatabaseField, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { CalendarDraftSnapshot } from './CalendarEventDraft';
import { useCalendarDraft } from './useCalendarDraft';

jest.mock('@/application/database-yjs', () => ({
  useCalendarLayoutSetting: jest.fn(),
  useDatabaseContext: jest.fn(),
  usePrimaryFieldId: jest.fn(),
}));
jest.mock('@/application/database-yjs/dispatch/row', () => ({ useNewRowDispatch: jest.fn() }));

const selection = { start: new Date(2026, 8, 11, 17), end: new Date(2026, 8, 11, 18), allDay: false };
const emptyProps: { events: EventInput[]; emptyEvents: EventInput[] } = { events: [], emptyEvents: [] };
const mockContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockCreateRow = jest.fn<Promise<string | null>, [{ draft: CalendarDraftSnapshot }]>();
let sourceDoc: YDoc;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });

  return { promise, resolve, reject };
}

function createContext(): DatabaseContextState {
  sourceDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  for (const [id, type] of [['title', FieldType.RichText], ['date', FieldType.DateTime]] as const) {
    const field = new Y.Map() as YDatabaseField;

    field.set(YjsDatabaseKey.id, id);
    field.set(YjsDatabaseKey.type, type);
    field.set(YjsDatabaseKey.is_primary, id === 'title');
    fields.set(id, field);
  }

  view.set(YjsDatabaseKey.row_orders, new Y.Array());
  views.set('calendar', view);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, new Y.Map());
  sourceDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  return {
    readOnly: false, canWrite: true, databaseDoc: sourceDoc, rowMap: {},
    databasePageId: 'calendar', activeViewId: 'calendar', workspaceId: 'workspace',
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockContext.mockReturnValue(createContext());
  (useCalendarLayoutSetting as jest.Mock).mockReturnValue({ fieldId: 'date' });
  (usePrimaryFieldId as jest.Mock).mockReturnValue('title');
  (useNewRowDispatch as jest.Mock).mockReturnValue(mockCreateRow);
  mockCreateRow.mockImplementation(async ({ draft }) => draft.id);
});

afterEach(() => {
  cleanup();
  act(() => { jest.runOnlyPendingTimers(); });
  sourceDoc.destroy();
  jest.useRealTimers();
});

describe('useCalendarDraft handoff', () => {
  it.each(['events', 'emptyEvents'] as const)('keeps the placeholder until the saved row appears in %s, then permits another card', async (list) => {
    const { result, rerender } = renderHook(({ events, emptyEvents }) => useCalendarDraft(events, emptyEvents), {
      initialProps: emptyProps,
    });

    act(() => { result.current.startDraft(selection); });
    const firstId = result.current.draft!.id;
    const rowDoc = result.current.draft!.context.rowMap![firstId];
    const destroy = jest.spyOn(rowDoc, 'destroy');

    await act(async () => { await result.current.finishDraft(true); });
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
    expect(result.current.event?.id).toBe(firstId);
    expect(result.current.event?.start).toEqual(selection.start);
    expect(result.current.event?.end).toEqual(selection.end);
    expect(destroy).not.toHaveBeenCalled();

    rerender({ ...emptyProps, [list]: [{ id: firstId, title: 'Saved card' }] });
    expect(result.current.draft).toBeNull();
    expect(result.current.event).toBeNull();
    act(() => { jest.runOnlyPendingTimers(); });
    expect(destroy).toHaveBeenCalledTimes(1);
    act(() => { result.current.startDraft(selection); });
    expect(result.current.draft!.id).not.toBe(firstId);
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
  });

  it('releases a saved card hidden by an active filter without waiting for a visible event', async () => {
    const database = sourceDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    database.get(YjsDatabaseKey.views).get('calendar').set(YjsDatabaseKey.filters, Y.Array.from([
      { id: 'title-filter', field_id: 'title', filter_type: 2, condition: 2, ty: 0, content: 'Visible' },
    ]));
    const { result } = renderHook(() => useCalendarDraft([], []));

    act(() => { result.current.startDraft(selection); });
    const firstId = result.current.draft!.id;

    await act(async () => { await result.current.finishDraft(true); });
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
    expect(result.current.draft).toBeNull();
    expect(result.current.event).toBeNull();
    act(() => { result.current.startDraft(selection); });
    expect(result.current.draft!.id).not.toBe(firstId);
  });

  it('coalesces repeated selection, dismiss, and submit callbacks while persistence is pending', async () => {
    const pending = deferred<string>();

    mockCreateRow.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useCalendarDraft([], []));
    let id: string | null = null;
    let repeatedId: string | null = null;

    act(() => {
      id = result.current.startDraft(selection);
      repeatedId = result.current.startDraft(selection);
    });
    expect(id).not.toBeNull();
    expect(repeatedId).toBe(id);
    let firstSave!: Promise<string | null>;
    let secondSave!: Promise<string | null>;

    act(() => {
      firstSave = result.current.finishDraft(true);
      secondSave = result.current.finishDraft(false);
    });
    await act(async () => { await Promise.resolve(); });
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
    expect(result.current.draft!.saving).toBe(true);
    expect(result.current.draft!.context.readOnly).toBe(true);
    act(() => { result.current.discardDraft(); });
    expect(result.current.draft!.id).toBe(id);

    await act(async () => {
      pending.resolve(id!);
      await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([id, id]);
    });
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
    expect(result.current.draft!.saving).toBe(true);
    expect(result.current.draft!.context.readOnly).toBe(true);
  });

  it('locks a published row after a reciprocal-link failure until the authoritative event replaces it', async () => {
    const database = sourceDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const orders = database.get(YjsDatabaseKey.views).get('calendar').get(YjsDatabaseKey.row_orders);
    const error = new Error('Reciprocal relation update failed');

    mockCreateRow.mockImplementation(async ({ draft }) => {
      orders.push([{ id: draft.id, height: 36 }]);
      throw error;
    });
    const { result, rerender } = renderHook(({ events, emptyEvents }) => useCalendarDraft(events, emptyEvents), {
      initialProps: emptyProps,
    });

    act(() => { result.current.startDraft(selection); });
    const publishedId = result.current.draft!.id;

    await act(async () => {
      await expect(result.current.finishDraft(true)).rejects.toBe(error);
    });
    expect(orders.toArray()).toEqual([{ id: publishedId, height: 36 }]);
    expect(result.current.draft!.id).toBe(publishedId);
    expect(result.current.draft!.saving).toBe(true);
    expect(result.current.draft!.context.readOnly).toBe(true);
    expect(result.current.event?.editable).toBe(false);
    act(() => { result.current.discardDraft(); });
    expect(result.current.draft!.id).toBe(publishedId);

    await act(async () => {
      await expect(result.current.finishDraft(true)).resolves.toBe(publishedId);
    });
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
    expect(orders.length).toBe(1);

    rerender({ events: [{ id: publishedId, title: 'Published card' }], emptyEvents: [] });
    expect(result.current.draft).toBeNull();
    expect(result.current.event).toBeNull();
    act(() => { result.current.startDraft(selection); });
    expect(result.current.draft!.id).not.toBe(publishedId);
    expect(result.current.draft!.saving).toBe(false);
    expect(result.current.draft!.context.readOnly).toBe(false);
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
  });
});

describe('useCalendarDraft lifecycle', () => {
  it.each(['success', 'failure'] as const)('disposes an unmounted draft after an in-flight save finishes with %s', async (outcome) => {
    const pending = deferred<string>();

    mockCreateRow.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => useCalendarDraft([], []));

    act(() => { result.current.startDraft(selection); });
    const draft = result.current.draft!;
    const rowDoc = draft.context.rowMap![draft.id];
    const databaseDoc = draft.context.databaseDoc;
    const destroyed = jest.fn();
    const databaseDestroyed = jest.fn();

    rowDoc.on('destroy', destroyed);
    databaseDoc.on('destroy', databaseDestroyed);
    let save!: Promise<string | null>;

    act(() => { save = result.current.finishDraft(true); });
    // Attach a rejection handler before driving the asynchronous rejection.
    const settled = save.then((id) => ({ id }), (error: Error) => ({ error }));

    await act(async () => { await Promise.resolve(); });
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
    unmount();
    act(() => { jest.runOnlyPendingTimers(); });
    expect(destroyed).not.toHaveBeenCalled();
    expect(databaseDestroyed).not.toHaveBeenCalled();
    const error = new Error('Cloud unavailable');

    await act(async () => {
      if (outcome === 'success') pending.resolve(draft.id);
      else pending.reject(error);
      await expect(settled).resolves.toEqual(outcome === 'success' ? { id: draft.id } : { error });
    });
    act(() => { jest.runOnlyPendingTimers(); });
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(databaseDestroyed).toHaveBeenCalledTimes(1);
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
  });

  it('disposes an untouched draft on unmount without creating a cloud row', () => {
    const { result, unmount } = renderHook(() => useCalendarDraft([], []));

    act(() => { result.current.startDraft(selection); });
    const draft = result.current.draft!;
    const rowDoc = draft.context.rowMap![draft.id];
    const destroyRow = jest.spyOn(rowDoc, 'destroy');
    const destroyDatabase = jest.spyOn(draft.context.databaseDoc, 'destroy');

    unmount();
    act(() => { jest.runOnlyPendingTimers(); });
    expect(destroyRow).toHaveBeenCalledTimes(1);
    expect(destroyDatabase).toHaveBeenCalledTimes(1);
    expect(mockCreateRow).not.toHaveBeenCalled();
  });
});
