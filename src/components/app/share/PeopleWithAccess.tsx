import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { APP_EVENTS } from '@/application/constants';
import { AccessService } from '@/application/services/domains';
import {
  AccessLevel,
  IPeopleWithAccessType,
  Role,
  SharedUserAccessSource,
  WorkspaceGroupViewPermission,
} from '@/application/types';
import { useEventEmitter, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

import { GroupItem } from './GroupItem';
import { PersonItem } from './PersonItem';
import { isInheritedWorkspaceAccess, ShareSectionType } from './shareSectionType';

import type { ShareAccessRefreshResult } from './useShareAccessDetails';

interface PeopleWithAccessProps {
  viewId: string;
  people: IPeopleWithAccessType[];
  groups: WorkspaceGroupViewPermission[];
  editableGroupIds: ReadonlySet<string>;
  isLoading: boolean;
  onPeopleChange: () => Promise<ShareAccessRefreshResult | void>;
  onPersonRemoved: (email: string) => void;
  updateGroupInAccessList: (groupId: string, accessLevel: AccessLevel | null) => void;
  hasFullAccess: boolean;
  canManageGroupAccess: boolean;
  canManageFullAccess: boolean;
  canGrantFullAccess: boolean;
  /** Whether group rows may expand to list their members (workspace owners only on the server). */
  canExploreGroupMembers?: boolean;
  disablePersonAccessChanges?: boolean;
  sectionType: ShareSectionType;
}

export function PeopleWithAccess({
  viewId,
  people,
  groups = [],
  editableGroupIds,
  onPeopleChange,
  onPersonRemoved,
  updateGroupInAccessList,
  isLoading,
  hasFullAccess,
  canManageGroupAccess,
  canManageFullAccess,
  canGrantFullAccess,
  canExploreGroupMembers = false,
  disablePersonAccessChanges = false,
  sectionType,
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

      // The mutation response is authoritative for this direct row. The share
      // hook keeps a revocation tombstone while related access is revalidated,
      // so every overlapping response is filtered consistently.
      onPersonRemoved(personEmail);
      await onPeopleChange();

      // Wait for outline refresh to complete before navigating
      // This prevents race conditions where navigation happens before outline is updated
      if (shouldNavigate && outlineRefreshPromise) {
        await outlineRefreshPromise;
        navigate('/app');
      }
    },
    [onPeopleChange, onPersonRemoved, currentWorkspaceId, viewId, navigate, currentUser?.email, eventEmitter]
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
      if (!currentWorkspaceId || !canManageGroupAccess) return;
      await AccessService.sharePageToGroup(currentWorkspaceId, viewId, groupId, newAccessLevel);
      updateGroupInAccessList(groupId, newAccessLevel);
      const refreshResult = await onPeopleChange();

      if (!refreshResult) return undefined;
      return refreshResult.effectiveGroups.find((group) => group.group_id === groupId)?.access_level ?? null;
    },
    [canManageGroupAccess, currentWorkspaceId, onPeopleChange, updateGroupInAccessList, viewId]
  );

  const handleRemoveGroupAccess = useCallback(
    async (groupId: string) => {
      if (!currentWorkspaceId || !canManageGroupAccess) return;
      await AccessService.revokeGroupAccess(currentWorkspaceId, viewId, groupId);
      updateGroupInAccessList(groupId, null);
      const refreshResult = await onPeopleChange();

      if (!refreshResult) return undefined;
      return refreshResult.effectiveGroups.find((group) => group.group_id === groupId)?.access_level ?? null;
    },
    [canManageGroupAccess, currentWorkspaceId, onPeopleChange, updateGroupInAccessList, viewId]
  );

  const currentUserRole = people.find((p) => p.email === currentUser?.email)?.role;
  const currentUserIsOwner = currentUserRole === Role.Owner;
  const hasGroupRows = groups.length > 0;
  // People whose only access comes from a workspace group are represented by that group's row
  // (which can expand to list them) instead of being listed individually. Rows without a
  // source come from older servers and are always shown.
  const visiblePeople = useMemo(
    () =>
      hasGroupRows ? people.filter((person) => person.access_source !== SharedUserAccessSource.WorkspaceGroup) : people,
    [hasGroupRows, people]
  );
  const peopleByEmail = useMemo(
    () => new Map(people.map((person) => [person.email.trim().toLowerCase(), person] as const)),
    [people]
  );
  const permissionChangeDisabledReason = disablePersonAccessChanges
    ? t('shareAction.databaseRowPagePermissionChangeDisabled')
    : undefined;

  return (
    <div className='w-full px-2 pt-4'>
      <div className='flex items-center gap-2 px-2 py-1.5'>
        <Label>{t('shareAction.peopleAndGroupsWithAccess')}</Label>
        {isLoading && <Progress variant='primary' />}
      </div>
      <div className='flex max-h-[200px] w-full flex-col overflow-y-auto'>
        {visiblePeople.map((person) => {
          const isYou = currentUser?.email === person.email;

          return (
            <PersonItem
              key={person.email}
              person={person}
              isYou={isYou}
              isInheritedWorkspaceAccess={isInheritedWorkspaceAccess(sectionType, person)}
              currentUserHasFullAccess={hasFullAccess}
              currentUserIsOwner={currentUserIsOwner}
              currentUserCanGrantFullAccess={canGrantFullAccess}
              permissionChangeDisabledReason={permissionChangeDisabledReason}
              onAccessLevelChange={handleAccessLevelChange}
              onRemoveAccess={handleRemoveAccess}
              onTurnIntoMember={handleTurnIntoMember}
            />
          );
        })}
        {groups.map((group) => (
          <GroupItem
            key={`group:${group.group_id}`}
            group={group}
            peopleByEmail={peopleByEmail}
            canExploreMembers={canExploreGroupMembers}
            canModify={canManageGroupAccess && editableGroupIds.has(group.group_id)}
            currentUserHasFullAccess={hasFullAccess}
            canManageFullAccess={canManageFullAccess}
            onAccessLevelChange={handleGroupAccessLevelChange}
            onRemoveAccess={handleRemoveGroupAccess}
          />
        ))}
      </div>
    </div>
  );
}
