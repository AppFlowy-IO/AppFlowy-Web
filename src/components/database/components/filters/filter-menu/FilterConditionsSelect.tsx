import { useMemo } from 'react';

import { useReadOnly } from '@/application/database-yjs/context';
import { Filter } from '@/application/database-yjs/database.type';
import { useUpdateFilter } from '@/application/database-yjs/dispatch/sort-filter';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function FilterConditionsSelect ({
  conditions,
  filter,
  onSelect,
  disabled,
}: {
  filter: Filter;
  conditions: {
    value: number;
    text: string;
  }[];
  onSelect?: (condition: number) => void;
  disabled?: boolean;
}) {
  const updateFilter = useUpdateFilter();
  const readOnly = useReadOnly();
  const selectedCondition = useMemo(() => {
    return conditions.find((c) => c.value === filter.condition);
  }, [filter.condition, conditions]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        disabled={readOnly || disabled}
        className={'w-full'}
      >
        <Button
          variant={'ghost'}
          size={'sm'}
          className={'h-7 w-fit min-w-fit px-2 text-xs font-medium text-text-primary'}
          data-testid="filter-condition-trigger"
        >
          {selectedCondition?.text ?? ''}
          <ArrowDownSvg className={'h-5 w-5 text-icon-secondary'} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={'min-w-fit'}>
        <DropdownMenuGroup>
          {conditions.map((condition) => (
            <DropdownMenuItem
              key={condition.value}
              data-testid={`filter-condition-${condition.value}`}
              onSelect={() => {
                if (onSelect) {
                  onSelect(condition.value);
                  return;
                } else {
                  updateFilter({
                    filterId: filter.id,
                    fieldId: filter.fieldId,
                    condition: condition.value,
                  });
                }
              }}
            >
              {condition.text}
              {condition.value === filter.condition && (<DropdownMenuItemTick />)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default FilterConditionsSelect;
