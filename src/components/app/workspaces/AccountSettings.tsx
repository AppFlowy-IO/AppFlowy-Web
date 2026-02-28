import dayjs from 'dayjs';
import { debounce } from 'lodash-es';
import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { DateFormat, TimeFormat } from '@/application/types';
import { UserService } from '@/application/services/domains';
import { MetadataKey } from '@/application/user-metadata';
import { ReactComponent as ChevronDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { useAppConfig } from '@/components/main/app.hooks';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function AccountSettings({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();
  const { currentUser, updateCurrentUser } = useAppConfig();
  const [open, setIsOpen] = useState(false);

  const [dateFormat, setDateFormat] = useState(
    () => Number(currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) || DateFormat.Local
  );
  const [timeFormat, setTimeFormat] = useState(
    () => Number(currentUser?.metadata?.[MetadataKey.TimeFormat] as TimeFormat) || TimeFormat.TwelveHour
  );
  const [startWeekOn, setStartWeekOn] = useState(() => Number(currentUser?.metadata?.[MetadataKey.StartWeekOn]) || 0);

  const metadataUpdateRef = useRef<Record<string, unknown> | null>(null);

  const debounceUpdateProfile = useMemo(() => {
    return debounce(async () => {
      if (!currentUser?.metadata || !metadataUpdateRef.current) return;

      await UserService.updateProfile(metadataUpdateRef.current);
    }, 300);
  }, [currentUser]);

  useEffect(() => {
    return () => {
      debounceUpdateProfile.cancel();
    };
  }, [debounceUpdateProfile]);

  const handleSelectDateFormat = useCallback(
    async (dateFormat: number) => {
      setDateFormat(dateFormat);

      metadataUpdateRef.current = {
        ...metadataUpdateRef?.current,
        [MetadataKey.DateFormat]: dateFormat,
      };
      await debounceUpdateProfile();
    },
    [debounceUpdateProfile]
  );

  const handleSelectTimeFormat = useCallback(
    async (timeFormat: number) => {
      setTimeFormat(timeFormat);

      metadataUpdateRef.current = {
        ...metadataUpdateRef?.current,
        [MetadataKey.TimeFormat]: timeFormat,
      };
      await debounceUpdateProfile();
    },
    [debounceUpdateProfile]
  );

  const handleSelectStartWeekOn = useCallback(
    async (startWeekOn: number) => {
      setStartWeekOn(startWeekOn);

      metadataUpdateRef.current = {
        ...metadataUpdateRef?.current,
        [MetadataKey.StartWeekOn]: startWeekOn,
      };
      await debounceUpdateProfile();
    },
    [debounceUpdateProfile]
  );

  const onOpenChange = useCallback(
    async (isOpen: boolean) => {
      if (isOpen) {
        const user = await UserService.getCurrentRaw();

        setDateFormat(Number(user?.metadata?.[MetadataKey.DateFormat] as DateFormat) || DateFormat.Local);
        setTimeFormat(Number(user?.metadata?.[MetadataKey.TimeFormat] as TimeFormat) || TimeFormat.TwelveHour);
        setStartWeekOn(Number(user?.metadata?.[MetadataKey.StartWeekOn]) || 0);

        metadataUpdateRef.current = {
          ...user?.metadata,
        };
      } else {
        if (currentUser) {
          void updateCurrentUser({
            ...currentUser,
            metadata: metadataUpdateRef.current || currentUser.metadata,
          });
        }
      }

      setIsOpen(isOpen);
    },
    [currentUser, updateCurrentUser]
  );

  if (!currentUser) {
    return <></>;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        data-testid='account-settings-dialog'
        className='flex h-[500px] min-h-0 w-[400px] flex-col gap-3 sm:max-w-[calc(100%-2rem)]'
      >
        <DialogTitle className='text-md font-bold text-text-primary'>{t('web.accountSettings')}</DialogTitle>
        <DialogDescription className='sr-only'>
          Configure your account preferences including date format, time format, and week start day
        </DialogDescription>
        <div className='flex min-h-0 w-full flex-1 flex-col items-start gap-4 overflow-y-auto py-4'>
          {/* Date/Time Settings */}
          <div className='flex w-full flex-col items-start gap-3'>
            <DateFormatDropdown dateFormat={dateFormat} onSelect={handleSelectDateFormat} />
            <TimeFormatDropdown timeFormat={timeFormat} onSelect={handleSelectTimeFormat} />
            <StartWeekOnDropdown startWeekOn={startWeekOn} onSelect={handleSelectStartWeekOn} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DateFormatDropdown({ dateFormat, onSelect }: { dateFormat: number; onSelect: (dateFormat: number) => void }) {
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);

  const dateFormats = useMemo(
    () => [
      {
        value: DateFormat.Local,
        label: t('grid.field.dateFormatLocal'),
      },
      {
        label: t('grid.field.dateFormatUS'),
        value: DateFormat.US,
      },
      {
        label: t('grid.field.dateFormatISO'),
        value: DateFormat.ISO,
      },
      {
        label: t('grid.field.dateFormatFriendly'),
        value: DateFormat.Friendly,
      },
      {
        label: t('grid.field.dateFormatDayMonthYear'),
        value: DateFormat.DayMonthYear,
      },
    ],
    [t]
  );

  const value = dateFormats.find((format) => format.value === dateFormat);

  return (
    <div className='flex flex-col items-start gap-1'>
      <span className='text-xs font-medium text-text-secondary'>{t('grid.field.dateFormat')}</span>
      <div className='relative'>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
          <DropdownMenuTrigger
            data-testid='date-format-dropdown'
            asChild
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => setIsOpen((prev) => !prev)}
          >
            <div
              className={cn(
                'flex h-8 flex-1 cursor-pointer items-center gap-1 rounded-300 border px-2 text-sm font-normal',
                isOpen ? 'border-border-theme-thick' : 'border-border-primary hover:border-border-primary-hover'
              )}
            >
              <span className='flex-1 truncate' onMouseDown={(e) => e.preventDefault()}>
                {value?.label || t('settings.workspacePage.dateTime.dateFormat.label')}
              </span>
              <ChevronDownIcon className='text-icon-primary' />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            <DropdownMenuRadioGroup value={dateFormat.toString()} onValueChange={(value) => onSelect(Number(value))}>
              {dateFormats.map((item) => (
                <DropdownMenuRadioItem
                  data-testid={`date-format-${item.value}`}
                  key={item.value}
                  value={item.value.toString()}
                >
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function TimeFormatDropdown({ timeFormat, onSelect }: { timeFormat: number; onSelect: (timeFormat: number) => void }) {
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);

  const timeFormats = useMemo(
    () => [
      {
        value: TimeFormat.TwelveHour,
        label: t('grid.field.timeFormatTwelveHour'),
      },
      {
        label: t('grid.field.timeFormatTwentyFourHour'),
        value: TimeFormat.TwentyFourHour,
      },
    ],
    [t]
  );

  const value = timeFormats.find((format) => format.value === timeFormat);

  return (
    <div className='flex flex-col items-start gap-1'>
      <span className='text-xs font-medium text-text-secondary'>{t('grid.field.timeFormat')}</span>
      <div className='relative'>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
          <DropdownMenuTrigger
            data-testid='time-format-dropdown'
            asChild
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => setIsOpen((prev) => !prev)}
          >
            <div
              className={cn(
                'flex h-8 flex-1 cursor-pointer items-center gap-1 rounded-300 border px-2 text-sm font-normal',
                isOpen ? 'border-border-theme-thick' : 'border-border-primary hover:border-border-primary-hover'
              )}
            >
              <span className='flex-1 truncate' onMouseDown={(e) => e.preventDefault()}>
                {value?.label || t('grid.field.timeFormatTwelveHour')}
              </span>
              <ChevronDownIcon className='text-icon-primary' />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            <DropdownMenuRadioGroup value={timeFormat.toString()} onValueChange={(value) => onSelect(Number(value))}>
              {timeFormats.map((item) => (
                <DropdownMenuRadioItem
                  data-testid={`time-format-${item.value}`}
                  key={item.value}
                  value={item.value.toString()}
                >
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function StartWeekOnDropdown({
  startWeekOn,
  onSelect,
}: {
  startWeekOn: number;
  onSelect: (startWeekOn: number) => void;
}) {
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);

  const daysOfWeek = [
    {
      value: 0,
      label: dayjs().day(0).format('dddd'),
    },
    {
      value: 1,
      label: dayjs().day(1).format('dddd'),
    },
  ] as const;

  const value = daysOfWeek.find((format) => format.value === startWeekOn);

  return (
    <div className='flex flex-col items-start gap-1'>
      <span className='text-xs font-medium text-text-secondary'>{t('web.startWeekOn')}</span>
      <div className='relative'>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
          <DropdownMenuTrigger
            data-testid='start-week-on-dropdown'
            asChild
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => setIsOpen((prev) => !prev)}
          >
            <div
              className={cn(
                'flex h-8 flex-1 cursor-pointer items-center gap-1 rounded-300 border px-2 text-sm font-normal',
                isOpen ? 'border-border-theme-thick' : 'border-border-primary hover:border-border-primary-hover'
              )}
            >
              <span className='flex-1 truncate' onMouseDown={(e) => e.preventDefault()}>
                {value?.label || t('grid.field.timeFormatTwelveHour')}
              </span>
              <ChevronDownIcon className='text-icon-primary' />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            <DropdownMenuRadioGroup value={startWeekOn.toString()} onValueChange={(value) => onSelect(Number(value))}>
              {daysOfWeek.map((item) => (
                <DropdownMenuRadioItem
                  data-testid={`start-week-${item.value}`}
                  key={item.value}
                  value={item.value.toString()}
                >
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
