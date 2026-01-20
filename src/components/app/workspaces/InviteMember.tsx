import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { SubscriptionPlan, Workspace, WorkspaceMember } from '@/application/types';
import { ReactComponent as TipIcon } from '@/assets/icons/warning.svg';
import { useAppHandlers } from '@/components/app/app.hooks';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { getProAccessPlanFromSubscriptions, isAppFlowyHosted } from '@/utils/subscription';

function InviteMember({
  workspace,
  open,
  openOnChange,
}: {
  workspace: Workspace;
  open?: boolean;
  openOnChange?: (open: boolean) => void;
}) {
  const { getSubscriptions } = useAppHandlers();
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const service = useService();
  const currentWorkspaceId = workspace.id;
  const [, setSearch] = useSearchParams();

  const currentUser = useCurrentUser();
  const [memberCount, setMemberCount] = React.useState<number>(0);
  const memberListRef = useRef<WorkspaceMember[]>([]);
  const isOwner = workspace.owner?.uid.toString() === currentUser?.uid.toString();

  const loadMembers = useCallback(async () => {
    try {
      if (!service || !currentWorkspaceId) return;
      memberListRef.current = await service.getWorkspaceMembers(currentWorkspaceId);
      setMemberCount(memberListRef.current.length);
    } catch (e) {
      console.error(e);
    }
  }, [currentWorkspaceId, service]);

  const [activeSubscriptionPlan, setActiveSubscriptionPaln] = React.useState<SubscriptionPlan | null>(null);

  const loadSubscription = useCallback(async () => {
    if (!isAppFlowyHosted()) {
      setActiveSubscriptionPaln(SubscriptionPlan.Pro);
      return;
    }

    try {
      const subscriptions = await getSubscriptions?.();

      if (!subscriptions || subscriptions.length === 0) {
        setActiveSubscriptionPaln(SubscriptionPlan.Free);

        return;
      }

      setActiveSubscriptionPaln(getProAccessPlanFromSubscriptions(subscriptions));
    } catch (e) {
      setActiveSubscriptionPaln(SubscriptionPlan.Free);
      console.error(e);
    }
  }, [getSubscriptions]);

  const isExceed = useMemo(() => {
    if (activeSubscriptionPlan === null) return false;
    if (activeSubscriptionPlan === SubscriptionPlan.Free) {
      return memberCount >= 2;
    }

    if (activeSubscriptionPlan === SubscriptionPlan.Pro) {
      return memberCount >= 10;
    }

    return false;
  }, [activeSubscriptionPlan, memberCount]);

  const handleOk = async () => {
    if (!service || !currentWorkspaceId) return;
    try {
      setLoading(true);
      const emails = value.split(',').map((e) => e.trim());

      const hadInvited = emails.filter((e) => memberListRef.current.find((m) => m.email === e));

      if (hadInvited.length > 0) {
        toast.warning(t('inviteMember.inviteAlready', { email: hadInvited[0] }));
        return;
      }

      await service.inviteMembers(currentWorkspaceId, emails);

      openOnChange?.(false);
      toast.success(t('inviteMember.inviteSuccess'));
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setValue('');
    } else {
      void loadMembers();
      void loadSubscription();
    }
  }, [open, loadMembers, loadSubscription]);

  const handleUpgrade = useCallback(async () => {
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [setSearch]);

  if (!isOwner) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={openOnChange}>
        <DialogContent className={'w-[500px]'}>
          <DialogHeader>
            <DialogTitle>{t('inviteMember.requestInviteMembers')}</DialogTitle>
          </DialogHeader>
          <div
            style={{
              display: isExceed ? 'flex' : 'none',
            }}
            className={'mb-4 flex w-full flex-wrap items-center gap-1 overflow-hidden text-text-secondary'}
          >
            <TipIcon className={'h-4 w-4 text-function-warning'} />
            {t('inviteMember.inviteFailedMemberLimit')}
            <span onClick={handleUpgrade} className={'cursor-pointer text-text-action hover:underline'}>
              {t('inviteMember.upgrade')}
            </span>
          </div>
          <div className='grid gap-4'>
            <div className='grid gap-3'>
              <Label htmlFor='emails'>{t('inviteMember.emails')}</Label>
              <Input
                id='emails'
                name='emails'
                disabled={isExceed}
                onChange={(e) => setValue(e.target.value)}
                value={value}
                placeholder={t('inviteMember.addEmail')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleOk();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button loading={loading} onClick={handleOk} disabled={!value}>
              {loading && <Progress />}
              {t('inviteMember.requestInvites')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default InviteMember;
