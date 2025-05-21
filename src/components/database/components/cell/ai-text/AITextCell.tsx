import { useFieldWrap } from '@/application/database-yjs';
import { AICell, CellProps } from '@/application/database-yjs/cell.type';
import AITextCellActions from '@/components/database/components/cell/ai-text/AITextCellActions';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

export function AITextCell ({
  cell,
  style,
  readOnly,
  rowId,
  fieldId,
}: CellProps<AICell>) {
  const ref = useRef<HTMLDivElement>(null);
  const [isHovered, setHovered] = useState(false);
  const wrap = useFieldWrap(fieldId);

  useEffect(() => {
    const cellEl = ref.current;

    if (!cellEl) return;

    const gridRowCell = cellEl.closest('.grid-row-cell');

    if (!gridRowCell) return;

    const handleMouseEnter = () => {
      setHovered(true);
    };

    const handleMouseLeave = () => {
      setHovered(false);
    };

    gridRowCell.addEventListener('mouseenter', handleMouseEnter);

    gridRowCell.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      gridRowCell.removeEventListener('mouseenter', handleMouseEnter);
      gridRowCell.removeEventListener('mouseleave', handleMouseLeave);
    };

  }, []);

  return <div
    style={style}
    ref={ref}
    className={cn(wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-nowrap', 'select-text')}
  >
    {cell?.data || ''}
    {!readOnly && isHovered && (
      <AITextCellActions
        cell={cell}
        rowId={rowId}
        fieldId={fieldId}
      />
    )}
  </div>;
}