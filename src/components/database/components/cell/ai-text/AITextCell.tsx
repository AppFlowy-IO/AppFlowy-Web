import { useRef, useState } from 'react';

import { AICell, CellProps } from '@/application/database-yjs/cell.type';
import AITextCellActions from '@/components/database/components/cell/ai-text/AITextCellActions';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export function AITextCell({ cell, style, readOnly, rowId, fieldId, isHovering, wrap }: CellProps<AICell>) {
  const ref = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div
      style={style}
      ref={ref}
      className={cn(wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap', 'cursor-text select-text')}
    >
      {cell?.data || ''}
      {loading && (
        <div className={'absolute right-1 top-1'}>
          <Progress variant={'primary'} />
        </div>
      )}
      {!readOnly && isHovering && (
        <AITextCellActions cell={cell} rowId={rowId} fieldId={fieldId} loading={loading} setLoading={setLoading} />
      )}
    </div>
  );
}
