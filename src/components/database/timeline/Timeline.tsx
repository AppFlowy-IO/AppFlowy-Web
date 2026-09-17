import { FieldType, useFieldSelector, useTimelineLayoutSetting, useRowOrdersSelector } from '@/application/database-yjs';
import { TimelineRowValuesProvider } from '@/application/database-yjs/hooks/TimelineRowValuesProvider';
import { YjsDatabaseKey } from '@/application/types';
import { ListSortSubscription } from '@/components/database/list/ListSortState';

import { TimelineUnsupported } from './TimelineUnsupported';
import { TimelineView } from './TimelineView';

const DATE_FIELD_TYPES = [FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime];

export function Timeline() {
  const setting = useTimelineLayoutSetting();
  const rowOrders = useRowOrdersSelector();
  const { field } = useFieldSelector(setting.fieldId);
  const fieldType = field ? (Number(field.get(YjsDatabaseKey.type)) as FieldType) : null;

  if (!setting.fieldId || fieldType === null || !DATE_FIELD_TYPES.includes(fieldType)) {
    return <TimelineUnsupported />;
  }

  // One sort subscription for every row's insert / reorder confirmation.
  return (
    <ListSortSubscription>
      <TimelineRowValuesProvider rowOrders={rowOrders}>
        <TimelineView setting={setting} />
      </TimelineRowValuesProvider>
    </ListSortSubscription>
  );
}

export default Timeline;
