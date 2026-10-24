import { useEffect } from 'react';

import { useDatabase, useDatabaseContext, useDatabaseView, useGroupsSelector, useReadOnly } from '@/application/database-yjs';
import { boardNeedsGroupingField, resolveDefaultBoardGroup } from '@/application/database-yjs/board-default-group';
import { useCreateBoardGroupingFieldDispatch, useGroupByFieldDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { BoardNoGroup, Group } from '@/components/database/components/board';

import { BoardProvider } from './BoardProvider';

export function Board() {
  const groups = useGroupsSelector();
  const { onRendered } = useDatabaseContext();
  const database = useDatabase();
  const view = useDatabaseView();
  const readOnly = useReadOnly();
  const groupByField = useGroupByFieldDispatch({ preserveFilters: true });
  const createGroupingField = useCreateBoardGroupingFieldDispatch();
  const fields = database?.get(YjsDatabaseKey.fields);
  const needsGroupingField = !readOnly && boardNeedsGroupingField(view, fields);

  useEffect(() => {
    if (readOnly) return;
    const fallback = resolveDefaultBoardGroup(view, fields);

    // Editable Boards persist their lazy default through the same operation as
    // explicit grouping. Readers use the pure selector fallback without writes.
    if (fallback) {
      groupByField(fallback.fieldId);
      return;
    }

    // Nothing to group by: like Desktop, create a "Status" property for it.
    if (boardNeedsGroupingField(view, fields)) createGroupingField({ automatic: true });
  }, [createGroupingField, fields, view, groups, readOnly, groupByField]);

  useEffect(() => {
    if (groups) {
      onRendered?.();
    }
  }, [groups, onRendered]);

  const group = groups[0];

  if (!group) {
    // An editable Board gets its grouping property in the effect above.
    if (needsGroupingField) return null;

    return (
      <div className={'database-board flex h-full min-h-0 w-full flex-1 flex-col'}>
        <BoardNoGroup />
      </div>
    );
  }

  return (
    <BoardProvider>
      <div className={'database-board flex h-full min-h-0 w-full flex-1 flex-col'}>
        <Group groupId={group} key={group} />
      </div>
    </BoardProvider>
  );
}

export default Board;
