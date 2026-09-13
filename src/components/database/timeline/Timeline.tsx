import { FieldType, useFieldSelector, useTimelineLayoutSetting } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';

import { TimelineUnsupported } from './TimelineUnsupported';
import { ListSortSubscription } from '@/components/database/list/ListSortState';

import { TimelineView } from './TimelineView';

const DATE_FIELD_TYPES = [FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime];

export function Timeline() {
  const setting = useTimelineLayoutSetting();
  const { field } = useFieldSelector(setting.fieldId);
  const fieldType = field ? (Number(field.get(YjsDatabaseKey.type)) as FieldType) : null;

  if (!setting.fieldId || fieldType === null || !DATE_FIELD_TYPES.includes(fieldType)) {
    return <TimelineUnsupported />;
  }

  // One sort subscription for every row's insert / reorder confirmation.
  return (
    <ListSortSubscription>
      <TimelineView setting={setting} />
    </ListSortSubscription>
  );
}

export default Timeline;
