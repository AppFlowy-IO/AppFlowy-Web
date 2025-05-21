import { CellProps, RelationCell as RelationCellType } from '@/application/database-yjs/cell.type';
import RelationCellMenu from '@/components/database/components/cell/relation/RelationCellMenu';
import RelationItems from '@/components/database/components/cell/relation/RelationItems';
import React, { useMemo } from 'react';

export function RelationCell ({
  cell,
  fieldId,
  style,
  placeholder,
  editing,
  setEditing,
  rowId,
}: CellProps<RelationCellType>) {

  const children = useMemo(() => {
    if (!cell?.data)
      return placeholder ? (
        <div
          style={style}
          className={'text-text-placeholder'}
        >
          {placeholder}
        </div>
      ) : null;

    return <RelationItems
      cell={cell}
      fieldId={fieldId}
      style={style}
    />;
  }, [cell, fieldId, placeholder, style]);

  return <>
    {children}
    {editing && <RelationCellMenu
      open={editing}
      onOpenChange={setEditing}
      cell={cell}
      fieldId={fieldId}
      rowId={rowId}
    />}
  </>;
}
