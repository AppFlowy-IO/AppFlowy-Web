import { YjsDatabaseKey } from '@/application/types';
import { useRowTimeString } from '@/application/database-yjs';
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

  if (!time) return null;
  return (
    <div
      style={style}
      className={'flex w-full'}
    >
      {time}
    </div>
  );
}

export default RowCreateModifiedTime;
