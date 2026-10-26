import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useSetListGroupVisibilityDispatch,
  useToggleDatabaseHideEmptyGroups,
  useUpdateDateGroupConditionDispatch,
  useUpdateNumberGroupConfigurationDispatch,
} from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { useGalleryView } from '@/components/database/gallery/GalleryViewContext';

import { DatabaseSettingGroup, useDatabaseSettingGrouping, useGroupableProperties } from './GridSettingGroup';

export default function GallerySettingGroup() {
  const { grouping } = useGalleryView();
  const groupBy = useGroupByFieldDispatch();
  const clearGrouping = useClearGroupByFieldDispatch();
  const toggleHideEmpty = useToggleDatabaseHideEmptyGroups(DatabaseViewLayout.Gallery);
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
      layout={DatabaseViewLayout.Gallery}
      properties={properties}
      setVisibility={setVisibility}
      testIdPrefix='gallery'
      toggleHideEmpty={toggleHideEmpty}
      updateDateCondition={updateDateCondition}
      updateNumberConfiguration={updateNumberConfiguration}
    />
  );
}
