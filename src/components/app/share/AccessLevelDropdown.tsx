import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AccessLevel, IPeopleWithAccessType } from '@/application/types';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as CrownIcon } from '@/assets/icons/crown.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as ViewIcon } from '@/assets/icons/show.svg';
import { notify } from '@/components/_shared/notify';
import { RemoveAccessConfirmDialog } from '@/components/app/share/RemoveAccessConfirmDialog';
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

interface AccessLevelDropdownProps {
  person: IPeopleWithAccessType;
  canModify: boolean;
  currentUserHasFullAccess: boolean;
  isYou: boolean;
  onAccessLevelChange: (email: string, accessLevel: AccessLevel) => Promise<void>;
  onRemoveAccess: (email: string) => Promise<void>;
}

export function AccessLevelDropdown({
  person,
  canModify,
  currentUserHasFullAccess,
  isYou,
  onAccessLevelChange,
  onRemoveAccess,
}: AccessLevelDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);

  const getAccessLevelText = (accessLevel?: AccessLevel) => {
    switch (accessLevel) {
      case AccessLevel.FullAccess:
        return t('shareAction.fullAccess');
      case AccessLevel.ReadAndWrite:
        return t('shareAction.readAndWrite');
      case AccessLevel.ReadAndComment:
        return t('shareAction.readAndComment');
      case AccessLevel.ReadOnly:
        return t('shareAction.readOnly');
      default:
        return t('shareAction.readOnly');
    }
  };

  const handleRemoveAccess = useCallback(async () => {
    setLoading('remove');
    try {
      await onRemoveAccess(person.email);
      setOpen(false);
      setShowRemoveDialog(false);
      notify.success(t('shareAction.removeAccessSuccess', { email: person.email }));
    } catch (error) {
      notify.error(t('shareAction.removeAccessError'));
    } finally {
      setLoading(null);
    }
  }, [onRemoveAccess, person.email, t]);

  const renderRemoveAccess = useCallback(() => {
    return (
      <DropdownMenuItem
        variant='destructive'
        disabled={loading === 'remove'}
        onSelect={(e) => {
          e.preventDefault();
          if (isYou) {
            setShowRemoveDialog(true);
          } else {
            void handleRemoveAccess();
          }
        }}
      >
        {t('shareAction.removeAccess')}
        {loading === 'remove' && <Progress variant='primary' />}
      </DropdownMenuItem>
    );
  }, [loading, isYou, handleRemoveAccess, t]);

  if (!canModify) {
    return (
      <div className='mr-2 flex min-w-fit items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm text-text-secondary'>
        {getAccessLevelText(person.access_level)}
      </div>
    );
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' className='flex items-center justify-center gap-1.5' disabled={!canModify}>
            {getAccessLevelText(person.access_level)}
            <ArrowDownIcon className='text-icon-secondary' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          {currentUserHasFullAccess && !isYou && (
            <>
              <DropdownMenuItem
                disabled={loading === 'view'}
                onSelect={async (e) => {
                  e.preventDefault();
                  setLoading('view');
                  try {
                    await onAccessLevelChange(person.email, AccessLevel.ReadOnly);
                    setOpen(false);
                    notify.success(t('shareAction.changeAccessSuccess', { email: person.email }));
                  } catch (error) {
                    notify.error(t('shareAction.changeAccessError'));
                  } finally {
                    setLoading(null);
                  }
                }}
              >
                <div className='flex items-center gap-2'>
                  <ViewIcon />
                  <div className='flex flex-col'>
                    <div className='text-sm text-text-primary'>{t('shareAction.canView')}</div>
                    <div className='text-xs text-text-tertiary'>{t('shareAction.canViewDescription')}</div>
                  </div>
                </div>
                {!loading && person.access_level === AccessLevel.ReadOnly && <DropdownMenuItemTick />}
                {loading === 'view' && <Progress variant='primary' />}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={loading === 'edit'}
                onSelect={async (e) => {
                  e.preventDefault();
                  setLoading('edit');
                  try {
                    await onAccessLevelChange(person.email, AccessLevel.ReadAndWrite);
                    setOpen(false);
                    notify.success(t('shareAction.changeAccessSuccess', { email: person.email }));
                  } catch (error) {
                    notify.error(t('shareAction.changeAccessError'));
                  } finally {
                    setLoading(null);
                  }
                }}
              >
                <div className='flex items-center gap-2'>
                  <EditIcon />
                  <div className='flex flex-col'>
                    <div className='text-sm text-text-primary'>{t('shareAction.canEdit')}</div>
                    <div className='text-xs text-text-tertiary'>{t('shareAction.canEditDescription')}</div>
                  </div>
                </div>
                {!loading && person.access_level === AccessLevel.ReadAndWrite && <DropdownMenuItemTick />}
                {loading === 'edit' && <Progress variant='primary' />}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={loading === 'full'}
                onSelect={async (e) => {
                  e.preventDefault();
                  setLoading('full');
                  try {
                    await onAccessLevelChange(person.email, AccessLevel.FullAccess);
                    setOpen(false);
                    notify.success(t('shareAction.changeAccessSuccess', { email: person.email }));
                  } catch (error) {
                    notify.error(t('shareAction.changeAccessError'));
                  } finally {
                    setLoading(null);
                  }
                }}
              >
                <div className='flex items-center gap-2'>
                  <CrownIcon />
                  <div className='flex flex-col'>
                    <div className='text-sm text-text-primary'>{t('shareAction.fullAccess')}</div>
                    <div className='text-xs text-text-tertiary'>{t('shareAction.fullAccessDescription')}</div>
                  </div>
                </div>
                {!loading && person.access_level === AccessLevel.FullAccess && <DropdownMenuItemTick />}
                {loading === 'full' && <Progress variant='primary' />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {renderRemoveAccess()}
            </>
          )}
          {isYou && renderRemoveAccess()}
        </DropdownMenuContent>
      </DropdownMenu>

      <RemoveAccessConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        onConfirm={handleRemoveAccess}
        loading={loading === 'remove'}
      />
    </>
  );
}
