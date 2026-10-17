import { useCallback, useMemo } from 'react';

import { FieldType, usePropertiesSelector } from '@/application/database-yjs';
import { useBoardGroupingSummary } from '@/application/database-yjs/board-grouping';
import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useSetBoardColumnRenderedDispatch,
  useToggleHideEmptyGroups,
} from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import { DatabaseSettingGroup } from '@/components/database/components/settings/GridSettingGroup';

// Desktop lets a Board group by every groupable type, but the web Board only
// renders select and checkbox columns, so the picker stays limited to them.
const BOARD_GROUPABLE_FIELD_TYPES: readonly FieldType[] = [
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
];

// Board BDD steps locate every field row through this one constant id.
const BOARD_GROUP_BY_FIELD_TEST_ID = 'board-group-by-field';

function getBoardGroupByFieldTestId() {
  return BOARD_GROUP_BY_FIELD_TEST_ID;
}

function BoardSettingGroup() {
  const { fieldId, fieldName, fieldType, getRows, groupId, groupRowsReady, groups, hideEmptyGroups } =
    useBoardGroupingSummary();
  const groupBy = useGroupByFieldDispatch();
  // Board views always stay grouped: the shared menu hides None and Delete
  // grouping for this layout, but its contract still takes the dispatch.
  const clearGrouping = useClearGroupByFieldDispatch();
  const toggleHideEmptyGroups = useToggleHideEmptyGroups();
  const setColumnRendered = useSetBoardColumnRenderedDispatch(groupId ?? '', fieldId ?? '');
  const setVisibility = useCallback(
    (columnId: string, visible: boolean) => {
      // Desktop pairs updateBoardGroupRenderOverride(rendered, isEmpty) with
      // updateGroup(visible); the render dispatch writes both in one operation
      // and mirrors hide_ungrouped_column when the default column is hidden.
      const automaticallyHidden = groupRowsReady && hideEmptyGroups && getRows(columnId).length === 0;

      setColumnRendered(columnId, visible, automaticallyHidden);
    },
    [getRows, groupRowsReady, hideEmptyGroups, setColumnRendered]
  );
  const { properties: allProperties } = usePropertiesSelector(true);
  const properties = useMemo(
    () => allProperties.filter((property) => BOARD_GROUPABLE_FIELD_TYPES.includes(property.type)),
    [allProperties]
  );
  const grouping = useMemo(
    () => ({
      fieldId: fieldId ?? undefined,
      fieldName,
      fieldType,
      groups,
      hideEmptyGroups,
      isGrouped: Boolean(fieldId),
    }),
    [fieldId, fieldName, fieldType, groups, hideEmptyGroups]
  );

  return (
    <DatabaseSettingGroup
      clearGrouping={clearGrouping}
      groupBy={groupBy}
      groupByFieldTestId={getBoardGroupByFieldTestId}
      grouping={grouping}
      layout={DatabaseViewLayout.Board}
      properties={properties}
      setVisibility={setVisibility}
      testIdPrefix='board'
      toggleHideEmpty={toggleHideEmptyGroups}
    />
  );
}

export default BoardSettingGroup;
