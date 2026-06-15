import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SortCondition } from '@/application/database-yjs';
import { useUpdateSort } from '@/application/database-yjs/dispatch';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuTrigger,
  DropdownMenuContent, DropdownMenuItemTick,
} from '@/components/ui/dropdown-menu';

function ConditionMenu ({
  open,
  onOpenChange,
  selected,
  sortId,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  selected: SortCondition;
  sortId: string;
}) {
  const { t } = useTranslation();
  const updateSort = useUpdateSort();
  const conditions = useMemo(() => {
    return [{
      id: SortCondition.Ascending,
      name: t('grid.sort.ascending'),
    }, {
      id: SortCondition.Descending,
      name: t('grid.sort.descending'),
    }];

  }, [t]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={onOpenChange}
    >
      <DropdownMenuTrigger asChild>
        <div className={'absolute top-0 left-0 w-full h-full z-[-1]'} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={'p-2 w-fit min-w-fit'}
        onClick={e => {
          e.stopPropagation();
        }}
      >
        <DropdownMenuGroup>
          {conditions.map(condition => (
            <DropdownMenuItem
              key={condition.id}
              className={selected === condition.id ? 'bg-accent' : ''}
              onSelect={() => {
                updateSort({
                  sortId,
                  condition: condition.id,
                });
              }}
            >
              {condition.name}
              {selected === condition.id && (<DropdownMenuItemTick />)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ConditionMenu;