import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useListGroupingSelector,
  useSetAllListGroupsVisibilityDispatch,
  useSetListGroupVisibilityDispatch,
  useToggleListHideEmptyGroups,
  useUpdateDateGroupConditionDispatch,
} from '@/application/database-yjs';
import { DatabaseSettingGroup } from '@/components/database/components/settings/GridSettingGroup';

function ListSettingGroup() {
  const grouping = useListGroupingSelector();
  const groupBy = useGroupByFieldDispatch();
  const clearGrouping = useClearGroupByFieldDispatch();
  const toggleHideEmpty = useToggleListHideEmptyGroups();
  const setVisibility = useSetListGroupVisibilityDispatch(grouping.groupId, grouping.fieldId);
  const setAllVisibility = useSetAllListGroupsVisibilityDispatch(grouping.groupId, grouping.fieldId);
  const updateDateCondition = useUpdateDateGroupConditionDispatch();

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
    />
  );
}

export default ListSettingGroup;
