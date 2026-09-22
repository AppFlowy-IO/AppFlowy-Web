import { Button, Skeleton } from '@mui/material';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { BillingService } from '@/application/services/domains';
import { Subscription, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { useCurrentWorkspaceId, useGetSubscriptions, useIsOfficialHosted } from '@/components/app/app.hooks';
import { usePricingCatalog } from '@/components/app/hooks/usePricingCatalog';
import CancelSubscribe from '@/components/billing/CancelSubscribe';
import {
  PricingTranslate,
  formatFeatureBullet,
  getPlanDisplayPrice,
  isFreePlan,
  localizePlanDescription,
  localizePlanName,
  toSubscriptionPlan,
  workspacePlans,
} from '@/utils/pricing';

function UpgradePlan({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: () => void }) {
  const { t } = useTranslation();
  // Catalog keys are built at runtime, which the typed i18n resources cannot express.
  const translate = t as unknown as PricingTranslate;
  const [activeSubscription, setActiveSubscription] = React.useState<Subscription | null>(null);
  const currentWorkspaceId = useCurrentWorkspaceId();
  const isHosted = useIsOfficialHosted();
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const getSubscriptions = useGetSubscriptions();
  const { catalog, isLoading, hasError, reload } = usePricingCatalog({ enabled: open });

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

      const proSubscription = subscriptions.find(
        (item) => item.plan === SubscriptionPlan.Pro || item.plan === SubscriptionPlan.Team
      );

      if (proSubscription) {
        setActiveSubscription({
          ...proSubscription,
          plan: SubscriptionPlan.Pro,
        });
        return;
      }

      setActiveSubscription({
        plan: SubscriptionPlan.Free,
        currency: '',
        recurring_interval: SubscriptionInterval.Month,
        price_cents: 0,
      });
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

  const handleUpgrade = useCallback(
    async (planId: string) => {
      if (!currentWorkspaceId) return;

      // Self-hosted deployments have Pro features enabled by default.
      if (!isHosted) return;

      const plan = toSubscriptionPlan(planId);

      if (!plan) return;

      try {
        const link = await BillingService.getSubscriptionLink(currentWorkspaceId, plan, interval);

        window.open(link, '_current');
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    },
    [currentWorkspaceId, interval, isHosted]
  );

  useEffect(() => {
    if (open) {
      void loadSubscription();
    }
  }, [open, loadSubscription]);

  const plans = useMemo(() => {
    if (!catalog) return [];

    const cards = workspacePlans(catalog).map((plan) => {
      const free = isFreePlan(plan);

      return {
        key: plan.id,
        isFree: free,
        name: localizePlanName(translate, plan),
        description: localizePlanDescription(translate, plan),
        price: free ? t('subscribe.free') : getPlanDisplayPrice(plan, interval) ?? '',
        duration: free
          ? t('subscribe.freeDuration')
          : interval === SubscriptionInterval.Month
          ? t('subscribe.proDuration.monthly')
          : t('subscribe.proDuration.yearly'),
        points: plan.features
          .map((feature) => formatFeatureBullet(translate, feature))
          .filter((point): point is string => Boolean(point)),
      };
    });

    // Self-hosted instances have Pro features enabled by default; paid plans are not offered.
    return isHosted ? cards : cards.filter((card) => card.isFree);
  }, [catalog, interval, isHosted, t, translate]);

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
              label={
                catalog
                  ? `${t('subscribe.yearly')} ${t('subscribe.save', {
                      discount: catalog.annual_discount_percent,
                    })}`
                  : t('subscribe.yearly')
              }
              value={SubscriptionInterval.Year}
            />
            <ViewTab label={t('subscribe.monthly')} value={SubscriptionInterval.Month} />
          </ViewTabs>
          <div className={'flex items-center justify-end'}>
            {t('subscribe.priceIn')}
            <span className={'ml-1.5 font-medium'}>{`$${catalog?.currency ?? 'USD'}`}</span>
          </div>
        </div>

        {!catalog && isLoading ? (
          <div className={'flex w-full gap-4'} data-testid={'pricing-skeleton'}>
            <Skeleton variant={'rounded'} width={240} height={360} />
            <Skeleton variant={'rounded'} width={240} height={360} />
          </div>
        ) : !catalog && hasError ? (
          <div className={'flex flex-col items-start gap-3'} data-testid={'pricing-error'}>
            <div className={'text-text-secondary'}>{t('subscribe.pricingUnavailable')}</div>
            <Button variant={'outlined'} color={'inherit'} onClick={() => void reload()}>
              {t('button.retry')}
            </Button>
          </div>
        ) : (
          <div className={'flex w-full gap-4 overflow-auto'}>
            {plans.map((plan) => {
              return (
                <div
                  key={plan.key}
                  data-testid={`pricing-plan-${plan.key}`}
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

                  {!plan.isFree ? (
                    <div className={'flex flex-col gap-2'}>
                      {activeSubscription?.plan !== plan.key && (
                        <Button color={'secondary'} onClick={() => void handleUpgrade(plan.key)} variant={'contained'}>
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
        )}
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
