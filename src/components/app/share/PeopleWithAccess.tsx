import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { APP_EVENTS } from '@/application/constants';
import { AccessLevel, IPeopleWithAccessType, Role } from '@/application/types';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { AccessService } from '@/application/services/domains';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

import { PersonItem } from './PersonItem';

interface PeopleWithAccessProps {
  viewId: string;
  people: IPeopleWithAccessType[];
  isLoading: boolean;
  onPeopleChange: () => Promise<void>;
}

export function PeopleWithAccess({ viewId, people, onPeopleChange, isLoading }: PeopleWithAccessProps) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  const currentWorkspaceId = useCurrentWorkspaceId();
  const navigate = useNavigate();
  const { eventEmitter } = useAppHandlers();
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

  // Check if current user has full access (can modify others)
  const currentUserHasFullAccess =
    people.find((p) => p.email === currentUser?.email)?.access_level === AccessLevel.FullAccess;

  // Check if current user is owner
  const currentUserIsOwner = people.find((p) => p.email === currentUser?.email)?.role === Role.Owner;

  return (
    <div className='w-full px-2 pt-4'>
      <div className='flex items-center gap-2 px-2 py-1.5'>
        <Label>{t('shareAction.peopleWithAccess')}</Label>
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
              currentUserHasFullAccess={currentUserHasFullAccess}
              currentUserIsOwner={currentUserIsOwner}
              onAccessLevelChange={handleAccessLevelChange}
              onRemoveAccess={handleRemoveAccess}
              onTurnIntoMember={handleTurnIntoMember}
            />
          );
        })}
      </div>
    </div>
  );
}
