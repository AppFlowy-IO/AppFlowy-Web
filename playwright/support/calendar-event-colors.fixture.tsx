import { Calendar, EventContentArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { generateRowMeta } from '@/application/database-yjs/row_meta';
import { YDoc } from '@/application/types';
import { calendarEventCompletionTime } from '@/components/database/fullcalendar/event/eventAppearance';
import { EventDisplay } from '@/components/database/fullcalendar/event/EventDisplay';
import { AFConfigContext } from '@/components/main/app.hooks';

import '@/styles/global.css';
import '@/components/database/fullcalendar/FullCalendar.styles.scss';

const calendar = new Calendar(document.createElement('div'), { plugins: [dayGridPlugin] });
const context: DatabaseContextState = {
  databaseDoc: new Y.Doc() as YDoc,
  activeViewId: 'calendar',
  databasePageId: 'calendar',
  rowMap: {},
  readOnly: false,
  workspaceId: 'fixture',
};
const kinds = [
  'week-long',
  'week-short',
  'week-all-day',
  'month-timed',
  'month-range',
  'month-all-day',
  'popover-timed',
  'popover-all-day',
];
// Keep single-day timed samples within one date, even when the test runs at midnight.
const referenceDate = new Date();

referenceDate.setHours(12, 0, 0, 0);
const now = referenceDate.getTime();

createRoot(document.getElementById('root')!).render(
  <AFConfigContext.Provider
    value={{ isAuthenticated: false, openLoginModal: () => undefined, updateCurrentUser: async () => undefined }}
  >
    <DatabaseContext.Provider value={context}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 320px)', gap: 16, padding: 24 }}>
        {kinds.flatMap((kind) =>
          ['normal', 'past'].map((phase) => {
            const id = `${kind}-${phase}`;
            const week = kind.startsWith('week');
            const allDay = kind.endsWith('all-day');
            const duration =
              kind === 'week-short' ? 15 * 60 * 1000 : kind === 'month-range' ? 2 * 86_400_000 : 60 * 60 * 1000;
            const end = new Date(now + (phase === 'past' ? -3 : 3) * 86_400_000);
            const start = new Date(end.getTime() - duration);
            const rowId = crypto.randomUUID();
            const rowDoc = new Y.Doc() as YDoc;

            rowDoc
              .getMap('data')
              .set('meta', new Y.Map(Object.entries(generateRowMeta(rowId, { [RowMetaKey.IsDocumentEmpty]: false }))));
            context.rowMap[rowId] = rowDoc;
            const event = calendar.addEvent({
              id,
              title: id,
              start,
              end,
              allDay,
              extendedProps: {
                rowId,
                isRange: true,
                completionTime: calendarEventCompletionTime({ start, end, allDay }),
              },
            });

            return (
              <section
                key={id}
                className={
                  kind.startsWith('popover') ? undefined : `database-calendar ${week ? 'week-view' : 'month-view'}`
                }
              >
                <div className='fc-timegrid-col-events'>
                  <div
                    data-testid={id}
                    className={`fc-event ${week && !allDay ? 'fc-timegrid-event' : 'fc-daygrid-event'} ${
                      kind.startsWith('popover') ? 'fc-popover-event' : ''
                    }`}
                    style={{ width: 300, height: week && !allDay ? 80 : 24 }}
                  >
                    <div className='fc-event-main' style={{ height: '100%' }}>
                      <EventDisplay
                        event={event}
                        eventInfo={{ isStart: true, isEnd: true } as EventContentArg}
                        isWeekView={week}
                      />
                    </div>
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>
    </DatabaseContext.Provider>
  </AFConfigContext.Provider>
);
