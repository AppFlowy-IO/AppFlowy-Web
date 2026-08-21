import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  AccessLevel,
  IPeopleWithAccessType,
  MentionablePerson,
  Role,
  SubscriptionPlan,
  WorkspaceGroupViewPermission,
} from '@/application/types';
import { isSameUserUid } from '@/application/user-uid';
import { notify } from '@/components/_shared/notify';
import { useLoadMentionableUsers, useGetSubscriptions, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { CopyLink } from '@/components/app/share/CopyLink';
import { GeneralAccess } from '@/components/app/share/GeneralAccess';
import { InviteGuest } from '@/components/app/share/InviteGuest';
import { PeopleWithAccess } from '@/components/app/share/PeopleWithAccess';
import { ShareSectionType } from '@/components/app/share/shareSectionType';
import { UpgradeBanner } from '@/components/app/share/UpgradeBanner';
import { useCurrentUser } from '@/components/main/app.hooks';
import { getProAccessPlanFromSubscriptions, isAppFlowyHosted } from '@/utils/subscription';

import type { ShareAccessRefreshResult } from './useShareAccessDetails';

function SharePanel({
  viewId,
  people,
  groups,
  editableGroupIds,
  isLoadingPeople,
  onPeopleChange,
  onPersonRemoved,
  updateGroupInAccessList,
  hasFullAccess,
  canManageFullAccess,
  currentUserAccessLevel,
  sectionType,
}: {
  viewId: string;
  people: IPeopleWithAccessType[];
  groups: WorkspaceGroupViewPermission[];
  editableGroupIds: ReadonlySet<string>;
  isLoadingPeople: boolean;
  onPeopleChange: () => Promise<ShareAccessRefreshResult | void>;
  onPersonRemoved: (email: string) => void;
  updateGroupInAccessList: (groupId: string, accessLevel: AccessLevel | null) => void;
  hasFullAccess: boolean;
  canManageFullAccess: boolean;
  currentUserAccessLevel?: AccessLevel;
  sectionType: ShareSectionType;
}) {
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();
  const selectedWorkspace = userWorkspaceInfo?.selectedWorkspace;
  const role = selectedWorkspace?.role;
  const loadMentionableUsers = useLoadMentionableUsers();
  const [mentionable, setMentionable] = useState<MentionablePerson[]>([]);
  const [isLoadingMentionable, setIsLoadingMentionable] = useState(false);
  const [mentionableError, setMentionableError] = useState<string | null>(null);
  const isOwner = role === Role.Owner || isSameUserUid(selectedWorkspace?.owner?.uid, currentUser?.uid);
  const isMember = role === Role.Member;
  const showInviteControls = currentUserAccessLevel !== undefined && currentUserAccessLevel !== AccessLevel.ReadOnly;
  // Page Full Access does not make a Guest part of the workspace group boundary.
  const canManageGroupAccess = hasFullAccess && (isOwner || isMember);

  // Load mentionable users
  const loadMentionableData = useCallback(async () => {
    if (!showInviteControls || !loadMentionableUsers) return;

    setIsLoadingMentionable(true);
    setMentionableError(null);

    try {
      const res = await loadMentionableUsers();

      if (res) {
        setMentionable(res);
      }
    } catch (error) {
      setMentionableError(error instanceof Error ? error.message : 'Failed to load users');
      console.error(error);
    } finally {
      setIsLoadingMentionable(false);
    }
  }, [loadMentionableUsers, showInviteControls]);

  // Load mentionable data on component mount
  useEffect(() => {
    if (!showInviteControls) return;

    void loadMentionableData();
  }, [loadMentionableData, showInviteControls]);

  // Refresh people list after invite or other changes
  const refreshPeople = useCallback(async () => {
    const [, accessResult] = await Promise.allSettled([loadMentionableData(), onPeopleChange()]);

    if (accessResult.status === 'rejected') {
      const error = accessResult.reason;

      notify.error(error instanceof Error ? error.message : String(error));
      return undefined;
    }

    return accessResult.value;
  }, [onPeopleChange, loadMentionableData]);

  const getSubscriptions = useGetSubscriptions();

  const [activeSubscriptionPlan, setActiveSubscriptionPlan] = useState<SubscriptionPlan | null>(null);
  const isHosted = useMemo(() => isAppFlowyHosted(), []);

  const loadSubscription = useCallback(async () => {
    try {
      const subscriptions = await getSubscriptions?.();

      if (!subscriptions || subscriptions.length === 0) {
        setActiveSubscriptionPlan(SubscriptionPlan.Free);

        return;
      }

      setActiveSubscriptionPlan(getProAccessPlanFromSubscriptions(subscriptions));
    } catch (e) {
      setActiveSubscriptionPlan(null);
      console.error(e);
    }
  }, [getSubscriptions]);

  useEffect(() => {
    if (!showInviteControls || !isHosted) {
      setActiveSubscriptionPlan(null);
      return;
    }

    if (isOwner || isMember) {
      void loadSubscription();
    }
  }, [isHosted, isMember, isOwner, loadSubscription, showInviteControls]);

  return (
    <div className='flex flex-col items-start gap-1 self-stretch py-4'>
      <div className='flex flex-col items-start self-stretch px-2'>
        {showInviteControls && (
          <>
            <InviteGuest
              viewId={viewId}
              sharedPeople={people}
              sharedGroups={groups}
              isLoadingPeople={isLoadingPeople}
              mentionable={mentionable}
              isLoadingMentionable={isLoadingMentionable}
              mentionableError={mentionableError}
              onInviteSuccess={async () => {
                await refreshPeople();
              }}
              hasFullAccess={hasFullAccess}
              canGrantFullAccess={canManageFullAccess}
              canManageGroupAccess={canManageGroupAccess}
            />
            {isHosted && <UpgradeBanner activeSubscriptionPlan={activeSubscriptionPlan} />}
          </>
        )}
        <PeopleWithAccess
          viewId={viewId}
          people={people}
          groups={groups}
          editableGroupIds={editableGroupIds}
          isLoading={isLoadingPeople}
          onPeopleChange={refreshPeople}
          onPersonRemoved={onPersonRemoved}
          updateGroupInAccessList={updateGroupInAccessList}
          hasFullAccess={hasFullAccess}
          canManageGroupAccess={canManageGroupAccess}
          canManageFullAccess={canManageFullAccess}
          canGrantFullAccess={canManageFullAccess}
          sectionType={sectionType}
        />
        <GeneralAccess sectionType={sectionType} />
        <CopyLink />
      </div>
    </div>
  );
}

export default SharePanel;
