import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SortCondition } from '@/application/database-yjs';
import { useUpdateSort } from '@/application/database-yjs/dispatch';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItemTick,
} from '@/components/ui/dropdown-menu';

function ConditionMenu({
  open,
  onOpenChange,
  selected,
  sortId,
  onSelect,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  selected: SortCondition;
  sortId: string;
  onSelect?: (condition: SortCondition) => void;
}) {
  const { t } = useTranslation();
  const updateSort = useUpdateSort();
  const conditions = useMemo(() => {
    return [
      {
        id: SortCondition.Ascending,
        name: t('grid.sort.ascending'),
      },
      {
        id: SortCondition.Descending,
        name: t('grid.sort.descending'),
      },
    ];
  }, [t]);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <div className={'absolute left-0 top-0 z-[-1] h-full w-full'} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={'w-fit min-w-fit p-2'}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <DropdownMenuGroup>
          {conditions.map((condition) => (
            <DropdownMenuItem
              key={condition.id}
              className={selected === condition.id ? 'bg-accent' : ''}
              onSelect={() => {
                if (onSelect) onSelect(condition.id);
                else
                  updateSort({
                    sortId,
                    condition: condition.id,
                  });
              }}
            >
              {condition.name}
              {selected === condition.id && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ConditionMenu;
