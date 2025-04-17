import { useGroupsSelector } from '@/application/database-yjs';
import { Group } from '@/components/database/components/board';
import React from 'react';

export function Board () {
  const groups = useGroupsSelector();

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
