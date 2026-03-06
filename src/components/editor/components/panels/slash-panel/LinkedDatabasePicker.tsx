import { PopoverOrigin } from '@mui/material/Popover/Popover';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import { calculateOptimalOrigins, Popover } from '@/components/_shared/popover';
import { SearchInput } from '@/components/chat/components/ui/search-input';
import { DatabaseTreeItem } from './DatabaseTreeItem';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

interface LinkedDatabasePickerProps {
  open: boolean;
  position: { top: number; left: number } | undefined;
  transformOrigin: PopoverOrigin | undefined;
  databaseSearch: string;
  onSearchChange: (value: string) => void;
  databaseLoading: boolean;
  databaseError: string | null;
  filteredDatabaseTree: View[];
  allowedDatabaseIds: Set<string>;
  onSelect: (viewId: string) => void;
  onClose: () => void;
}

/**
 * Sub-picker popover for linking an existing database from the slash menu.
 * Extracted from SlashPanel to reduce component size and enable independent memoization.
 */
export const LinkedDatabasePicker = memo(function LinkedDatabasePicker({
  open,
  position,
  transformOrigin,
  databaseSearch,
  onSearchChange,
  databaseLoading,
  databaseError,
  filteredDatabaseTree,
  allowedDatabaseIds,
  onSelect,
  onClose,
}: LinkedDatabasePickerProps) {
  const { t } = useTranslation();

  return (
    <Popover
      adjustOrigins={false}
      open={open}
      onClose={onClose}
      anchorReference={'anchorPosition'}
      anchorPosition={position}
      disableAutoFocus={true}
      disableRestoreFocus={true}
      disableEnforceFocus={true}
      transformOrigin={transformOrigin}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className={'flex h-fit max-h-[360px] min-h-[200px] w-[360px] flex-col'}>
        <Label className={'px-2 pt-2 font-normal'}>
          {t('document.slashMenu.linkedDatabase.title', {
            defaultValue: 'Link to an existing database',
          })}
        </Label>
        <SearchInput
          value={databaseSearch}
          onChange={onSearchChange}
          className='m-2'
        />
        <Separator />
        <div className={'appflowy-scrollbar flex-1 overflow-y-auto overflow-x-hidden p-2'}>
          {databaseLoading ? (
            <div className={'flex h-full w-full items-center justify-center py-10 opacity-60'}>
              {t('common.loading', { defaultValue: 'Loading...' })}
            </div>
          ) : databaseError ? (
            <div className={'flex h-full w-full items-center justify-center py-10 text-destructive'}>
              {databaseError}
            </div>
          ) : filteredDatabaseTree.length > 0 ? (
            filteredDatabaseTree.map((view) => (
              <DatabaseTreeItem
                key={view.view_id}
                view={view}
                allowedIds={allowedDatabaseIds}
                onSelect={(selectedView) => {
                  void onSelect(selectedView.view_id);
                }}
                fallbackTitle={t('document.view.placeholder', { defaultValue: 'Untitled' })}
                isSearching={!!databaseSearch}
              />
            ))
          ) : (
            <div className={'flex h-full w-full items-center justify-center py-10 opacity-60'}>
              {t('document.slashMenu.linkedDatabase.empty', {
                defaultValue: 'No databases found',
              })}
            </div>
          )}
        </div>
      </div>
    </Popover>
  );
});

export default LinkedDatabasePicker;
