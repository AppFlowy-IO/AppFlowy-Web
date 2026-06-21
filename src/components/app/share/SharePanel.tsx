import { useCallback, useEffect, useMemo, useState } from 'react';

import { IPeopleWithAccessType, MentionablePerson, Role, SubscriptionPlan } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useLoadMentionableUsers, useGetSubscriptions, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { CopyLink } from '@/components/app/share/CopyLink';
import { GeneralAccess } from '@/components/app/share/GeneralAccess';
import { InviteGuest } from '@/components/app/share/InviteGuest';
import { PeopleWithAccess } from '@/components/app/share/PeopleWithAccess';
import { ShareSectionType } from '@/components/app/share/shareSectionType';
import { UpgradeBanner } from '@/components/app/share/UpgradeBanner';
import { getProAccessPlanFromSubscriptions, isAppFlowyHosted } from '@/utils/subscription';

function SharePanel({
  viewId,
  people,
  isLoadingPeople,
  onPeopleChange,
  hasFullAccess,
  sectionType,
}: {
  viewId: string;
  people: IPeopleWithAccessType[];
  isLoadingPeople: boolean;
  onPeopleChange: () => Promise<void>;
  hasFullAccess: boolean;
  sectionType: ShareSectionType;
}) {
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const selectedWorkspace = userWorkspaceInfo?.selectedWorkspace;
  const role = selectedWorkspace?.role;
  const loadMentionableUsers = useLoadMentionableUsers();
  const [mentionable, setMentionable] = useState<MentionablePerson[]>([]);
  const [isLoadingMentionable, setIsLoadingMentionable] = useState(false);
  const [mentionableError, setMentionableError] = useState<string | null>(null);
  const isOwner = role === Role.Owner;
  const isMember = role === Role.Member;

  // Load mentionable users
  const loadMentionableData = useCallback(async () => {
    if (!loadMentionableUsers) return;

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
  }, [loadMentionableUsers]);

  // Load mentionable data on component mount
  useEffect(() => {
    void loadMentionableData();
  }, [loadMentionableData]);

  // Refresh people list after invite or other changes
  const refreshPeople = useCallback(async () => {
    try {
      await loadMentionableData();
      await onPeopleChange();
      // eslint-disable-next-line
    } catch (error: any) {
      notify.error(error.message);
    }
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
    if (!isHosted) {
      setActiveSubscriptionPlan(null);
      return;
    }

    if (isOwner || isMember) {
      void loadSubscription();
    }
  }, [isHosted, isMember, isOwner, loadSubscription]);

  return (
    <div className='flex flex-col items-start gap-1 self-stretch py-4'>
      <div className='flex flex-col items-start self-stretch px-2'>
        <InviteGuest
          viewId={viewId}
          sharedPeople={people}
          isLoadingPeople={isLoadingPeople}
          mentionable={mentionable}
          isLoadingMentionable={isLoadingMentionable}
          mentionableError={mentionableError}
          onInviteSuccess={refreshPeople}
          hasFullAccess={hasFullAccess}
        />
        {isHosted && <UpgradeBanner activeSubscriptionPlan={activeSubscriptionPlan} />}
        <PeopleWithAccess
          viewId={viewId}
          people={people}
          isLoading={isLoadingPeople}
          onPeopleChange={refreshPeople}
          hasFullAccess={hasFullAccess}
        />
        <GeneralAccess sectionType={sectionType} />
        <CopyLink />
      </div>
    </div>
  );
}

export default SharePanel;
