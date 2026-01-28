import { useEffect } from 'react';

import { useDatabaseContext, useGroupsSelector } from '@/application/database-yjs';
import { Group } from '@/components/database/components/board';

import { BoardProvider } from './BoardProvider';

export function Board() {
  const groups = useGroupsSelector();
  const { onRendered } = useDatabaseContext();

  useEffect(() => {
    if (groups) {
      onRendered?.();
    }
  }, [groups, onRendered]);

  const group = groups[0];

  if (!group) return null;
  return (
    <BoardProvider>
      <div className={'database-board flex w-full flex-1 flex-col'}>
        <Group groupId={group} key={group} />
      </div>
    </BoardProvider>
  );
}

export default Board;
