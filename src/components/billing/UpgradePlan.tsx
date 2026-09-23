import { Button as MuiButton, Skeleton } from '@mui/material';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { BillingService } from '@/application/services/domains';
import {
  FeatureValue,
  PricingComparisonRow,
  PricingPlan,
  Subscription,
  SubscriptionInterval,
  SubscriptionPlan,
} from '@/application/types';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { useCurrentWorkspaceId, useGetSubscriptions, useIsOfficialHosted } from '@/components/app/app.hooks';
import { usePricingCatalog } from '@/components/app/hooks/usePricingCatalog';
import { fillPlaceholders } from '@/components/app/settings/billing/labels';
import CancelSubscribe from '@/components/billing/CancelSubscribe';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  PricingTranslate,
  formatPriceCents,
  getPlanDisplayPrice,
  isFreePlan,
  localizeFeatureLabel,
  localizeFeatureTooltip,
  localizeFeatureValue,
  localizePlanDescription,
  localizePlanName,
  toSubscriptionPlan,
  workspacePlans,
} from '@/utils/pricing';

type PlanAction = 'none' | 'upgrade' | 'downgrade';

/**
 * Mirrors the desktop compare dialog: the current plan gets no action, Free is
 * a downgrade from a paid plan, and every other plan is an upgrade. The
 * upgrade target is the highlighted column.
 */
function planActionFor(planId: string, currentPlan: SubscriptionPlan | undefined): PlanAction {
  if (!currentPlan || planId === currentPlan) return 'none';
  if (planId === SubscriptionPlan.Free) return 'downgrade';

  return 'upgrade';
}

// Colors and dimensions follow the desktop compare dialog
// (settings_plan_comparison_dialog.dart): purple accents with light/dark variants,
// a gradient border around the upgrade target, 36px rows and a 784px-wide dialog.
const DIALOG_PAPER_CLASS = 'w-[820px] max-w-[96vw]';
const LABEL_COLUMN_CLASS = 'w-[220px] shrink-0';
const PLAN_COLUMN_CLASS = 'w-[236px] shrink-0';
const HEADER_CLASS = 'flex h-[320px] flex-col px-3 pt-2';
const ROW_CLASS =
  'flex h-9 items-center gap-2 border-b border-border-primary px-3 text-sm font-medium text-text-primary';
const ACCENT_TEXT_CLASS = 'text-[#5C3699] dark:text-[#C49BEC]';
const HEADING_TEXT_CLASS = 'text-[#5C3699] dark:text-[#E8E0FF]';
const ACCENT_GRADIENT_CLASS =
  'bg-[linear-gradient(90deg,#251D37,#7547C0)] dark:bg-[linear-gradient(90deg,#7459AD,#DDC8FF)]';
const BUTTON_GRADIENT_CLASS =
  'bg-[linear-gradient(135deg,#251D37_40%,#7547C0)] dark:bg-[linear-gradient(135deg,#7459AD_40%,#DDC8FF)]';
const CURRENT_BADGE_CLASS = 'bg-[#4F3F5F] text-white dark:bg-[#E8E0FF] dark:text-black';

function UpgradeButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <div className={cn('rounded-[16px] p-[2px]', BUTTON_GRADIENT_CLASS)}>
      <button
        type='button'
        onClick={onClick}
        data-testid={testId}
        className='flex h-9 w-[148px] items-center justify-center rounded-[14px] bg-surface-primary text-sm font-semibold hover:opacity-90'
      >
        {/* Light mode paints the label with the gradient like the desktop's shader mask; dark mode uses the accent color. */}
        <span className={cn('bg-clip-text text-transparent', BUTTON_GRADIENT_CLASS, 'dark:bg-none dark:text-[#C49BEC]')}>
          {label}
        </span>
      </button>
    </div>
  );
}

function DowngradeButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <button
      type='button'
      onClick={onClick}
      data-testid={testId}
      className='flex h-9 w-[148px] items-center justify-center rounded-[16px] border border-[#333333] text-sm font-medium text-text-primary hover:bg-fill-content-hover dark:border-border-primary'
    >
      {label}
    </button>
  );
}

function FeatureLabelCell({ label, tooltip }: { label: string; tooltip: string | null }) {
  return (
    <div className={ROW_CLASS}>
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {tooltip && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='flex items-center' aria-label={tooltip}>
                <InfoIcon className='h-4 w-4 text-icon-secondary' />
              </span>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function FeatureValueCell({ text, value }: { text: string | null; value?: FeatureValue }) {
  if (!value || value.kind === 'excluded') {
    return <div className={ROW_CLASS} data-testid='feature-excluded' />;
  }

  if (value.kind === 'included') {
    return (
      <div className={ROW_CLASS} data-testid='feature-included'>
        <CheckIcon className='h-5 w-5 text-icon-primary' />
      </div>
    );
  }

  return <div className={ROW_CLASS}>{text}</div>;
}

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
      const proSubscription = subscriptions?.find(
        (item) => item.plan === SubscriptionPlan.Pro || item.plan === SubscriptionPlan.Team
      );

      if (proSubscription) {
        setActiveSubscription({ ...proSubscription, plan: SubscriptionPlan.Pro });
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

  // Checkout is yearly like the desktop client; the billing period can be changed afterwards in Settings.
  const handleUpgrade = useCallback(
    async (planId: string) => {
      if (!currentWorkspaceId) return;

      // Self-hosted deployments have Pro features enabled by default.
      if (!isHosted) return;

      const plan = toSubscriptionPlan(planId);

      if (!plan) return;

      try {
        const link = await BillingService.getSubscriptionLink(currentWorkspaceId, plan, SubscriptionInterval.Year);

        window.open(link, '_current');
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    },
    [currentWorkspaceId, isHosted]
  );

  useEffect(() => {
    if (open) {
      void loadSubscription();
    }
  }, [open, loadSubscription]);

  const currentPlan = activeSubscription?.plan;

  const columns = useMemo(() => {
    if (!catalog) return [];

    const plans: PricingPlan[] = workspacePlans(catalog);
    // Self-hosted instances have Pro features enabled by default; paid plans are not offered.
    const offered = isHosted ? plans : plans.filter((plan) => isFreePlan(plan));

    return offered.map((plan) => {
      const free = isFreePlan(plan);
      const yearly = getPlanDisplayPrice(plan, SubscriptionInterval.Year);
      const monthly = getPlanDisplayPrice(plan, SubscriptionInterval.Month);
      // The published plan table shows only the annual figure ("billed annually");
      // the monthly price stays under Billing > Edit period. An empty info hides the line.
      const priceInfo = free
        ? t('settings.comparePlanDialog.freePlan.priceInfo')
        : yearly
        ? t('settings.comparePlanDialog.proPlan.priceInfo')
        : t('subscribe.proDuration.monthly');
      const amount = free ? formatPriceCents(0) : yearly ?? monthly ?? '';
      const actionType = planActionFor(plan.id, currentPlan);

      return {
        plan,
        name: localizePlanName(translate, plan),
        description: localizePlanDescription(translate, plan),
        price: fillPlaceholders(
          t(free ? 'settings.comparePlanDialog.freePlan.price' : 'settings.comparePlanDialog.proPlan.price'),
          amount
        ),
        priceInfo,
        action: actionType,
        isCurrent: plan.id === currentPlan,
        highlighted: actionType === 'upgrade',
      };
    });
  }, [catalog, currentPlan, isHosted, t, translate]);

  const rows: PricingComparisonRow[] = catalog?.comparison ?? [];

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
      maxWidth={false}
      classes={{ paper: DIALOG_PAPER_CLASS }}
    >
      <div className={'flex w-full flex-col gap-4 p-4'}>
        {!catalog && isLoading ? (
          <div className={'flex w-full gap-4'} data-testid={'pricing-skeleton'}>
            <Skeleton variant={'rounded'} width={220} height={480} />
            <Skeleton variant={'rounded'} width={236} height={480} />
            <Skeleton variant={'rounded'} width={236} height={480} />
          </div>
        ) : !catalog && hasError ? (
          <div className={'flex flex-col items-start gap-3'} data-testid={'pricing-error'}>
            <div className={'text-text-secondary'}>{t('subscribe.pricingUnavailable')}</div>
            <MuiButton variant={'outlined'} color={'inherit'} onClick={() => void reload()}>
              {t('button.retry')}
            </MuiButton>
          </div>
        ) : (
          <div className={'flex w-full items-start justify-start gap-2 overflow-x-auto'} data-testid={'plan-comparison'}>
            <div className={LABEL_COLUMN_CLASS}>
              <div className={cn(HEADER_CLASS, 'pt-8')}>
                <div className={cn('whitespace-pre-line text-2xl font-semibold', HEADING_TEXT_CLASS)}>
                  {t('settings.comparePlanDialog.planFeatures')}
                </div>
              </div>
              {rows.map((row) => (
                <FeatureLabelCell
                  key={row.key}
                  label={localizeFeatureLabel(translate, row.key, row.label)}
                  tooltip={localizeFeatureTooltip(translate, row.key, row.tooltip)}
                />
              ))}
            </div>

            {columns.map(({ plan, name, description, price, priceInfo, action: planAction, isCurrent, highlighted }) => (
              <div
                key={plan.id}
                data-testid={`pricing-plan-${plan.id}`}
                data-highlighted={highlighted}
                className={cn(PLAN_COLUMN_CLASS, 'rounded-[24px] p-1', highlighted && ACCENT_GRADIENT_CLASS)}
              >
                <div className={cn('rounded-[22px] bg-surface-primary', highlighted && 'pb-2')}>
                  <div className={HEADER_CLASS}>
                    <div className='h-7'>
                      {isCurrent && (
                        <span
                          className={cn(
                            'inline-flex h-[22px] w-[72px] items-center justify-center rounded-[4px] text-xs font-medium',
                            CURRENT_BADGE_CLASS
                          )}
                          data-testid='current-plan-badge'
                        >
                          {t('settings.comparePlanDialog.current')}
                        </span>
                      )}
                    </div>
                    <div className={cn('text-2xl font-semibold', highlighted ? ACCENT_TEXT_CLASS : 'text-text-primary')}>
                      {name}
                    </div>
                    <div className='mt-1 line-clamp-3 text-sm leading-5 text-text-secondary'>{description}</div>
                    <div
                      className={cn(
                        'mt-5 text-2xl font-semibold',
                        highlighted ? ACCENT_TEXT_CLASS : 'text-text-primary'
                      )}
                    >
                      {price}
                    </div>
                    {priceInfo && (
                      <div className='mt-1 whitespace-pre-line text-sm leading-5 text-text-secondary'>{priceInfo}</div>
                    )}
                    <div className='mt-auto flex h-14 items-center'>
                      {planAction === 'upgrade' && (
                        <UpgradeButton
                          label={t('settings.comparePlanDialog.actions.upgrade')}
                          onClick={() => void handleUpgrade(plan.id)}
                          testId={`pricing-upgrade-${plan.id}`}
                        />
                      )}
                      {planAction === 'downgrade' && (
                        <DowngradeButton
                          label={t('settings.comparePlanDialog.actions.downgrade')}
                          onClick={() => setCancelOpen(true)}
                          testId={`pricing-downgrade-${plan.id}`}
                        />
                      )}
                    </div>
                  </div>
                  {rows.map((row) => {
                    const value = row.values[plan.id];

                    return (
                      <FeatureValueCell
                        key={row.key}
                        value={value}
                        text={value ? localizeFeatureValue(translate, value) : null}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
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
