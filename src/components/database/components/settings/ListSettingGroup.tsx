import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useSetAllListGroupsVisibilityDispatch,
  useSetListGroupVisibilityDispatch,
  useToggleListHideEmptyGroups,
  useUpdateDateGroupConditionDispatch,
} from '@/application/database-yjs';
import { useUpdateNumberGroupConfigurationDispatch } from '@/application/database-yjs/dispatch';
import { DatabaseSettingGroup } from '@/components/database/components/settings/GridSettingGroup';
import { useListGrouping } from '@/components/database/list/ListGroupingContext';

function ListSettingGroup() {
  const grouping = useListGrouping();
  const groupBy = useGroupByFieldDispatch();
  const clearGrouping = useClearGroupByFieldDispatch();
  const toggleHideEmpty = useToggleListHideEmptyGroups();
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
      testIdPrefix='list'
      toggleHideEmpty={toggleHideEmpty}
      updateDateCondition={updateDateCondition}
      updateNumberConfiguration={updateNumberConfiguration}
    />
  );
}

export default ListSettingGroup;
