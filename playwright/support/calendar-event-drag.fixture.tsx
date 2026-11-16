import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';

import '@/styles/global.css';
import '@/components/database/fullcalendar/FullCalendar.styles.scss';

const root = document.getElementById('root')!;

// Two week rows fit in this dashboard widget; Sunday is in the clipped third row.
root.innerHTML = `
  <div data-testid="calendar-scrollport" class="database-calendar month-view"
    style="width:480px;height:240px;overflow:auto;--calendar-day-min-height:120px">
    <div id="calendar"></div>
  </div>
  <div style="height:240px">Another dashboard widget</div>
  <output data-testid="dropped-date">Not moved</output>
`;

const calendar = new Calendar(document.getElementById('calendar')!, {
  plugins: [dayGridPlugin, interactionPlugin],
  initialView: 'dayGridMonth',
  initialDate: '2026-11-14',
  firstDay: 0,
  headerToolbar: false,
  dayHeaders: false,
  height: 'auto',
  editable: true,
  eventDisplay: 'block',
  events: [{ id: 'post', title: 'Customer story: Hooli', start: '2026-11-14T12:00:00' }],
  eventDrop: ({ event }) => {
    document.querySelector('[data-testid="dropped-date"]')!.textContent = event.startStr.slice(0, 10);
  },
});

calendar.render();
