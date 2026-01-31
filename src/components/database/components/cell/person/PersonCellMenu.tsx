import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCellSelector, useDatabaseViewId, useFieldSelector, usePrimaryFieldId } from '@/application/database-yjs';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as NotificationIcon } from '@/assets/icons/mention_send_notification.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useService } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { useMentionableUsersWithAutoFetch } from './useMentionableUsers';

interface PersonCellMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedUserIds: string[];
  fieldId: string;
  rowId: string;
}

function PersonCellMenu({ open, onOpenChange, fieldId, rowId, selectedUserIds }: PersonCellMenuProps) {
  const { field } = useFieldSelector(fieldId);
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);
  const service = useService();
  const workspaceId = useCurrentWorkspaceId();
  const viewId = useDatabaseViewId();
  const primaryFieldId = usePrimaryFieldId();
  const cellSelectorResult = useCellSelector({ rowId, fieldId: primaryFieldId || '' });
  const { t } = useTranslation();

  // Use cached mentionable users
  const { users: mentionableUsers, loading } = useMentionableUsersWithAutoFetch(open);

  const [notifyAssignee, setNotifyAssignee] = useState(true);

  // Get the row title from primary field for notifications
  const rowTitle = (cellSelectorResult?.data as string) || '';

  // Get is_single_select and disable_notification from type option
  const { isSingleSelect, disableNotification } = useMemo(() => {
    if (!field) return { isSingleSelect: false, disableNotification: false };
    const typeOption = field.get(YjsDatabaseKey.type_option)?.get(String(field.get(YjsDatabaseKey.type)));

    return {
      isSingleSelect: typeOption?.get(YjsDatabaseKey.is_single_select) ?? false,
      disableNotification: typeOption?.get(YjsDatabaseKey.disable_notification) ?? false,
    };
  }, [field]);

  // Initialize notify state from type option
  useEffect(() => {
    setNotifyAssignee(!disableNotification);
  }, [disableNotification]);

  const handleSelectPerson = useCallback(
    async (personId: string) => {
      const isSelected = selectedUserIds.includes(personId);

      if (isSelected) {
        const newSelectedIds = selectedUserIds.filter((id) => id !== personId);

        onUpdateCell(JSON.stringify(newSelectedIds));
      } else {
        const newSelectedIds = isSingleSelect ? [personId] : [...selectedUserIds, personId];

        onUpdateCell(JSON.stringify(newSelectedIds));

        // Send notification if notifyAssignee is true
        if (notifyAssignee && service && workspaceId && viewId) {
          try {
            await service.updatePageMention(workspaceId, viewId, {
              person_id: personId,
              row_id: rowId,
              require_notification: true,
              view_name: rowTitle || 'Untitled',
              is_row_document: false,
            });
          } catch (error) {
            console.error('Failed to send notification:', error);
          }
        }
      }
    },
    [isSingleSelect, onUpdateCell, selectedUserIds, notifyAssignee, service, workspaceId, viewId, rowId, rowTitle]
  );

  const isEmpty = !mentionableUsers || mentionableUsers.length === 0;

  const handleToggleNotify = useCallback(() => {
    setNotifyAssignee((prev) => !prev);
  }, []);

  const handlePreventDefault = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleStopPropagation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger className={'absolute left-0 top-0 z-[-1] h-full w-full'} />
      <PopoverContent
        data-testid="person-cell-menu"
        side={'bottom'}
        align={'start'}
        onMouseDown={handlePreventDefault}
        className={'w-[280px] overflow-hidden p-0'}
      >
        {/* Notify Assignee Toggle */}
        <div className={'p-2'}>
          <div
            className={cn(
              'flex h-[36px] cursor-pointer items-center gap-3 rounded-md px-2',
              'hover:bg-fill-content-hover'
            )}
            onClick={handleToggleNotify}
          >
            <NotificationIcon
              className={cn('h-5 w-5 flex-shrink-0', notifyAssignee ? 'text-fill-default' : 'text-icon-primary')}
            />
            <span className={'flex-1 text-sm leading-5'}>{t('grid.field.person.notifyAssignee')}</span>
            <Switch
              checked={notifyAssignee}
              onCheckedChange={setNotifyAssignee}
              onClick={handleStopPropagation}
            />
          </div>
        </div>

        <Separator />

        {/* Users List */}
        <div className={'max-h-[240px] overflow-y-auto p-2'}>
          {loading ? (
            <div className={'flex items-center justify-center py-4'}>
              <Progress />
            </div>
          ) : isEmpty ? (
            <div className={'py-4 text-center text-sm text-text-tertiary'}>
              {t('grid.field.person.noMatches')}
            </div>
          ) : (
            mentionableUsers.map((user) => {
              const isSelected = selectedUserIds.includes(user.person_id);
              const displayName = user.name || user.email || '?';

              return (
                <div
                  key={user.person_id}
                  className={cn(
                    'flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md px-2 py-1',
                    'hover:bg-fill-content-hover',
                    isSelected && 'bg-fill-content-hover'
                  )}
                  onClick={() => handleSelectPerson(user.person_id)}
                >
                  <Avatar className={'h-6 w-6'}>
                    <AvatarImage src={user.avatar_url || undefined} alt={displayName} />
                    <AvatarFallback className={'text-xs'}>{displayName}</AvatarFallback>
                  </Avatar>
                  <div className={'flex flex-1 flex-col overflow-hidden'}>
                    <span className={'truncate text-sm'}>{user.name || user.email}</span>
                    {user.name && user.email && (
                      <span className={'truncate text-xs text-text-tertiary'}>{user.email}</span>
                    )}
                  </div>
                  {isSelected && <CheckIcon className={'h-4 w-4 flex-shrink-0 text-text-action'} />}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default PersonCellMenu;
