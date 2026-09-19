import { format } from 'date-fns';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { CollabVersionRecord } from '@/application/collab-version.type';
import { ReactComponent as CrownIcon } from '@/assets/icons/crown.svg';
import { ReactComponent as UserIcon } from '@/assets/icons/user.svg';
import {
  VersionHistoryDateFilter,
  VersionHistoryFooter,
  VersionHistoryHeader,
  VersionHistoryItem,
  type HistoryDateFilter,
} from '@/components/_shared/version-history';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

export const VersionList = memo(function VersionList({
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
  dateFilter: HistoryDateFilter;
  onlyShowMine: boolean;
  onDateFilterChange: (filter: HistoryDateFilter) => void;
  onOnlyShowMineChange: (onlyShowMine: boolean) => void;
  onRestoreClicked?: () => void;
  isRestoring?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const handleToggleOnlyMine = useCallback((event: Event) => {
    event.preventDefault();
    onOnlyShowMineChange(!onlyShowMine);
  }, [onOnlyShowMineChange, onlyShowMine]);

  return (
    <div className='flex h-full flex-col'>
      <VersionHistoryHeader onClose={onClose} closeTestId='version-history-close-button'>
        <VersionHistoryDateFilter value={dateFilter} onChange={onDateFilterChange} showDateRanges={isPro} />
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className='flex items-center justify-items-center'
            onSelect={handleToggleOnlyMine}
          >
            <UserIcon className='h-5 w-5' />
            <span className='flex-1'>{t('versionHistory.onlyYours')}</span>
            <Switch checked={onlyShowMine} className='pointer-events-none' tabIndex={-1} aria-hidden />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </VersionHistoryHeader>
      <div data-testid="version-history-list" className='flex-1 overflow-y-auto p-3'>
        {versions.map((version, index) => {
          const createdAt = version.createdAt;
          const title = version.name || format(createdAt, 'PPpp');

          return (
            <VersionHistoryItem
              key={version.versionId}
              id={version.versionId}
              testId={`version-history-item-${version.versionId}`}
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
      <VersionHistoryFooter
        testId='version-history-restore-button'
        onRestore={onRestoreClicked}
        disabled={!selectedVersionId || !onRestoreClicked || isRestoring}
        loading={isRestoring}
      />
    </div>
  );
});
