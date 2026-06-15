import { useMemo } from 'react';

import { Filter } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
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
}: {
  filter: Filter;
  conditions: {
    value: number;
    text: string;
  }[];
  onSelect?: (condition: number) => void;
}) {
  const updateFilter = useUpdateFilter();
  const selectedCondition = useMemo(() => {
    return conditions.find((c) => c.value === filter.condition);
  }, [filter.condition, conditions]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        className={'w-full'}
      >
        <Button
          variant={'ghost'}
          size={'sm'}
          className={'min-w-fit w-fit'}
          data-testid="filter-condition-trigger"
        >
          {selectedCondition?.text ?? ''}
          <ArrowDownSvg className={'w-5 h-5'} />
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