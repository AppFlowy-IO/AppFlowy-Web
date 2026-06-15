import { ChevronDown } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { FilterType } from '@/application/database-yjs/database.type';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface OperatorToggleProps {
  value: FilterType.And | FilterType.Or;
  onChange: (type: FilterType.And | FilterType.Or) => void;
  disabled?: boolean;
}

export function OperatorToggle({ value, onChange, disabled }: OperatorToggleProps) {
  const { t } = useTranslation();

  const handleSelectAnd = useCallback(() => {
    onChange(FilterType.And);
  }, [onChange]);

  const handleSelectOr = useCallback(() => {
    onChange(FilterType.Or);
  }, [onChange]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant='ghost'
          size='sm'
          className='h-7 w-14 justify-between px-2 text-xs font-medium'
          disabled={disabled}
        >
          {value === FilterType.And ? t('grid.filter.and') : t('grid.filter.or')}
          <ChevronDown className='h-3 w-3' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-[80px]'>
        <DropdownMenuItem onClick={handleSelectAnd} className={value === FilterType.And ? 'bg-accent' : ''}>
          {t('grid.filter.and')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSelectOr} className={value === FilterType.Or ? 'bg-accent' : ''}>
          {t('grid.filter.or')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default OperatorToggle;
