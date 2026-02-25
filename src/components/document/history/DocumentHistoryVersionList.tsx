import { format } from 'date-fns';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { CollabVersionRecord } from '@/application/collab-version.type';
import { MentionablePerson } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as CrownIcon } from '@/assets/icons/crown.svg';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
// import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as TimeIcon } from '@/assets/icons/time.svg';
import { ReactComponent as UserIcon } from '@/assets/icons/user.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export function VersionList({
  versions,
  selectedVersionId,
  onSelect,
  isPro,
  dateFilter = 'all',
  onlyShowMine,
  onDateFilterChange,
  onOnlyShowMineChange,
  onRestoreClicked,
  isRestoring = false,
  onClose,
}: {
  versions: CollabVersionRecord[];
  selectedVersionId: string;
  onSelect: (versionId: string) => void;
  isPro: boolean;
  authorMap: Map<string, MentionablePerson>;
  dateFilter: 'all' | 'last7Days' | 'last30Days' | 'last60Days';
  onlyShowMine: boolean;
  onDateFilterChange: (filter: 'all' | 'last7Days' | 'last30Days' | 'last60Days') => void;
  onOnlyShowMineChange: (onlyShowMine: boolean) => void;
  onRestoreClicked?: () => void;
  isRestoring?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-center gap-1 px-4 pb-0.5 pt-3'>
        <div className='flex flex-1 items-center gap-1 '>
          <p className='text-start text-sm font-medium text-text-primary'>{t('versionHistory.versionHistory')}</p>
          {/*<Button variant='ghost' size='icon' className='h-5 w-5 rounded-100 p-0 text-icon-tertiary'>
            <InfoIcon className='h-5 w-5' />
          </Button>*/}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' className='text-icon-secondary'>
              <FilterIcon className='h-5 w-5' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  onDateFilterChange('all');
                }}
              >
                <TimeIcon className='h-5 w-5' />
                <span className='flex-1'>{t('versionHistory.all')}</span>
                {dateFilter === 'all' && <TickIcon className='h-5 w-5 text-icon-info-thick' />}
              </DropdownMenuItem>
              {isPro && (
                <>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      onDateFilterChange('last7Days');
                    }}
                  >
                    <TimeIcon className='h-5 w-5' />
                    <span className='flex-1'>{t('versionHistory.last7Days')}</span>
                    {dateFilter === 'last7Days' && <TickIcon className='h-5 w-5 text-icon-info-thick' />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      onDateFilterChange('last30Days');
                    }}
                  >
                    <TimeIcon className='h-5 w-5' />
                    <span className='flex-1'>{t('versionHistory.last30Days')}</span>
                    {dateFilter === 'last30Days' && <TickIcon className='h-5 w-5 text-icon-info-thick' />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      onDateFilterChange('last60Days');
                    }}
                  >
                    <TimeIcon className='h-5 w-5' />
                    <span className='flex-1'>{t('versionHistory.last60Days')}</span>
                    {dateFilter === 'last60Days' && <TickIcon className='h-5 w-5 text-icon-info-thick' />}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className='flex items-center justify-items-center'
                onClick={(e) => {
                  e.preventDefault();
                  onOnlyShowMineChange(!onlyShowMine);
                }}
              >
                <UserIcon className='h-5 w-5' />
                <span className='flex-1'>{t('versionHistory.onlyYours')}</span>
                <Switch checked={onlyShowMine} onCheckedChange={onOnlyShowMineChange} />
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button data-testid="version-history-close-button" variant='ghost' size='icon' className='text-icon-secondary' onClick={onClose}>
          <CloseIcon className='h-5 w-5' />
        </Button>
      </div>
      <div data-testid="version-history-list" className='flex-1 overflow-y-auto p-3'>
        {versions.map((version, index) => {
          const createdAt = version.createdAt;
          const title = version.name || format(createdAt, 'PPpp');

          return (
            <VersionListItem
              key={version.versionId}
              id={version.versionId}
              title={title}
              selected={selectedVersionId === version.versionId}
              isFirst={index === 0}
              isLast={index === versions.length - 1}
              onSelect={onSelect}
            />
          );
        })}
      </div>
      {!isPro && (
        <div className='m-3 flex items-center gap-2 rounded-300 bg-fill-featured-light p-3'>
          <CrownIcon className='h-5 w-5' />
          <span className='text-xs text-text-featured'>
            <span className='font-medium'>{t('versionHistory.upgrade')}</span>
            <span> </span>
            <span>{t('versionHistory.forLongerVersionHistory')}</span>
          </span>
        </div>
      )}
      <Separator />
      <div className='flex justify-end px-4 py-3'>
        <Button
          data-testid="version-history-restore-button"
          className='font-medium'
          onClick={onRestoreClicked}
          disabled={!selectedVersionId || !onRestoreClicked || isRestoring}
          loading={isRestoring}
        >
          {t('versionHistory.restore')}
        </Button>
      </div>
    </div>
  );
}

const VersionListItem = memo(function VersionListItem({
  id,
  title,
  selected,
  isFirst = false,
  isLast = false,
  onSelect,
}: {
  id: string;
  title: string;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: (id: string) => void;
}) {
  const handleSelect = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  return (
    <Button
      data-testid={`version-history-item-${id}`}
      variant='ghost'
      onClick={handleSelect}
      className={cn(
        'group relative flex w-full items-start justify-start gap-3 rounded-400 py-0 pl-4 pr-3',
        selected && 'bg-fill-content-hover'
      )}
    >
      {!isFirst && <div className='absolute bottom-5 left-[25px] top-0 w-0.5 bg-icon-quaternary' />}
      {!isLast && <div className='absolute bottom-0 left-[25px] top-5 w-0.5 bg-icon-quaternary' />}
      <div
        className={cn(
          'absolute top-3 m-1 h-3 w-3 shrink-0 rounded-200 border-[2px] bg-surface-container-layer-01',
          selected ? 'border-border-theme-thick' : 'border-icon-tertiary'
        )}
      >
        <div className={cn('h-2 w-2 rounded-100', selected ? 'bg-fill-content-hover' : 'group-hover:bg-fill-content-hover')} />
      </div>
      <span className='ml-8 flex flex-1 flex-col items-start py-3 text-sm'>
        <span className={selected ? 'font-medium text-text-info' : 'text-text-primary'}>{title}</span>
      </span>
    </Button>
  );
});
