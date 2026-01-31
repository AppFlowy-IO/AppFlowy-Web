import { useCallback, useMemo } from 'react';

import { CellProps, PersonCell as PersonCellType } from '@/application/database-yjs/cell.type';
import { MentionablePerson } from '@/application/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import PersonCellMenu from './PersonCellMenu';
import { useMentionableUsersWithAutoFetch } from './useMentionableUsers';

export function PersonCell({
  cell,
  style,
  placeholder,
  fieldId,
  rowId,
  wrap,
  editing,
  setEditing,
}: CellProps<PersonCellType>) {
  const selectedUserIds = useMemo(() => {
    if (!cell?.data) return [];
    try {
      return JSON.parse(cell.data) as string[];
    } catch {
      return [];
    }
  }, [cell?.data]);

  // Use cached mentionable users - fetch when there are selected users to display
  const shouldFetch = selectedUserIds.length > 0;
  const { users: mentionableUsers } = useMentionableUsersWithAutoFetch(shouldFetch);

  const selectedUsers = useMemo(() => {
    return selectedUserIds
      .map((id) => mentionableUsers.find((u) => u.person_id === id))
      .filter(Boolean) as MentionablePerson[];
  }, [selectedUserIds, mentionableUsers]);

  const isEmpty = selectedUsers.length === 0;

  const handleOpenChange = useCallback(
    (status: boolean) => {
      setEditing?.(status);
    },
    [setEditing]
  );

  const renderedUsers = useMemo(() => {
    return selectedUsers.map((user) => {
      const displayName = user.name || user.email || '?';

      return (
        <div key={user.person_id} className="min-w-fit max-w-[120px]">
          <div className="flex items-center gap-1">
            <Avatar className="h-5 w-5">
              <AvatarImage src={user.avatar_url || undefined} alt={displayName} />
              <AvatarFallback className="text-xs">{displayName}</AvatarFallback>
            </Avatar>
            <span className="truncate text-sm">{displayName}</span>
          </div>
        </div>
      );
    });
  }, [selectedUsers]);

  return (
    <div
      style={style}
      data-testid={`person-cell-${rowId}-${fieldId}`}
      className={cn(
        'select-option-cell flex w-full items-center gap-1',
        isEmpty && placeholder ? 'text-text-tertiary' : '',
        wrap
          ? 'flex-wrap overflow-x-hidden'
          : 'appflowy-hidden-scroller h-full w-full flex-nowrap overflow-x-auto overflow-y-hidden'
      )}
    >
      {isEmpty ? placeholder || null : renderedUsers}
      {editing ? (
        <PersonCellMenu
          fieldId={fieldId}
          rowId={rowId}
          open={editing}
          onOpenChange={handleOpenChange}
          selectedUserIds={selectedUserIds}
        />
      ) : null}
    </div>
  );
}
