import { HTMLAttributes, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import {
  GetRequestAccessInfoResponse,
  RequestAccessInfoStatus,
  SubscriptionInterval,
  SubscriptionPlan,
} from '@/application/types';
import { ReactComponent as SuccessLogo } from '@/assets/icons/success_logo.svg';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { ErrorPage } from '@/components/_shared/landing-page/ErrorPage';
import LandingPage from '@/components/_shared/landing-page/LandingPage';
import { NotInvitationAccount } from '@/components/_shared/landing-page/NotInvitationAccount';
import { NormalModal } from '@/components/_shared/modal';
import { useService } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { hasProAccessFromPlans, isAppFlowyHosted } from '@/utils/subscription';

const GuestLimitExceededCode = 1070;
const REPEAT_REQUEST_CODE = 1122;

function ApproveRequestPage() {
  const [searchParams] = useSearchParams();

  const [requestInfo, setRequestInfo] = useState<GetRequestAccessInfoResponse | null>(null);
  const [currentPlans, setCurrentPlans] = useState<SubscriptionPlan[]>([]);
  const isPro = useMemo(() => hasProAccessFromPlans(currentPlans), [currentPlans]);
  const requestId = searchParams.get('request_id');
  const service = useService();
  const { t } = useTranslation();
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [alreadyProModalOpen, setAlreadyProModalOpen] = useState(false);
  const [hasSend, setHasSend] = useState(false);
  const [isError, setIsError] = useState(false);
  const [notInvitee, setNotInvitee] = useState(false);

  const loadRequestInfo = useCallback(async () => {
    if (!service || !requestId) return;
    try {
      const requestInfo = await service.getRequestAccessInfo(requestId);

      setRequestInfo(requestInfo);

      if (requestInfo.status === RequestAccessInfoStatus.Accepted) {
        setHasSend(true);
        return;
      }

      const plans = await service.getActiveSubscription(requestInfo.workspace.id);

      setCurrentPlans(plans);
      if (plans.length === 0 && isAppFlowyHosted()) {
        setUpgradeModalOpen(true);
      }
      // eslint-disable-next-line
    } catch (e: any) {
      if (e.code === ERROR_CODE.NOT_INVITEE_OF_INVITATION || e.code === ERROR_CODE.NOT_HAS_PERMISSION) {
        setNotInvitee(true);
        return;
      }

      if (e.code === ERROR_CODE.INVALID_LINK) {
        setIsError(true);
        return;
      }

      setIsError(true);
    }
  }, [requestId, service]);

  const handleApprove = useCallback(async () => {
    if (!service || !requestId) return;
    try {
      await service.approveRequestAccess(requestId);
      toast.success(t('approveAccess.approveSuccess'));

      void loadRequestInfo();
      setHasSend(true);
      // eslint-disable-next-line
    } catch (e: any) {
      if (e.code === GuestLimitExceededCode) {
        if (isAppFlowyHosted()) {
          setUpgradeModalOpen(true);
        }

        return;
      }

      if (e.code === REPEAT_REQUEST_CODE) {
        toast.error(t('approveAccess.repeatApproveError'));
        return;
      }

      setIsError(true);
    }
  }, [requestId, service, t, loadRequestInfo]);

  const handleUpgrade = useCallback(async () => {
    if (!service || !requestInfo) return;
    const workspaceId = requestInfo.workspace.id;

    if (!workspaceId) return;

    if (isPro) {
      setAlreadyProModalOpen(true);
      return;
    }

    // This should not be called on self-hosted instances, but adding check as safety
    if (!isAppFlowyHosted()) {
      // Self-hosted instances have Pro features enabled by default
      return;
    }

    const plan = SubscriptionPlan.Pro;

    try {
      const link = await service.getSubscriptionLink(workspaceId, plan, SubscriptionInterval.Month);

      window.open(link, '_blank');
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [requestInfo, service, isPro]);

  useEffect(() => {
    void loadRequestInfo();
  }, [loadRequestInfo]);

  const AvatarLogo = useCallback(
    (props: HTMLAttributes<HTMLDivElement>) => {
      return (
        <Avatar className={cn(props.className)} variant='default' shape={'circle'}>
          <AvatarImage src={requestInfo?.requester?.avatarUrl || ''} alt={''} />
          <AvatarFallback className='text-2xl'>{requestInfo?.requester?.name}</AvatarFallback>
        </Avatar>
      );
    },
    [requestInfo]
  );

  useLayoutEffect(() => {
    void handleApprove();
  }, [handleApprove]);

  if (isError) {
    return <ErrorPage onRetry={handleApprove} />;
  }

  if (notInvitee) {
    return <NotInvitationAccount />;
  }

  if (hasSend) {
    return (
      <LandingPage
        Logo={SuccessLogo}
        workspace={requestInfo?.workspace}
        title={
          <div className='font-normal'>
            <Trans
              i18nKey={'landingPage.approve.alreadyApproved'}
              components={{
                user: (
                  <span className='font-bold text-text-primary'>
                    {requestInfo?.requester?.name || requestInfo?.requester?.email}
                  </span>
                ),
                view: <span className='font-bold text-text-primary underline'>{requestInfo?.view?.name}</span>,
              }}
            />
          </div>
        }
        primaryAction={{
          onClick: () => {
            if (!requestInfo?.workspace.id || !requestInfo?.view?.view_id) return;
            window.open(`/app/${requestInfo?.workspace.id}/${requestInfo?.view?.view_id}`, '_self');
          },
          label: t('landingPage.asGuest.viewPage'),
        }}
      />
    );
  }

  return (
    <>
      <LandingPage
        Logo={AvatarLogo}
        workspace={requestInfo?.workspace}
        title={
          <div className='font-normal'>
            <Trans
              i18nKey={'landingPage.asGuest.requestAccess'}
              components={{
                user: (
                  <span className='font-bold text-text-primary'>
                    {requestInfo?.requester?.name || requestInfo?.requester?.email}
                  </span>
                ),
                view: <span className='font-bold text-text-primary underline'>{`\n${requestInfo?.view?.name}`}</span>,
              }}
            />
          </div>
        }
        primaryAction={{
          onClick: handleApprove,
          label: t('landingPage.approve.requestApprove'),
        }}
        secondaryAction={{
          onClick: () => window.open('/app', '_self'),
          label: t('landingPage.backToHome'),
        }}
      />

      <NormalModal
        keepMounted={false}
        title={<div className={'text-left font-semibold'}>{t('upgradePlanModal.title')}</div>}
        okText={t('upgradePlanModal.actionButton')}
        cancelText={t('upgradePlanModal.laterButton')}
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        onOk={handleUpgrade}
      >
        <div className='py-3'>
          <p className='text-base text-text-secondary'>
            {t('upgradePlanModal.message', {
              name: requestInfo?.workspace.name,
            })}
          </p>
        </div>
      </NormalModal>

      <NormalModal
        onOk={() => setAlreadyProModalOpen(false)}
        keepMounted={false}
        title={
          <div className={'flex items-center gap-2 text-left font-semibold'}>
            <WarningIcon className={'h-6 w-6 text-function-info'} />
            {t('approveAccess.alreadyProTitle')}
          </div>
        }
        open={alreadyProModalOpen}
        onClose={() => setAlreadyProModalOpen(false)}
      >
        <div className={'flex flex-col'}>
          <span>
            <Trans
              i18nKey={'approveAccess.alreadyProMessage'}
              components={{
                email: (
                  <span
                    onClick={() => window.open(`mailto:support@appflowy.io`, '_blank')}
                    className={'cursor-pointer text-text-action underline'}
                  >
                    support@appflowy.io
                  </span>
                ),
              }}
            />
          </span>
        </div>
      </NormalModal>
    </>
  );
}

export default ApproveRequestPage;
