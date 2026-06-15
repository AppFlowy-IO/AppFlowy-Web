import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getFieldDateTimeFormats } from '@/application/database-yjs';
import { useUpdateDateTimeFieldFormat } from '@/application/database-yjs/dispatch';
import { DateFormat, TimeFormat } from '@/application/types';
import { useFieldTypeOption } from '@/components/database/components/cell/Cell.hooks';
import {
  DropdownMenuGroup, DropdownMenuItem, DropdownMenuItemTick,
  DropdownMenuPortal,
  DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

function DateTimeFormatGroup ({
  fieldId,
}: {
  fieldId: string
}) {
  const { t } = useTranslation();
  const typeOption = useFieldTypeOption(fieldId);
  const { dateFormat: selectedDateFormat, timeFormat: selectedTimeFormat } = getFieldDateTimeFormats(typeOption, undefined);

  const updateFormat = useUpdateDateTimeFieldFormat(fieldId);
  const dateFormats = useMemo(() => [{
    value: DateFormat.Local,
    label: t('grid.field.dateFormatLocal'),
  }, {
    label: t('grid.field.dateFormatUS'),
    value: DateFormat.US,
  }, {
    label: t('grid.field.dateFormatISO'),
    value: DateFormat.ISO,
  }, {
    label: t('grid.field.dateFormatFriendly'),
    value: DateFormat.Friendly,
  }, {
    label: t('grid.field.dateFormatDayMonthYear'),
    value: DateFormat.DayMonthYear,
  }], [t]);

  const timeFormats = useMemo(() => [{
    value: TimeFormat.TwelveHour,
    label: t('grid.field.timeFormatTwelveHour'),
  }, {
    label: t('grid.field.timeFormatTwentyFourHour'),
    value: TimeFormat.TwentyFourHour,
  }], [t]);
  const [hoveredType, setHoveredType] = React.useState<string | undefined>(undefined);

  return (
    <DropdownMenuGroup
      className={'max-w-[240px] overflow-hidden'}
    >
      <DropdownMenuSub
        open={hoveredType === 'date'}
        onOpenChange={(open) => {
          if (!open) {
            setHoveredType(undefined);
          } else {
            setHoveredType('date');
          }
        }}
      >
        <DropdownMenuSubTrigger
          onMouseEnter={() => setHoveredType('date')}
        >
          {t('grid.field.dateFormat')}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>
            {dateFormats.map((format) => (
              <DropdownMenuItem
                key={format.value}
                onSelect={(e) => {
                  e.preventDefault();
                  updateFormat({
                    dateFormat: format.value,
                  });
                  setHoveredType(undefined);
                }}
              >
                {format.label}
                {selectedDateFormat === format.value ? <DropdownMenuItemTick /> : ''}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
      <DropdownMenuSub
        onOpenChange={(open) => {
          if (!open) {
            setHoveredType(undefined);
          } else {
            setHoveredType('time');
          }
        }}
        open={hoveredType === 'time'}
      >
        <DropdownMenuSubTrigger
          onMouseEnter={() => setHoveredType('time')}
        >
          {t('grid.field.timeFormat')}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>
            {timeFormats.map((format) => (
              <DropdownMenuItem
                key={format.value}
                onSelect={(e) => {
                  e.preventDefault();
                  updateFormat({
                    timeFormat: format.value,
                  });
                  setHoveredType(undefined);
                }}
              >
                {format.label}
                {selectedTimeFormat === format.value ? <DropdownMenuItemTick /> : ''}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}

export default DateTimeFormatGroup;
