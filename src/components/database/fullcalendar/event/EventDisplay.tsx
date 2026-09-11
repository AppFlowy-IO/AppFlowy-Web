import { EventApi, EventContentArg } from '@fullcalendar/core';
import { useMemo } from 'react';

import { useFieldsSelector, isAIFieldType } from '@/application/database-yjs';
import { useAIEnabled } from '@/components/app/app.hooks';

import {
  MonthAllDayEvent,
  MonthMultiDayTimedEvent,
  MonthTimedEvent,
  WeekAllDayEvent,
  WeekTimedEvent,
} from './components';

interface EventDisplayProps {
  event: EventApi;
  eventInfo: EventContentArg;
  onClick?: (event: EventApi) => void;
  isWeekView?: boolean;
  showLeftIndicator?: boolean;
  className?: string;
}

export function EventDisplay({
  event,
  eventInfo,
  onClick,
  isWeekView = false,
  showLeftIndicator = true,
  className,
}: EventDisplayProps) {
  const rowId = event.extendedProps?.rowId;
  const fields = useFieldsSelector();
  const aiEnabled = useAIEnabled();
  
  const showFields = useMemo(() => {
    return fields.filter(
      (field) => !field.isPrimary && (aiEnabled || !isAIFieldType(field.fieldType))
    );
  }, [fields, aiEnabled]);

  if (!rowId) return null;

  const isMultiDay = event.start && event.end && event.start.toDateString() !== event.end.toDateString();

  const getEventComponent = () => {
    if (isWeekView) {
      return event.allDay ? WeekAllDayEvent : WeekTimedEvent;
    } else {
      if (event.allDay) {
        return MonthAllDayEvent;
      } else {
        return isMultiDay ? MonthMultiDayTimedEvent : MonthTimedEvent;
      }
    }
  };

  const EventComponent = getEventComponent();

  return (
    <div>
      <EventComponent
        event={event}
        eventInfo={eventInfo}
        onClick={onClick}
        showLeftIndicator={showLeftIndicator}
        className={className}
        rowId={rowId}
        showFields={showFields}
      />
    </div>
  );
}

// Export alias for backward compatibility
export { EventDisplay as EventContent };
