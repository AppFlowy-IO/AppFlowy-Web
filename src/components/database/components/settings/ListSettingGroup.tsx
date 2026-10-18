import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useSetListGroupVisibilityDispatch,
  useToggleListHideEmptyGroups,
  useUpdateDateGroupConditionDispatch,
} from '@/application/database-yjs';
import { useUpdateNumberGroupConfigurationDispatch } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import {
  DatabaseSettingGroup,
  useDatabaseSettingGrouping,
  useGroupableProperties,
} from '@/components/database/components/settings/GridSettingGroup';
import { useListGrouping } from '@/components/database/list/ListGroupingContext';

function ListSettingGroup() {
  const grouping = useListGrouping();
  const groupBy = useGroupByFieldDispatch();
  const clearGrouping = useClearGroupByFieldDispatch();
  const toggleHideEmpty = useToggleListHideEmptyGroups();
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
      layout={DatabaseViewLayout.List}
      properties={properties}
      setVisibility={setVisibility}
      testIdPrefix='list'
      toggleHideEmpty={toggleHideEmpty}
      updateDateCondition={updateDateCondition}
      updateNumberConfiguration={updateNumberConfiguration}
    />
  );
}

export default ListSettingGroup;
