import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AccessLevel, IPeopleWithAccessType, Role } from '@/application/types';
import { ReactComponent as UserIcon } from '@/assets/icons/invite_user.svg';
import { notify } from '@/components/_shared/notify';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { AccessLevelDropdown } from './AccessLevelDropdown';
import { PersonAvatar } from './PersonAvatar';

interface PersonItemProps {
  person: IPeopleWithAccessType;
  isYou: boolean;
  isInheritedWorkspaceAccess: boolean;
  currentUserHasFullAccess: boolean;
  currentUserIsOwner: boolean;
  onAccessLevelChange: (email: string, accessLevel: AccessLevel) => Promise<void>;
  onRemoveAccess: (email: string) => Promise<void>;
  onTurnIntoMember?: (email: string) => Promise<void>;
}

export function PersonItem({
  person,
  isYou,
  isInheritedWorkspaceAccess,
  currentUserHasFullAccess,
  currentUserIsOwner,
  onAccessLevelChange,
  onRemoveAccess,
  onTurnIntoMember,
}: PersonItemProps) {
  const { t } = useTranslation();
  const canModifyThisPerson = !isInheritedWorkspaceAccess && (currentUserHasFullAccess || isYou);

  const [turnIntoMemberLoading, setTurnIntoMemberLoading] = useState<boolean>(false);
  // Show "Turn into Member" button if:
  // 1. Person is not pending
  // 2. Current user is owner
  // 3. Person is a guest
  // 4. Not the current user themselves
  const showTurnIntoMemberButton =
    !person.pending_invitation && currentUserIsOwner && person.role === Role.Guest && !isYou;

  return (
    <div
      key={person.email}
      className='group flex w-full items-center gap-2 rounded-300 px-2 py-1.5 hover:bg-fill-content-hover'
    >
      <div className='flex w-full flex-row items-center gap-2 overflow-hidden'>
        <PersonAvatar avatarUrl={person.avatar_url} name={person.name} />
        <div className='flex w-full flex-1 flex-col gap-0.5 overflow-hidden'>
          <div className='flex items-center gap-2'>
            <Tooltip delayDuration={500} disableHoverableContent>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'truncate text-sm text-text-primary',
                    person.pending_invitation && 'text-text-secondary'
                  )}
                >
                  {person.name}
                </div>
              </TooltipTrigger>
              <TooltipContent>{person.name}</TooltipContent>
            </Tooltip>

            {isYou && <span className='text-xs text-text-tertiary'>({t('shareAction.you')})</span>}
            {person.role === Role.Guest && (
              <span className='rounded-full bg-fill-warning-light px-2 py-[1px] text-xs text-text-warning-on-fill'>
                {t('shareAction.guest')}
              </span>
            )}
          </div>
          <div className='truncate whitespace-nowrap text-xs text-text-secondary'>{person.email}</div>
        </div>
      </div>
      {person.pending_invitation && (
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <span className='cursor-default rounded-full border border-border-primary bg-fill-content px-2 py-[1px] text-xs text-text-tertiary'>
              {t('shareAction.pending')}
            </span>
          </TooltipTrigger>
          <TooltipContent>{t('shareAction.pendingTooltip')}</TooltipContent>
        </Tooltip>
      )}
      {showTurnIntoMemberButton && (
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='opacity-0 transition-opacity group-hover:opacity-100'
              onClick={async () => {
                if (turnIntoMemberLoading) return;
                setTurnIntoMemberLoading(true);
                try {
                  await onTurnIntoMember?.(person.email);
                  notify.success(t('shareAction.turnIntoMemberSuccess', { email: person.email }));
                } catch (error) {
                  notify.error(t('shareAction.turnIntoMemberError'));
                } finally {
                  setTurnIntoMemberLoading(false);
                }
              }}
            >
              {turnIntoMemberLoading ? <Progress variant='primary' /> : <UserIcon className='h-5 w-5' />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side='top'>{t('shareAction.turnIntoMember')}</TooltipContent>
        </Tooltip>
      )}
      <AccessLevelDropdown
        person={person}
        canModify={canModifyThisPerson}
        currentUserHasFullAccess={currentUserHasFullAccess}
        isYou={isYou}
        onAccessLevelChange={onAccessLevelChange}
        onRemoveAccess={onRemoveAccess}
      />
    </div>
  );
}
