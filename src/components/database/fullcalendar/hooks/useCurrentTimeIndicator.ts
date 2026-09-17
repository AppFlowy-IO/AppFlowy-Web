import { useEffect } from 'react';

import { useCalendarLayoutSetting } from '@/application/database-yjs';

import { CalendarViewType, isTimeGridView } from '../types';

import type { CalendarApi } from '@fullcalendar/core';

/** Add a time label and line within the calendar that owns this hook. */
export function useCurrentTimeIndicator(
  calendarApi: CalendarApi | null,
  currentView: CalendarViewType,
  calendarElement: HTMLElement | null
) {
  const use24Hour = !!useCalendarLayoutSetting()?.use24Hour;

  useEffect(() => {
    if (!calendarApi || !calendarElement || !isTimeGridView(currentView)) return;

    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let label: HTMLSpanElement | undefined;
    let line: HTMLDivElement | undefined;
    const hiddenSlots = new Set<HTMLElement>();

    const cancelRetry = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    };

    const resetIndicator = () => {
      label?.remove();
      label = undefined;
      line?.remove();
      line = undefined;
      hiddenSlots.forEach((slot) => slot.classList.remove('hidden-text'));
      hiddenSlots.clear();
    };

    const updateIndicator = (attempt = 0) => {
      cancelRetry();
      if (disposed) return;
      const now = new Date();
      const { activeStart, activeEnd } = calendarApi.view;

      if (now < activeStart || now >= activeEnd) {
        resetIndicator();
        return;
      }

      const grid = calendarElement.matches('.fc') ? calendarElement : calendarElement.querySelector<HTMLElement>('.fc');
      const arrow = grid?.querySelector<HTMLElement>('.fc-timegrid-now-indicator-arrow');
      const nativeLine = grid?.querySelector<HTMLElement>('.fc-timegrid-now-indicator-line');

      if (!grid || !arrow || !nativeLine) {
        if (attempt < 3) retryTimer = setTimeout(() => updateIndicator(attempt + 1), 100);
        return;
      }

      if (!label || label.parentElement !== arrow) {
        label?.remove();
        label = document.createElement('span');
        arrow.appendChild(label);
      }

      const [time, period] = now
        .toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: !use24Hour,
        })
        .split(' ');
      const timeLabel = document.createElement('span');

      timeLabel.className = period ? 'font-medium mr-0.5' : 'font-medium';
      timeLabel.textContent = time;
      label.replaceChildren(timeLabel);
      if (period) {
        const periodLabel = document.createElement('span');

        periodLabel.className = 'font-normal';
        periodLabel.textContent = period;
        label.appendChild(periodLabel);
      }

      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      for (let hour = 0; hour < 24; hour++) {
        const slot = grid.querySelector<HTMLElement>(`[data-time="${String(hour).padStart(2, '0')}:00:00"]`);

        if (!slot) continue;
        const hide =
          (currentMinute >= 46 && hour === (currentHour + 1) % 24) || (currentMinute <= 16 && hour === currentHour);

        if (hide && !slot.classList.contains('hidden-text')) {
          slot.classList.add('hidden-text');
          hiddenSlots.add(slot);
        } else if (!hide && hiddenSlots.delete(slot)) {
          slot.classList.remove('hidden-text');
        }
      }

      const lineRect = nativeLine.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const arrowRect = arrow.getBoundingClientRect();

      if (!line) {
        line = document.createElement('div');
        line.className = 'custom-now-indicator-line';
      }

      const left = arrowRect.right - gridRect.left;

      line.style.top = `${lineRect.top - gridRect.top + 0.5}px`;
      line.style.left = `${left}px`;
      line.style.width = `${gridRect.width - left}px`;
      if (line.parentElement !== grid) grid.appendChild(line);
    };

    const refresh = () => updateIndicator();

    refresh();
    const interval = setInterval(refresh, 15000);

    calendarApi.on('datesSet', refresh);
    return () => {
      disposed = true;
      cancelRetry();
      clearInterval(interval);
      calendarApi.off('datesSet', refresh);
      resetIndicator();
    };
  }, [calendarApi, calendarElement, currentView, use24Hour]);
}
