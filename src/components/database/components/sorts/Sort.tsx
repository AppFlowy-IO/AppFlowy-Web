import {
  Sort as SortValue,
  SortCondition as SortDirection,
  useReadOnly,
  useSortSelector,
} from '@/application/database-yjs';
import { useRemoveSort } from '@/application/database-yjs/dispatch';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import SortCondition from '@/components/database/components/sorts/SortCondition';
import { Button } from '@/components/ui/button';

import { FieldDisplay } from 'src/components/database/components/field';

function Sort({ sortId }: { sortId: string }) {
  const sort = useSortSelector(sortId);

  const readOnly = useReadOnly();
  const deleteSort = useRemoveSort();

  if (!sort) return null;
  return <SortRow sort={sort} readOnly={readOnly} onDelete={() => deleteSort(sortId)} />;
}

export function SortRow({
  sort,
  readOnly,
  onDelete,
  onConditionChange,
}: {
  sort: SortValue;
  readOnly: boolean;
  onDelete: () => void;
  onConditionChange?: (condition: SortDirection) => void;
}) {
  return (
    <div data-testid={'sort-condition'} className={'flex items-center gap-1.5'}>
      <Button
        variant={'outline'}
        size={'sm'}
        aria-readonly={'true'}
        className={'w-[140px] flex-1 justify-start overflow-hidden rounded-full'}
      >
        <FieldDisplay className={'truncate'} fieldId={sort.fieldId} />
      </Button>
      <SortCondition sort={sort} onChange={onConditionChange} disabled={readOnly} />
      {readOnly ? null : (
        <Button
          size={'icon-sm'}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          variant={'ghost'}
          danger
        >
          <DeleteIcon className={'h-5 w-5'} />
        </Button>
      )}
    </div>
  );
}

export default Sort;
