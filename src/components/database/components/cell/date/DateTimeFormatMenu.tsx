import DateTimeFormatGroup from '@/components/database/components/property/date/DateTimeFormatGroup';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import React from 'react';

function DateTimeFormatMenu ({ fieldId, children }: { fieldId: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={'right'}
        className={'w-[240px]'}
      >
        <DateTimeFormatGroup fieldId={fieldId} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default DateTimeFormatMenu;