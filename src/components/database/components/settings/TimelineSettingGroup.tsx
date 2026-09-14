import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useSetAllListGroupsVisibilityDispatch,
  useSetListGroupVisibilityDispatch,
  useToggleTimelineHideEmptyGroups,
  useUpdateDateGroupConditionDispatch,
} from '@/application/database-yjs';
import { useUpdateNumberGroupConfigurationDispatch } from '@/application/database-yjs/dispatch';
import { DatabaseSettingGroup } from '@/components/database/components/settings/GridSettingGroup';
import { useTimelineGrouping } from '@/components/database/timeline/TimelineGroupingContext';

/** The List's group menu (field, hide empty, per-group visibility) bound to the timeline. */
function TimelineSettingGroup() {
  const grouping = useTimelineGrouping();
  const groupBy = useGroupByFieldDispatch();
  const clearGrouping = useClearGroupByFieldDispatch();
  const toggleHideEmpty = useToggleTimelineHideEmptyGroups();
  const setVisibility = useSetListGroupVisibilityDispatch(grouping.groupId, grouping.fieldId);
  const setAllVisibility = useSetAllListGroupsVisibilityDispatch(grouping.groupId, grouping.fieldId);
  const updateDateCondition = useUpdateDateGroupConditionDispatch();
  const updateNumberConfiguration = useUpdateNumberGroupConfigurationDispatch();

  return (
    <DatabaseSettingGroup
      clearGrouping={clearGrouping}
      groupBy={groupBy}
      grouping={grouping}
      setAllVisibility={setAllVisibility}
      setVisibility={setVisibility}
      testIdPrefix='timeline'
      toggleHideEmpty={toggleHideEmpty}
      updateDateCondition={updateDateCondition}
      updateNumberConfiguration={updateNumberConfiguration}
    />
  );
}

export default TimelineSettingGroup;
