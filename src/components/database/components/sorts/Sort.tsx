
import { useReadOnly, useSortSelector } from '@/application/database-yjs';
import { useRemoveSort } from '@/application/database-yjs/dispatch';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import SortCondition from '@/components/database/components/sorts/SortCondition';
import { Button } from '@/components/ui/button';

import { FieldDisplay } from 'src/components/database/components/field';

function Sort ({ sortId }: { sortId: string }) {
  const sort = useSortSelector(sortId);

  const readOnly = useReadOnly();
  const deleteSort = useRemoveSort();

  if (!sort) return null;
  return (
    <div
      data-testid={'sort-condition'}
      className={'flex items-center gap-1.5'}
    >
      <Button
        variant={'outline'}
        size={'sm'}
        aria-readonly={'true'}
        className={'w-[140px] justify-start flex-1 rounded-full overflow-hidden'}
      >
        <FieldDisplay
          className={'truncate'}
          fieldId={sort.fieldId}
        />
      </Button>
      <SortCondition sort={sort} />
      {readOnly ? null : <Button
        data-testid="delete-sort-button"
        size={'icon-sm'}
        onClick={(e) => {
          e.stopPropagation();
          deleteSort(sort.id);
        }}
        variant={'ghost'}
        danger
      >
        <DeleteIcon className={'w-5 h-5'} />
      </Button>}

    </div>
  );
}

export default Sort;
