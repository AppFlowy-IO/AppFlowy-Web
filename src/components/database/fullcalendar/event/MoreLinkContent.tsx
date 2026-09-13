import { CalendarApi, MoreLinkArg, MoreLinkContentArg } from "@fullcalendar/core";
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { MoreLinkPopoverContent } from './MoreLinkPopoverContent';

export function MoreLinkContent({
  data,
  moreLinkInfo,
  calendar,
  onClose,
}: {
  moreLinkInfo?: MoreLinkArg;
  data: MoreLinkContentArg;
  calendar: CalendarApi;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { num } = data;

  const [open, setOpen] = useState(false);

  const [width, setWidth] = useState(0);

  useEffect(() => {
    setWidth(Math.max(window.innerWidth / 7, 180));
  }, [open]);

  return (
    <div className='relative w-full'>
      <div
        onClick={() => {
          setOpen(true);
        }}
        className='w-full rounded-200 p-1 text-left text-text-primary focus-within:outline-none hover:bg-fill-content-hover'
      >
        {' '}
        {t('calendar.more', { num })}
      </div>
      {open && (
        <Popover
          open={open}
          onOpenChange={(open) => {
            if (!open) {
              onClose();
            }

            setOpen(open);
          }}
        >
          <PopoverTrigger
            className='absolute left-0 top-0 h-full w-full'
            style={{
              zIndex: open ? 1 : -1,
              pointerEvents: open ? 'auto' : 'none',
            }}
          ></PopoverTrigger>
          <PopoverContent
            className='bg-surface-layer-04'
            side='top'
            sideOffset={-50}
            align='center'
            style={{
              width: width,
              minWidth: width,
            }}
          >
            {moreLinkInfo && (
              <MoreLinkPopoverContent
                moreLinkInfo={moreLinkInfo}
                calendar={calendar}
                onClose={() => {
                  setOpen(false);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
