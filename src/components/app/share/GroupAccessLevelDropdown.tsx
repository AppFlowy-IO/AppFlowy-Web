import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AccessLevel, WorkspaceGroupViewPermission } from '@/application/types';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as CrownIcon } from '@/assets/icons/crown.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as ViewIcon } from '@/assets/icons/show.svg';
import { notify } from '@/components/_shared/notify';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

interface GroupAccessLevelDropdownProps {
  group: WorkspaceGroupViewPermission;
  canModify: boolean;
  currentUserHasFullAccess: boolean;
  onAccessLevelChange: (groupId: string, accessLevel: AccessLevel) => Promise<void>;
  onRemoveAccess: (groupId: string) => Promise<void>;
}

export function GroupAccessLevelDropdown({
  group,
  canModify,
  currentUserHasFullAccess,
  onAccessLevelChange,
  onRemoveAccess,
}: GroupAccessLevelDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const getAccessLevelText = (accessLevel?: AccessLevel) => {
    switch (accessLevel) {
      case AccessLevel.FullAccess:
        return t('shareAction.fullAccess');
      case AccessLevel.ReadAndWrite:
        return t('shareAction.readAndWrite');
      case AccessLevel.ReadAndComment:
        return t('shareAction.readAndComment');
      case AccessLevel.ReadOnly:
      default:
        return t('shareAction.readOnly');
    }
  };

  const changeAccess = useCallback(
    async (loadingKey: string, accessLevel: AccessLevel) => {
      setLoading(loadingKey);
      try {
        await onAccessLevelChange(group.group_id, accessLevel);
        setOpen(false);
        notify.success(t('shareAction.changeGroupAccessSuccess', { group: group.name }));
      } catch (error) {
        notify.error(t('shareAction.changeAccessError'));
      } finally {
        setLoading(null);
      }
    },
    [group.group_id, group.name, onAccessLevelChange, t]
  );

  const handleRemoveAccess = useCallback(async () => {
    setLoading('remove');
    try {
      await onRemoveAccess(group.group_id);
      setOpen(false);
      notify.success(t('shareAction.removeGroupAccessSuccess', { group: group.name }));
    } catch (error) {
      notify.error(t('shareAction.removeAccessError'));
    } finally {
      setLoading(null);
    }
  }, [group.group_id, group.name, onRemoveAccess, t]);

  if (group.access_level === AccessLevel.FullAccess && !canModify) {
    return (
      <div className='mr-2 flex min-w-fit items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm text-text-secondary'>
        {getAccessLevelText(group.access_level)}
      </div>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' className='flex items-center justify-center gap-1.5' disabled={!canModify}>
          {getAccessLevelText(group.access_level)}
          <ArrowDownIcon className='text-icon-secondary' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {currentUserHasFullAccess && (
          <>
            <DropdownMenuItem
              disabled={loading === 'view'}
              onSelect={(e) => {
                e.preventDefault();
                void changeAccess('view', AccessLevel.ReadOnly);
              }}
            >
              <div className='flex items-center gap-2'>
                <ViewIcon />
                <div className='flex flex-col'>
                  <div className='text-sm text-text-primary'>{t('shareAction.canView')}</div>
                  <div className='text-xs text-text-tertiary'>{t('shareAction.canViewDescription')}</div>
                </div>
              </div>
              {!loading && group.access_level === AccessLevel.ReadOnly && <DropdownMenuItemTick />}
              {loading === 'view' && <Progress variant='primary' />}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={loading === 'edit'}
              onSelect={(e) => {
                e.preventDefault();
                void changeAccess('edit', AccessLevel.ReadAndWrite);
              }}
            >
              <div className='flex items-center gap-2'>
                <EditIcon />
                <div className='flex flex-col'>
                  <div className='text-sm text-text-primary'>{t('shareAction.canEdit')}</div>
                  <div className='text-xs text-text-tertiary'>{t('shareAction.canEditDescription')}</div>
                </div>
              </div>
              {!loading && group.access_level === AccessLevel.ReadAndWrite && <DropdownMenuItemTick />}
              {loading === 'edit' && <Progress variant='primary' />}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={loading === 'full'}
              onSelect={(e) => {
                e.preventDefault();
                void changeAccess('full', AccessLevel.FullAccess);
              }}
            >
              <div className='flex items-center gap-2'>
                <CrownIcon />
                <div className='flex flex-col'>
                  <div className='text-sm text-text-primary'>{t('shareAction.fullAccess')}</div>
                  <div className='text-xs text-text-tertiary'>{t('shareAction.fullAccessDescription')}</div>
                </div>
              </div>
              {!loading && group.access_level === AccessLevel.FullAccess && <DropdownMenuItemTick />}
              {loading === 'full' && <Progress variant='primary' />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant='destructive'
              disabled={loading === 'remove'}
              onSelect={(e) => {
                e.preventDefault();
                void handleRemoveAccess();
              }}
            >
              {t('shareAction.removeAccess')}
              {loading === 'remove' && <Progress variant='primary' />}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
