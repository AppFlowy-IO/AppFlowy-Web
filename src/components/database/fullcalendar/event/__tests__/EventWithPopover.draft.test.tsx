/**
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import { EventContentArg, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import FullCalendar from '@fullcalendar/react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useMemo } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabase, YDatabaseField, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { useCalendarDraft } from '../../draft/useCalendarDraft';
import { CalendarDraftContext } from '../CalendarDraftContext';
import { EventWithPopover } from '../EventWithPopover';

const mockCreateRow = jest.fn();

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: jest.requireActual('@/application/database-yjs/context').useDatabaseContext,
  useCalendarLayoutSetting: () => ({ fieldId: 'date' }),
  usePrimaryFieldId: () => 'title',
}));
jest.mock('@/application/database-yjs/dispatch/row', () => ({ useNewRowDispatch: () => mockCreateRow }));
jest.mock('@/components/database/components/database-row/DeleteRowConfirm', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../CalendarContent', () => ({
  useEventContext: () => ({}),
}));
jest.mock('../EventDisplay', () => ({
  EventDisplay: ({ event }: EventContentArg) => {
    // Keep the real metadata observer used by EventIconButton: it resolves
    // the row through whichever DatabaseContext the event is rendered under.
    const { useRowMetaSelector } = jest.requireActual('@/application/database-yjs/selector');

    useRowMetaSelector(event.id);
    return <div data-testid='event-display'>{event.id}</div>;
  },
}));
jest.mock('../EventPopoverContent', () => ({
  __esModule: true,
  default: ({ onCloseEvent, onRequestDelete }: { onCloseEvent: () => void; onRequestDelete: () => void }) => (
    <>
      <button onClick={onCloseEvent}>Close draft</button>
      <button onClick={onRequestDelete}>Discard draft</button>
    </>
  ),
}));

const emptyEvents: EventInput[] = [];
const plugins = [dayGridPlugin];
const renderEvent = (eventInfo: EventContentArg) => <EventWithPopover event={eventInfo.event} eventInfo={eventInfo} />;

function DraftCalendar() {
  const { draft, event, startDraft, finishDraft, discardDraft } = useCalendarDraft(emptyEvents, emptyEvents);
  const events = useMemo(() => (event ? [event] : emptyEvents), [event]);

  return (
    <CalendarDraftContext.Provider value={{ draft, finishDraft, discardDraft }}>
      <button onClick={() => startDraft({ start: new Date(2026, 8, 11), allDay: true })}>New draft</button>
      <FullCalendar
        plugins={plugins}
        initialView='dayGridMonth'
        initialDate='2026-09-11'
        events={events}
        eventContent={renderEvent}
      />
    </CalendarDraftContext.Provider>
  );
}

function createContext(): DatabaseContextState {
  const databaseDoc = new Y.Doc() as YDoc;
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
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  return {
    readOnly: false,
    databaseDoc,
    rowMap: {},
    ensureRow: jest.fn(async () => undefined),
    databasePageId: 'calendar',
    activeViewId: 'calendar',
    workspaceId: 'workspace',
  };
}

describe('FullCalendar draft removal', () => {
  let context: DatabaseContextState;

  beforeAll(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() { return undefined; }
        unobserve() { return undefined; }
        disconnect() { return undefined; }
      },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    context = createContext();
  });

  afterEach(() => {
    cleanup();
    context.databaseDoc.destroy();
  });

  it.each(['Close draft', 'Discard draft'])('never loads the discarded row through the live context after %s', async (action) => {
    render(<DatabaseContext.Provider value={context}><DraftCalendar /></DatabaseContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'New draft' }));
    const dismiss = await screen.findByRole('button', { name: action });

    expect(screen.getByTestId('event-display')).toBeTruthy();
    expect(context.ensureRow).not.toHaveBeenCalled();
    fireEvent.click(dismiss);
    await waitFor(() => expect(screen.queryByTestId('event-display')).toBeNull());
    expect(mockCreateRow).not.toHaveBeenCalled();
    expect(context.ensureRow).not.toHaveBeenCalled();
  });
});
