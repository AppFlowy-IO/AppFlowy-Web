import { useCallback, useMemo } from 'react';

import { CellProps, RelationCell as RelationCellType } from '@/application/database-yjs/cell.type';
import RelationCellMenu from '@/components/database/components/cell/relation/RelationCellMenu';
import RelationItems from '@/components/database/components/cell/relation/RelationItems';

export function RelationCell({
  cell,
  fieldId,
  style,
  placeholder,
  editing,
  setEditing,
  rowId,
  wrap,
}: CellProps<RelationCellType>) {
  const handleOpenChange = useCallback(
    (status: boolean) => {
      setEditing?.(status);
    },
    [setEditing]
  );

  const children = useMemo(() => {
    if (!cell?.data)
      return placeholder ? (
        <div style={style} className={'text-text-tertiary'}>
          {placeholder}
        </div>
      ) : null;

    return <RelationItems cell={cell} fieldId={fieldId} style={style} wrap={wrap} />;
  }, [cell, wrap, fieldId, placeholder, style]);

  return (
    <div className="relative w-full">
      {children}
      {editing ? (
        <RelationCellMenu
          cell={cell}
          fieldId={fieldId}
          rowId={rowId}
          open={editing}
          onOpenChange={handleOpenChange}
        />
      ) : null}
    </div>
  );
}
