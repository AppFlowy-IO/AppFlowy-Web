import { Button } from '@mui/material';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { Subscription, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import CancelSubscribe from '@/components/billing/CancelSubscribe';
import { useService } from '@/components/main/app.hooks';
import { isAppFlowyHosted } from '@/utils/subscription';

function UpgradePlan({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: () => void }) {
  const { t } = useTranslation();
  const [activeSubscription, setActiveSubscription] = React.useState<Subscription | null>(null);
  const service = useService();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const { getSubscriptions } = useAppHandlers();

  const [search, setSearch] = useSearchParams();
  const action = search.get('action');

  useEffect(() => {
    if (!open && action === 'change_plan') {
      onOpen();
    }

    if (open) {
      setSearch((prev) => {
        prev.set('action', 'change_plan');
        return prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, open, setSearch]);

  const loadSubscription = useCallback(async () => {
    try {
      const subscriptions = await getSubscriptions?.();

      if (!subscriptions || subscriptions.length === 0) {
        setActiveSubscription({
          plan: SubscriptionPlan.Free,
          currency: '',
          recurring_interval: SubscriptionInterval.Month,
          price_cents: 0,
        });
        return;
      }

      const subscription = subscriptions[0];

      setActiveSubscription(subscription);
    } catch (e) {
      console.error(e);
    }
  }, [getSubscriptions]);

  const handleClose = useCallback(() => {
    onClose();
    setSearch((prev) => {
      prev.delete('action');
      return prev;
    });
  }, [onClose, setSearch]);
  const [interval, setInterval] = React.useState<SubscriptionInterval>(SubscriptionInterval.Year);

  const handleUpgrade = useCallback(async () => {
    if (!service || !currentWorkspaceId) return;

    if (!isAppFlowyHosted()) {
      // Self-hosted instances have Pro features enabled by default
      return;
    }

    const plan = SubscriptionPlan.Pro;

    try {
      const link = await service.getSubscriptionLink(currentWorkspaceId, plan, interval);

      window.open(link, '_current');
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    }
  }, [currentWorkspaceId, service, interval]);

  useEffect(() => {
    if (open) {
      void loadSubscription();
    }
  }, [open, loadSubscription]);

  const plans = useMemo(() => {
    const allPlans = [
      {
        key: SubscriptionPlan.Free,
        name: t('subscribe.free'),
        price: 'Free',
        description: t('subscribe.freeDescription'),
        duration: t('subscribe.freeDuration'),
        points: [
          t('subscribe.freePoints.first'),
          t('subscribe.freePoints.second'),
          t('subscribe.freePoints.three'),
          t('subscribe.freePoints.four'),
          t('subscribe.freePoints.five'),
          t('subscribe.freePoints.six'),
          t('subscribe.freePoints.seven'),
          t('subscribe.freePoints.eight'),
        ],
      },
      {
        key: SubscriptionPlan.Pro,
        name: t('subscribe.pro'),
        price: interval === SubscriptionInterval.Month ? '$12.5' : '$10',
        description: t('subscribe.proDescription'),
        duration:
          interval === SubscriptionInterval.Month
            ? t('subscribe.proDuration.monthly')
            : t('subscribe.proDuration.yearly'),
        points: [
          t('subscribe.proPoints.first'),
          t('subscribe.proPoints.second'),
          t('subscribe.proPoints.three'),
          t('subscribe.proPoints.four'),
          t('subscribe.proPoints.five'),
          t('subscribe.proPoints.six'),
        ],
      },
    ];

    // Filter out Pro plan if not on official host (self-hosted instances don't need subscription)
    if (!isAppFlowyHosted()) {
      return allPlans.filter((plan) => plan.key !== SubscriptionPlan.Pro);
    }

    return allPlans;
  }, [t, interval]);

  return (
    <NormalModal
      open={open}
      onClose={handleClose}
      title={t('subscribe.upgradePlanTitle')}
      disableRestoreFocus={true}
      cancelButtonProps={{
        className: 'hidden',
      }}
      okButtonProps={{
        className: 'hidden',
      }}
      slotProps={{
        root: {
          className: 'min-w-[500px] max-w-full max-h-full',
        },
      }}
    >
      <div className={'flex w-full flex-col gap-4 p-4'}>
        <div className={'flex items-center justify-between gap-4'}>
          <ViewTabs
            indicatorColor={'secondary'}
            value={interval}
            onChange={(_, v) => {
              setInterval(v);
            }}
          >
            <ViewTab
              label={`${t('subscribe.yearly')} ${t('subscribe.save', {
                discount: 20,
              })}`}
              value={SubscriptionInterval.Year}
            />
            <ViewTab label={t('subscribe.monthly')} value={SubscriptionInterval.Month} />
          </ViewTabs>
          <div className={'flex items-center justify-end'}>
            {t('subscribe.priceIn')}
            <span className={'ml-1.5 font-medium'}>{`$USD`}</span>
          </div>
        </div>

        <div className={'flex w-full gap-4 overflow-auto'}>
          {plans.map((plan) => {
            return (
              <div
                key={plan.key}
                style={{
                  borderColor: activeSubscription?.plan === plan.key ? 'var(--billing-primary)' : undefined,
                }}
                className={'relative flex flex-col gap-2 rounded-[16px] border border-border-primary p-4'}
              >
                {activeSubscription?.plan === plan.key && (
                  <div
                    className={
                      'absolute right-0 top-0 rounded-[14px] rounded-br-none rounded-tl-none bg-billing-primary p-2 text-xs text-content-on-fill'
                    }
                  >
                    {t('subscribe.currentPlan')}
                  </div>
                )}
                <div className={'font-medium'}>{plan.name}</div>
                <div className={'text-sm text-text-secondary'}>{plan.description}</div>
                <div className={'text-lg'}>{plan.price}</div>
                <div className={'whitespace-pre-wrap text-text-secondary'}>{plan.duration}</div>

                {plan.key === SubscriptionPlan.Pro ? (
                  <div className={'flex flex-col gap-2'}>
                    {activeSubscription?.plan !== plan.key && (
                      <Button color={'secondary'} onClick={handleUpgrade} variant={'contained'}>
                        {t('subscribe.changePlan')}
                      </Button>
                    )}
                    <span className={'font-medium'}>{t('subscribe.everythingInFree')}</span>
                  </div>
                ) : (
                  activeSubscription?.plan !== plan.key && (
                    <Button
                      onClick={() => {
                        setCancelOpen(true);
                      }}
                      variant={'outlined'}
                      color={'inherit'}
                    >
                      {t('subscribe.cancel')}
                    </Button>
                  )
                )}
                <div className={'flex flex-col gap-2'}>
                  {plan.points.map((point, index) => {
                    return (
                      <div key={index} className={'flex items-start gap-2'}>
                        <div className={'flex h-6 items-center'}>
                          <div className={'h-2 w-2 rounded-full bg-billing-primary'} />
                        </div>
                        <div className={''}>{point}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <CancelSubscribe
        onCanceled={loadSubscription}
        open={cancelOpen}
        onClose={() => {
          setCancelOpen(false);
        }}
      />
    </NormalModal>
  );
}

export default UpgradePlan;
