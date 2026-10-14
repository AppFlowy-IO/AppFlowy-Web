import { useEffect } from 'react';

import { useDatabase, useDatabaseContext, useDatabaseView, useGroupsSelector, useReadOnly } from '@/application/database-yjs';
import { resolveDefaultBoardGroup } from '@/application/database-yjs/board-default-group';
import { useGroupByFieldDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { Group } from '@/components/database/components/board';

import { BoardProvider } from './BoardProvider';

export function Board() {
  const groups = useGroupsSelector();
  const { onRendered } = useDatabaseContext();
  const database = useDatabase();
  const view = useDatabaseView();
  const readOnly = useReadOnly();
  const groupByField = useGroupByFieldDispatch({ preserveFilters: true });

  useEffect(() => {
    if (readOnly) return;
    const fallback = resolveDefaultBoardGroup(view, database?.get(YjsDatabaseKey.fields));

    // Editable Boards persist their lazy default through the same operation as
    // explicit grouping. Readers use the pure selector fallback without writes.
    if (fallback) groupByField(fallback.fieldId);
  }, [database, view, groups, readOnly, groupByField]);

  useEffect(() => {
    if (groups) {
      onRendered?.();
    }
  }, [groups, onRendered]);

  const group = groups[0];

  if (!group) {
    return null;
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
