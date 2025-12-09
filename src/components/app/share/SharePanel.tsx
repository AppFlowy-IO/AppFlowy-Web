import { useCallback, useEffect, useMemo, useState } from 'react';

import { AccessLevel, IPeopleWithAccessType, MentionablePerson, Role, SubscriptionPlan } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { findAncestors } from '@/components/_shared/outline/utils';
import { useAppHandlers, useAppOutline, useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { CopyLink } from '@/components/app/share/CopyLink';
import { GeneralAccess } from '@/components/app/share/GeneralAccess';
import { InviteGuest } from '@/components/app/share/InviteGuest';
import { PeopleWithAccess } from '@/components/app/share/PeopleWithAccess';
import { UpgradeBanner } from '@/components/app/share/UpgradeBanner';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import { isAppFlowyHosted } from '@/utils/subscription';

function SharePanel({ viewId }: { viewId: string }) {
  const currentUser = useCurrentUser();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const selectedWorkspace = userWorkspaceInfo?.selectedWorkspace;
  const role = selectedWorkspace?.role;
  const service = useService();
  const { loadMentionableUsers } = useAppHandlers();
  const [people, setPeople] = useState<IPeopleWithAccessType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mentionable, setMentionable] = useState<MentionablePerson[]>([]);
  const [isLoadingMentionable, setIsLoadingMentionable] = useState(false);
  const [mentionableError, setMentionableError] = useState<string | null>(null);
  const outline = useAppOutline();
  const hasFullAccess = useMemo(() => {
    return people.find((p) => p.email === currentUser?.email)?.access_level === AccessLevel.FullAccess;
  }, [people, currentUser?.email]);

  const isOwner = useMemo(() => {
    return role === Role.Owner;
  }, [role]);

  const isMember = useMemo(() => {
    return role === Role.Member;
  }, [role]);

  const loadPeople = useCallback(async () => {
    if (!currentWorkspaceId || !viewId || !service || !currentUser) {
      return;
    }

    const ancestorViewIds = findAncestors(outline || [], viewId)?.map((item) => item.view_id) || [];

    setIsLoading(true);
    try {
      const detail = await service.getShareDetail(currentWorkspaceId, viewId, ancestorViewIds);

      setPeople(detail.shared_with);
    } catch (error) {
      console.error(error);
      setPeople([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, currentWorkspaceId, viewId, service, outline]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

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
      await loadPeople();
      // eslint-disable-next-line
    } catch (error: any) {
      notify.error(error.message);
    }
  }, [loadPeople, loadMentionableData]);

  const { getSubscriptions } = useAppHandlers();

  const [activeSubscriptionPlan, setActiveSubscriptionPaln] = useState<SubscriptionPlan | null>(null);

  const loadSubscription = useCallback(async () => {
    try {
      const subscriptions = await getSubscriptions?.();

      if (!subscriptions || subscriptions.length === 0) {
        setActiveSubscriptionPaln(SubscriptionPlan.Free);

        return;
      }

      const subscription = subscriptions[0];

      setActiveSubscriptionPaln(subscription?.plan || SubscriptionPlan.Free);
    } catch (e) {
      setActiveSubscriptionPaln(SubscriptionPlan.Free);
      console.error(e);
    }
  }, [getSubscriptions]);

  useEffect(() => {
    if (!isAppFlowyHosted()) {
      setActiveSubscriptionPaln(SubscriptionPlan.Pro);
      return;
    }

    if (isOwner || isMember) {
      void loadSubscription();
    }
  }, [isMember, isOwner, loadSubscription]);

  return (
    <div className='flex flex-col items-start gap-1 self-stretch py-4'>
      <div className='flex flex-col items-start self-stretch px-2'>
        <InviteGuest
          viewId={viewId}
          sharedPeople={people}
          isLoadingPeople={isLoading}
          mentionable={mentionable}
          isLoadingMentionable={isLoadingMentionable}
          mentionableError={mentionableError}
          onInviteSuccess={refreshPeople}
          hasFullAccess={hasFullAccess}
          activeSubscriptionPlan={activeSubscriptionPlan}
        />
        {isAppFlowyHosted() && <UpgradeBanner activeSubscriptionPlan={activeSubscriptionPlan} />}
        <PeopleWithAccess viewId={viewId} people={people} isLoading={isLoading} onPeopleChange={refreshPeople} />
        <GeneralAccess viewId={viewId} />
        <CopyLink />
      </div>
    </div>
  );
}

export default SharePanel;
