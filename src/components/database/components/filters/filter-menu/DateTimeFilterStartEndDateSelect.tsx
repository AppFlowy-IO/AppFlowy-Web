import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useReadOnly } from '@/application/database-yjs';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuItem, DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function DateTimeFilterStartEndDateSelect ({
  onSelect,
  isStart,
}: {
  onSelect: (isStart: boolean) => void,
  isStart: boolean,
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();

  const conditions = useMemo(() => [{
    value: true,
    text: t('grid.dateFilter.startDate'),
  }, {
    value: false,
    text: t('grid.dateFilter.endDate'),
  }], [t]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        disabled={readOnly}
      >
        <Button
          variant={'ghost'}
          size={'sm'}
          className={'h-7 w-fit min-w-fit px-2 text-xs font-medium text-text-primary'}
          data-testid={'date-filter-start-end-select'}
        >
          {conditions.find((c) => c.value === isStart)?.text ?? ''}
          <ArrowDownSvg className={'h-5 w-5 text-icon-secondary'} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={'min-w-fit'}>
        <DropdownMenuGroup>
          {conditions.map((condition) => (
            <DropdownMenuItem
              key={String(condition.value)}
              onSelect={() => {
                onSelect(condition.value);
              }}
            >
              {condition.text}
              {condition.value === isStart && (<DropdownMenuItemTick />)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default DateTimeFilterStartEndDateSelect;