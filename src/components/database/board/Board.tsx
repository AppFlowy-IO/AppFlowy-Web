import { useDatabaseContext, useGroupsSelector } from '@/application/database-yjs';
import { Group } from '@/components/database/components/board';
import React, { useEffect } from 'react';

export function Board () {
  const groups = useGroupsSelector();
  const { onRendered } = useDatabaseContext();

  useEffect(() => {
    if (groups) {
      onRendered?.();
    }
  }, [groups, onRendered]);
  return (
    <div className={'database-board flex-1 flex w-full flex-col'}>
      {groups.map((groupId) => (
        <Group
          key={groupId}
          groupId={groupId}
        />
      ))}
    </div>
  );
}

export default Board;
