import { useEffect } from 'react';

import { normalizeAttributionUid } from '@/application/database-yjs/attribution';
import { CellProps, Cell as CellType } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { useFieldType, useRowDataSelector } from '@/application/database-yjs/selector';
import { YjsDatabaseKey } from '@/application/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import { useMentionableUsersWithAutoFetch } from '../person/useMentionableUsers';

export function AttributionCell({ fieldId, onTextChange, rowId, style, wrap }: CellProps<CellType>) {
  const fieldType = useFieldType(fieldId);
  const { row } = useRowDataSelector(rowId);
  const attribute = fieldType === FieldType.CreatedBy ? YjsDatabaseKey.created_by : YjsDatabaseKey.last_edited_by;
  const uid = normalizeAttributionUid(row?.get(attribute));
  const { usersByUid } = useMentionableUsersWithAutoFetch(uid !== null, uid);
  const user = uid === null ? undefined : usersByUid.get(uid);
  const displayName = user?.name || user?.email || (uid === null ? '' : `User ${uid}`);

  useEffect(() => {
    onTextChange?.(displayName);
  }, [displayName, onTextChange]);

  if (uid === null) return null;

  return (
    <div
      className={cn(
        'flex w-full items-center gap-1 select-text',
        wrap ? 'flex-wrap overflow-x-hidden' : 'h-full flex-nowrap overflow-hidden'
      )}
      data-testid={`attribution-cell-${rowId}-${fieldId}`}
      style={style}
    >
      <Avatar className='h-5 w-5 shrink-0'>
        <AvatarImage src={user?.avatar_url || undefined} alt={displayName} />
        <AvatarFallback className='text-xs'>{displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className='truncate text-sm'>{displayName}</span>
    </div>
  );
}
