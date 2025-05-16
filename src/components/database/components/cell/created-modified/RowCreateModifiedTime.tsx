import { YjsDatabaseKey } from '@/application/types';
import { useFieldWrap, useRowTimeString } from '@/application/database-yjs';
import { cn } from '@/lib/utils';
import React from 'react';

export function RowCreateModifiedTime ({
  rowId,
  fieldId,
  attrName,
  style,
}: {
  rowId: string;
  fieldId: string;
  style?: React.CSSProperties;
  attrName: YjsDatabaseKey.last_modified | YjsDatabaseKey.created_at;
}) {
  const time = useRowTimeString(rowId, fieldId, attrName);
  const wrap = useFieldWrap(fieldId);

  if (!time) return null;
  return (
    <div
      style={style}
      className={cn('flex w-full select-text', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-nowrap')}
    >
      {time}
    </div>
  );
}

export default RowCreateModifiedTime;
