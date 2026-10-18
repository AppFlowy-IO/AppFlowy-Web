import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useSetListGroupVisibilityDispatch,
  useToggleTimelineHideEmptyGroups,
  useUpdateDateGroupConditionDispatch,
} from '@/application/database-yjs';
import { useUpdateNumberGroupConfigurationDispatch } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import {
  DatabaseSettingGroup,
  useDatabaseSettingGrouping,
  useGroupableProperties,
} from '@/components/database/components/settings/GridSettingGroup';
import { useTimelineGrouping } from '@/components/database/timeline/TimelineGroupingContext';

/** The shared group menu (field, hide empty, per-group visibility) bound to the timeline. */
function TimelineSettingGroup() {
  const grouping = useTimelineGrouping();
  const groupBy = useGroupByFieldDispatch();
  const clearGrouping = useClearGroupByFieldDispatch();
  const toggleHideEmpty = useToggleTimelineHideEmptyGroups();
  const setVisibility = useSetListGroupVisibilityDispatch(grouping.groupId, grouping.fieldId);
  const updateDateCondition = useUpdateDateGroupConditionDispatch();
  const updateNumberConfiguration = useUpdateNumberGroupConfigurationDispatch();
  const properties = useGroupableProperties();
  const settingGrouping = useDatabaseSettingGrouping(grouping);

  return (
    <DatabaseSettingGroup
      clearGrouping={clearGrouping}
      groupBy={groupBy}
      grouping={settingGrouping}
      layout={DatabaseViewLayout.Timeline}
      properties={properties}
      setVisibility={setVisibility}
      testIdPrefix='timeline'
      toggleHideEmpty={toggleHideEmpty}
      updateDateCondition={updateDateCondition}
      updateNumberConfiguration={updateNumberConfiguration}
    />
  );
}

export default TimelineSettingGroup;
