import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';

import { APP_EVENTS } from '@/application/constants';
import { AccessLevel, IPeopleWithAccessType, Role, WorkspaceGroupViewPermission } from '@/application/types';
import { useEventEmitter, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { AccessService } from '@/application/services/domains';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

import { GroupAccessLevelDropdown } from './GroupAccessLevelDropdown';
import { PersonItem } from './PersonItem';

interface PeopleWithAccessProps {
  viewId: string;
  people: IPeopleWithAccessType[];
  groups: WorkspaceGroupViewPermission[];
  isLoading: boolean;
  onPeopleChange: () => Promise<void>;
  hasFullAccess: boolean;
}

export function PeopleWithAccess({
  viewId,
  people,
  groups,
  onPeopleChange,
  isLoading,
  hasFullAccess,
}: PeopleWithAccessProps) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  const currentWorkspaceId = useCurrentWorkspaceId();
  const navigate = useNavigate();
  const eventEmitter = useEventEmitter();
  const handleAccessLevelChange = useCallback(
    async (personEmail: string, newAccessLevel: AccessLevel) => {
      if (!currentWorkspaceId) return;
      await AccessService.sharePageTo(currentWorkspaceId, viewId, [personEmail], newAccessLevel);

      // Refresh the people list after change
      await onPeopleChange();
    },
    [onPeopleChange, currentWorkspaceId, viewId]
  );

  const handleRemoveAccess = useCallback(
    async (personEmail: string) => {
      if (!currentWorkspaceId) return;

      // Only navigate if the current user is removing their own access
      const shouldNavigate = personEmail === currentUser?.email;

      // Set up listener for outline refresh BEFORE async operations
      // This ensures we don't miss the OUTLINE_LOADED event if it fires quickly
      let outlineRefreshPromise: Promise<void> | null = null;

      if (shouldNavigate && eventEmitter) {
        outlineRefreshPromise = new Promise<void>((resolve) => {
          const handleOutlineLoaded = () => {
            eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
            resolve();
          };

          eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);

          // Timeout after 5 seconds to prevent infinite waiting
          setTimeout(() => {
            eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, handleOutlineLoaded);
            resolve();
          }, 5000);
        });
      }

      await AccessService.revokeAccess(currentWorkspaceId, viewId, [personEmail]);

      // Refresh the people list after removal
      await onPeopleChange();

      // Wait for outline refresh to complete before navigating
      // This prevents race conditions where navigation happens before outline is updated
      if (shouldNavigate && outlineRefreshPromise) {
        await outlineRefreshPromise;
        navigate('/app');
      }
    },
    [onPeopleChange, currentWorkspaceId, viewId, navigate, currentUser?.email, eventEmitter]
  );

  const handleTurnIntoMember = useCallback(
    async (personEmail: string) => {
      if (!currentWorkspaceId) return;
      await AccessService.turnIntoMember(currentWorkspaceId, personEmail);

      // Refresh the people list after change
      await onPeopleChange();
    },
    [onPeopleChange, currentWorkspaceId]
  );

  const handleGroupAccessLevelChange = useCallback(
    async (groupId: string, newAccessLevel: AccessLevel) => {
      if (!currentWorkspaceId) return;
      await AccessService.sharePageToGroup(currentWorkspaceId, viewId, groupId, newAccessLevel);
      await onPeopleChange();
    },
    [currentWorkspaceId, onPeopleChange, viewId]
  );

  const handleRemoveGroupAccess = useCallback(
    async (groupId: string) => {
      if (!currentWorkspaceId) return;
      await AccessService.revokeGroupAccess(currentWorkspaceId, viewId, groupId);
      await onPeopleChange();
    },
    [currentWorkspaceId, onPeopleChange, viewId]
  );

  // Check if current user is owner
  const currentUserIsOwner = people.find((p) => p.email === currentUser?.email)?.role === Role.Owner;

  return (
    <div className='w-full px-2 pt-4'>
      <div className='flex items-center gap-2 px-2 py-1.5'>
        <Label>{t('shareAction.peopleAndGroupsWithAccess')}</Label>
        {isLoading && <Progress variant='primary' />}
      </div>
      <div className='flex max-h-[200px] w-full flex-col overflow-y-auto'>
        {people.map((person) => {
          const isYou = currentUser?.email === person.email;

          return (
            <PersonItem
              key={person.email}
              person={person}
              isYou={isYou}
              currentUserHasFullAccess={hasFullAccess}
              currentUserIsOwner={currentUserIsOwner}
              onAccessLevelChange={handleAccessLevelChange}
              onRemoveAccess={handleRemoveAccess}
              onTurnIntoMember={handleTurnIntoMember}
            />
          );
        })}
        {groups.map((group) => (
          <div
            key={`group:${group.group_id}`}
            className='group flex w-full items-center gap-2 rounded-300 px-2 py-1.5 hover:bg-fill-content-hover'
          >
            <div className='flex w-full flex-row items-center gap-2 overflow-hidden'>
              <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill-content-hover text-icon-secondary'>
                <Users className='h-5 w-5' />
              </div>
              <div className='flex w-full flex-1 flex-col gap-0.5 overflow-hidden'>
                <div className='flex items-center gap-2'>
                  <div className='truncate text-sm text-text-primary'>{group.name}</div>
                  <span className='rounded-full bg-fill-content-hover px-2 py-[1px] text-xs text-text-secondary'>
                    {t('shareAction.group')}
                  </span>
                </div>
                <div className='truncate whitespace-nowrap text-xs text-text-secondary'>
                  {t('shareAction.groupMembersCount', { count: group.member_count })}
                </div>
              </div>
            </div>
            <GroupAccessLevelDropdown
              group={group}
              canModify={hasFullAccess}
              currentUserHasFullAccess={hasFullAccess}
              onAccessLevelChange={handleGroupAccessLevelChange}
              onRemoveAccess={handleRemoveGroupAccess}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
