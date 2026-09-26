import { Button as MuiButton, Skeleton } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { BillingService } from '@/application/services/domains';
import {
  FeatureValue,
  PricingComparisonRow,
  PricingPlan,
  SubscriptionInterval,
  SubscriptionPlan,
} from '@/application/types';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { useCurrentWorkspaceId, useGetSubscriptions, useIsOfficialHosted } from '@/components/app/app.hooks';
import { usePricingCatalog } from '@/components/app/hooks/usePricingCatalog';
import CancelSubscribe from '@/components/billing/CancelSubscribe';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  PriceLabelParts,
  PricingTranslate,
  formatPriceCents,
  getPlanDisplayPrice,
  isFreePlan,
  localizeFeatureLabel,
  localizeFeatureTooltip,
  localizeFeatureValue,
  splitPriceTemplate,
  toSubscriptionPlan,
  workspacePlans,
} from '@/utils/pricing';
import { getProAccessPlanFromSubscriptions } from '@/utils/subscription';

type PlanAction = 'none' | 'upgrade' | 'downgrade';

interface SubscriptionState {
  workspaceId?: string;
  status: 'loading' | 'ready' | 'error';
  plan?: SubscriptionPlan;
}

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

// Layout and colors mirror the desktop compare dialog
// (settings_plan_comparison_dialog.dart): a 784px dialog, a 250px label column,
// 215px plan columns whose heading, price and button blocks are 116/116/56px
// tall, 36px rows, purple accents and a gradient border around the upgrade
// target. The app switches themes with `data-dark-mode=true` on the root
// element, so dark variants use that attribute rather than Tailwind's `dark:`.
const DIALOG_PAPER_CLASS = 'w-[784px] max-w-[96vw]';
const LABEL_COLUMN_CLASS = 'w-[250px] shrink-0 pt-[30px]';
const PLAN_COLUMN_CLASS = 'w-[215px] shrink-0 rounded-[24px]';
const HEADING_BLOCK_CLASS = 'h-[116px] w-[185px] overflow-hidden pl-3';
// Content of the highlighted column sits 12px further in, like the desktop.
const HIGHLIGHT_INSET_CLASS = 'pl-6';
const ROW_CLASS =
  'flex h-9 items-center gap-2 border-b border-border-primary px-3 text-sm font-medium text-text-primary';
const TITLE_CLASS = 'truncate text-2xl font-semibold leading-[30px]';
const NOTE_CLASS = 'mt-1 text-xs leading-[18px] text-text-secondary';
const ACCENT_TEXT_CLASS = 'text-[#5C3699] [[data-dark-mode=true]_&]:text-[#C49BEC]';
const HEADING_TEXT_CLASS = 'text-[#5C3699] [[data-dark-mode=true]_&]:text-[#E8E0FF]';
const ACCENT_GRADIENT_CLASS =
  'bg-[linear-gradient(90deg,#251D37,#7547C0)] [[data-dark-mode=true]_&]:bg-[linear-gradient(90deg,#7459AD,#DDC8FF)]';
const BUTTON_BORDER_GRADIENT_CLASS =
  'bg-[linear-gradient(21deg,#251D37_40%,#7547C0)] [[data-dark-mode=true]_&]:bg-[linear-gradient(21deg,#7459AD_40%,#DDC8FF)]';
// Light mode paints the label with the gradient like the desktop's shader mask; dark mode uses the accent color.
const BUTTON_LABEL_CLASS =
  'bg-[linear-gradient(1deg,#251D37_40%,#7547C0)] bg-clip-text text-transparent [[data-dark-mode=true]_&]:bg-none [[data-dark-mode=true]_&]:text-[#C49BEC]';
const CURRENT_BADGE_CLASS =
  'bg-[#4F3F5F] text-white [[data-dark-mode=true]_&]:bg-[#E8E0FF] [[data-dark-mode=true]_&]:text-black';

function UpgradeButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <div className={cn('rounded-[16px] p-[2px]', BUTTON_BORDER_GRADIENT_CLASS)}>
      <button
        type='button'
        onClick={onClick}
        data-testid={testId}
        className='flex h-9 w-[148px] items-center justify-center rounded-[14px] bg-surface-primary text-sm font-semibold hover:opacity-90'
      >
        <span className={BUTTON_LABEL_CLASS}>{label}</span>
      </button>
    </div>
  );
}

function DowngradeButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <div className='rounded-[16px] border border-[#333333] p-[2px]'>
      <button
        type='button'
        onClick={onClick}
        data-testid={testId}
        className='flex h-9 w-[148px] items-center justify-center rounded-[14px] text-sm font-medium text-text-primary hover:bg-fill-content-hover'
      >
        {label}
      </button>
    </div>
  );
}

function CurrentBadge({ label }: { label: string }) {
  return (
    <div className='flex h-[22px] pl-3'>
      <span
        className={cn(
          'flex h-[22px] w-[72px] items-center justify-center rounded-[4px] text-xs font-medium',
          CURRENT_BADGE_CLASS
        )}
        data-testid='current-plan-badge'
      >
        {label}
      </span>
    </div>
  );
}

/** The amount stands out; the rest of the localized template follows in a smaller size, as on the desktop. */
function PriceLabel({ parts, className }: { parts: PriceLabelParts; className: string }) {
  return (
    <div className={cn('line-clamp-2 leading-[30px]', className)} data-testid='plan-price'>
      {parts.prefix ? <span className='text-xs font-medium'>{parts.prefix}</span> : null}
      <span className='text-2xl font-semibold'>{parts.amount}</span>
      {parts.suffix ? <span className='text-xs font-medium'>{parts.suffix}</span> : null}
    </div>
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

function FeatureValueCell({ text, value, inset }: { text: string | null; value?: FeatureValue; inset: boolean }) {
  const className = cn(ROW_CLASS, inset && HIGHLIGHT_INSET_CLASS);

  if (!value || value.kind === 'excluded') {
    return <div className={className} data-testid='feature-excluded' />;
  }

  if (value.kind === 'included') {
    return (
      <div className={className} data-testid='feature-included'>
        <CheckIcon className='h-5 w-5 text-icon-primary' />
      </div>
    );
  }

  return <div className={className}>{text}</div>;
}

function UpgradePlan({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: () => void }) {
  const { t } = useTranslation();
  // Catalog keys are built at runtime, which the typed i18n resources cannot express.
  const translate = t as unknown as PricingTranslate;
  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState>({ status: 'loading' });
  const subscriptionRequest = useRef(0);
  const currentWorkspaceId = useCurrentWorkspaceId();
  const isHosted = useIsOfficialHosted();
  const [cancelOpen, setCancelOpen] = useState(false);
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
    const request = ++subscriptionRequest.current;

    setSubscriptionState({ workspaceId: currentWorkspaceId, status: 'loading' });
    try {
      if (!getSubscriptions) throw new Error('Subscription service is unavailable');
      const subscriptions = await getSubscriptions();

      if (!subscriptions) throw new Error('Subscription data is unavailable');
      if (subscriptionRequest.current !== request) return;

      setSubscriptionState({
        workspaceId: currentWorkspaceId,
        status: 'ready',
        plan: getProAccessPlanFromSubscriptions(subscriptions),
      });
    } catch (e) {
      if (subscriptionRequest.current !== request) return;
      setSubscriptionState({ workspaceId: currentWorkspaceId, status: 'error' });
      console.error(e);
    }
  }, [currentWorkspaceId, getSubscriptions]);

  const currentPlan =
    subscriptionState.workspaceId === currentWorkspaceId && subscriptionState.status === 'ready'
      ? subscriptionState.plan
      : undefined;
  const subscriptionHasError =
    subscriptionState.workspaceId === currentWorkspaceId && subscriptionState.status === 'error';

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
      if (!currentWorkspaceId || !currentPlan) return;

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
    [currentWorkspaceId, currentPlan, isHosted]
  );

  useEffect(() => {
    if (open) {
      void loadSubscription();
    }

    return () => {
      // A closed dialog or a different workspace must not receive an older request's result.
      subscriptionRequest.current += 1;
    };
  }, [open, loadSubscription]);

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
        name: plan.name,
        description: plan.description,
        price: splitPriceTemplate(
          t(free ? 'settings.comparePlanDialog.freePlan.price' : 'settings.comparePlanDialog.proPlan.price'),
          amount
        ),
        priceInfo,
        action: actionType,
        isCurrent: plan.id === currentPlan,
        highlighted: actionType === 'upgrade',
      };
    });
  }, [catalog, currentPlan, isHosted, t]);

  // Billing owns the feature order; keep labels and plan values in its array order.
  const rows: PricingComparisonRow[] = catalog?.comparison ?? [];

  return (
    <NormalModal
      open={open}
      onClose={handleClose}
      title={
        <span className='block text-left text-2xl font-semibold text-text-primary'>
          {t('subscribe.upgradePlanTitle')}
        </span>
      }
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
      <div className={'flex w-full flex-col'}>
        {isHosted && subscriptionHasError ? (
          <div role='alert' className='mb-4 flex flex-col items-start gap-3' data-testid='subscription-error'>
            <div className='text-text-secondary'>{t('subscribe.subscriptionUnavailable')}</div>
            <MuiButton variant='outlined' color='inherit' onClick={() => void loadSubscription()}>
              {t('button.retry')}
            </MuiButton>
          </div>
        ) : isHosted && !currentPlan ? (
          <div
            role='status'
            className='mb-4 flex items-center gap-2 text-text-secondary'
            data-testid='subscription-loading'
          >
            <Progress variant='primary' />
            {t('loading')}
          </div>
        ) : null}
        {!catalog && isLoading ? (
          <div className={'flex w-full gap-2'} data-testid={'pricing-skeleton'}>
            <Skeleton variant={'rounded'} width={250} height={480} />
            <Skeleton variant={'rounded'} width={215} height={480} />
            <Skeleton variant={'rounded'} width={215} height={480} />
          </div>
        ) : !catalog && hasError ? (
          <div className={'flex flex-col items-start gap-3'} data-testid={'pricing-error'}>
            <div className={'text-text-secondary'}>{t('subscribe.pricingUnavailable')}</div>
            <MuiButton variant={'outlined'} color={'inherit'} onClick={() => void reload()}>
              {t('button.retry')}
            </MuiButton>
          </div>
        ) : (
          <div className={'flex w-full items-start justify-start overflow-x-auto'} data-testid={'plan-comparison'}>
            <div className={LABEL_COLUMN_CLASS}>
              <div
                className={cn(
                  'line-clamp-2 h-[116px] whitespace-pre-line text-2xl font-semibold leading-[30px]',
                  HEADING_TEXT_CLASS
                )}
              >
                {t('settings.comparePlanDialog.planFeatures')}
              </div>
              <div className='h-[116px]' />
              <div className='h-14' />
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
                className={cn(PLAN_COLUMN_CLASS, highlighted ? cn('p-1', ACCENT_GRADIENT_CLASS) : 'pt-1')}
              >
                {/* The badge replaces the top padding so every column's title starts 30px down, like the label column. */}
                <div className={cn('rounded-[22px] bg-surface-primary', isCurrent ? 'pb-[22px]' : 'py-[22px]')}>
                  {isCurrent && <CurrentBadge label={t('settings.comparePlanDialog.current')} />}
                  <div className='h-1' />
                  <div className={cn(HEADING_BLOCK_CLASS, highlighted && HIGHLIGHT_INSET_CLASS)}>
                    <div className={cn(TITLE_CLASS, highlighted ? ACCENT_TEXT_CLASS : 'text-text-primary')}>{name}</div>
                    <div className={cn(NOTE_CLASS, 'line-clamp-4')}>{description}</div>
                  </div>
                  <div className={cn(HEADING_BLOCK_CLASS, highlighted && HIGHLIGHT_INSET_CLASS)}>
                    <PriceLabel parts={price} className={highlighted ? ACCENT_TEXT_CLASS : 'text-text-primary'} />
                    {priceInfo && <div className={NOTE_CLASS}>{priceInfo}</div>}
                  </div>
                  <div className={cn('flex h-14 items-center pl-3', highlighted && HIGHLIGHT_INSET_CLASS)}>
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
                  {rows.map((row) => {
                    const value = row.values[plan.id];

                    return (
                      <FeatureValueCell
                        key={row.key}
                        value={value}
                        text={value ? localizeFeatureValue(translate, value) : null}
                        inset={highlighted}
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
