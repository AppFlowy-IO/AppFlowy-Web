import { Skeleton } from '@mui/material';
import { ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { SubscriptionInterval, SubscriptionPlan, WorkspaceUsageAndLimit } from '@/application/types';
import { ReactComponent as CheckCircleIcon } from '@/assets/icons/check_circle.svg';
import { usePricingCatalog } from '@/components/app/hooks/usePricingCatalog';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { findPlan, getPlanDisplayPrice } from '@/utils/pricing';
import { findWorkspaceAddOn, formatStorageGb, isSubscriptionCanceled } from '@/utils/subscription';

import { AddOnBox } from './billing/AddOnBox';
import { fillPlaceholders, formatPeriodEnd, userDateFormat } from './billing/labels';
import {
  SettingsPanelError,
  SettingsPanelLoading,
  SettingsPanelShell,
  SettingsSection,
} from './billing/SettingsPanelShell';
import { useWorkspaceBilling } from './billing/useWorkspaceBilling';

function UsageBox({
  title,
  unlimited,
  unlimitedLabel,
  label,
  ratio,
  testId,
}: {
  title: string;
  unlimited: boolean;
  unlimitedLabel: string;
  label: string;
  ratio: number;
  testId: string;
}) {
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);

  return (
    <div className='flex flex-1 flex-col gap-2' data-testid={testId}>
      <div className='text-xs font-medium text-text-secondary'>{title}</div>
      {unlimited ? (
        <div className='flex items-center gap-1 text-xs font-medium text-text-primary'>
          <CheckCircleIcon className='h-4 w-4 text-fill-theme-thick' />
          <span>{unlimitedLabel}</span>
        </div>
      ) : (
        <div className='flex flex-col gap-1'>
          <div
            className='h-1.5 w-full overflow-hidden rounded-full bg-fill-secondary'
            role='progressbar'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className='h-full rounded-full bg-fill-theme-thick' style={{ width: `${percent}%` }} />
          </div>
          <div className='text-xs text-text-secondary'>{label}</div>
        </div>
      )}
    </div>
  );
}

function UpgradeToggle({ label, badge, onToggle, testId }: { label: string; badge: string; onToggle: () => void; testId: string }) {
  return (
    <div className='flex items-center gap-3' data-testid={testId}>
      <Switch checked={false} onCheckedChange={onToggle} aria-label={label} />
      <span className='text-sm text-text-primary'>{label}</span>
      <span className='rounded-[6px] bg-fill-theme-thick px-1.5 text-[11px] font-medium text-text-on-fill'>{badge}</span>
    </div>
  );
}

function usageRatio(used: number, limit: number): number {
  return limit > 0 ? used / limit : 0;
}

/** Settings > Plan: usage summary, current plan and purchasable add-ons, mirroring the desktop page. */
export function PlanPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const [, setSearch] = useSearchParams();
  const currentUser = useCurrentUserOptional();
  const dateFormat = userDateFormat(currentUser?.metadata);
  const billing = useWorkspaceBilling(workspaceId);
  const catalogState = usePricingCatalog();
  const { info, usage, status, error, reload } = billing;

  const openChangePlan = useCallback(() => {
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [setSearch]);

  const planTitle = (plan: SubscriptionPlan) => {
    switch (plan) {
      case SubscriptionPlan.Pro:
        return t('settings.planPage.planUsage.currentPlan.proTitle');
      case SubscriptionPlan.Team:
        return t('settings.planPage.planUsage.currentPlan.teamTitle');
      default:
        return t('settings.planPage.planUsage.currentPlan.freeTitle');
    }
  };

  const planInfo = (plan: SubscriptionPlan) => {
    switch (plan) {
      case SubscriptionPlan.Pro:
        return t('settings.planPage.planUsage.currentPlan.proInfo');
      case SubscriptionPlan.Team:
        return t('settings.planPage.planUsage.currentPlan.teamInfo');
      default:
        return t('settings.planPage.planUsage.currentPlan.freeInfo');
    }
  };

  const renderUsage = (current: WorkspaceUsageAndLimit) => (
    <div className='flex gap-6'>
      <UsageBox
        title={t('settings.planPage.planUsage.storageLabel')}
        unlimited={current.storage_bytes_unlimited}
        unlimitedLabel={t('settings.planPage.planUsage.unlimitedStorageLabel')}
        label={fillPlaceholders(
          t('settings.planPage.planUsage.storageUsage'),
          formatStorageGb(current.storage_bytes),
          formatStorageGb(current.storage_bytes_limit)
        )}
        ratio={usageRatio(current.storage_bytes, current.storage_bytes_limit)}
        testId='plan-usage-storage'
      />
      <UsageBox
        title={t('settings.planPage.planUsage.aiResponseLabel')}
        unlimited={current.ai_responses_unlimited}
        unlimitedLabel={t('settings.planPage.planUsage.unlimitedAILabel')}
        label={fillPlaceholders(
          t('settings.planPage.planUsage.aiResponseUsage'),
          String(current.ai_responses_count),
          String(current.ai_responses_count_limit)
        )}
        ratio={usageRatio(current.ai_responses_count, current.ai_responses_count_limit)}
        testId='plan-usage-ai'
      />
    </div>
  );

  const renderAddOns = (render: (priceFor: (planId: string) => string | null) => ReactNode) => {
    const { catalog, isLoading, hasError } = catalogState;

    if (!catalog && isLoading) {
      return (
        <div className='flex gap-4' data-testid='pricing-skeleton'>
          <Skeleton variant='rounded' width={280} height={180} />
        </div>
      );
    }

    if (!catalog && hasError) {
      return (
        <div className='flex flex-col items-start gap-3' data-testid='pricing-error'>
          <div className='text-sm text-text-secondary'>{t('subscribe.pricingUnavailable')}</div>
          <Button variant='outline' size='default' onClick={() => void catalogState.reload()}>
            {t('button.retry')}
          </Button>
        </div>
      );
    }

    return render((planId) => {
      const plan = catalog ? findPlan(catalog, planId) : undefined;

      return plan ? getPlanDisplayPrice(plan, SubscriptionInterval.Year) : null;
    });
  };

  const renderContent = () => {
    if (status === 'error') return <SettingsPanelError error={error} onRetry={() => void reload()} />;
    if (!info || !usage) return <SettingsPanelLoading label={t('settings.planPage.title')} />;

    const hasAiMax = findWorkspaceAddOn(info, SubscriptionPlan.AIMax) !== null;
    const canceled = info.subscription && isSubscriptionCanceled(info.subscription);

    return (
      <>
        <div className='flex flex-col gap-4'>
          <div className='text-base font-semibold text-text-secondary'>{t('settings.planPage.planUsage.title')}</div>
          {renderUsage(usage)}
          <div className='flex flex-col gap-2'>
            {info.plan === SubscriptionPlan.Free && (
              <UpgradeToggle
                label={t('settings.planPage.planUsage.memberProToggle')}
                badge={t('settings.planPage.planUsage.proBadge')}
                onToggle={() => void billing.subscribeWorkspace(SubscriptionPlan.Pro)}
                testId='plan-toggle-pro'
              />
            )}
            {!hasAiMax && !usage.ai_responses_unlimited && (
              <UpgradeToggle
                label={t('settings.planPage.planUsage.aiMaxToggle')}
                badge={t('settings.planPage.planUsage.aiMaxBadge')}
                onToggle={() => void billing.subscribeWorkspace(SubscriptionPlan.AIMax)}
                testId='plan-toggle-ai-max'
              />
            )}
          </div>
        </div>

        <div className='relative rounded-[16px] border border-border-primary p-4 pt-6' data-testid='current-plan-box'>
          <span className='absolute left-4 top-0 -translate-y-1/2 rounded-[6px] bg-fill-theme-thick px-2 py-0.5 text-[11px] font-medium text-text-on-fill'>
            {t('settings.planPage.planUsage.currentPlan.bannerLabel')}
          </span>
          <div className='flex items-start justify-between gap-6'>
            <div className='flex flex-col gap-2'>
              <div className='text-2xl font-semibold text-text-primary'>{planTitle(info.plan)}</div>
              <div className='text-sm text-text-primary'>{planInfo(info.plan)}</div>
            </div>
            <Button variant='default' size='lg' className='shrink-0' onClick={openChangePlan} data-testid='plan-change-plan'>
              {t('settings.planPage.planUsage.currentPlan.upgrade')}
            </Button>
          </div>
          {canceled && info.subscription && (
            <div className='mt-3 text-xs text-text-error'>
              {fillPlaceholders(
                t('settings.planPage.planUsage.currentPlan.canceledInfo'),
                formatPeriodEnd(info.subscription.current_period_end, dateFormat)
              )}
            </div>
          )}
        </div>

        <SettingsSection
          title={t('settings.planPage.planUsage.addons.title')}
          tooltip={t('settings.planPage.planUsage.addons.tooltip')}
        >
          {renderAddOns((priceFor) => (
            <AddOnBox
              title={t('settings.planPage.planUsage.addons.aiMax.title')}
              description={t('settings.planPage.planUsage.addons.aiMax.description')}
              price={priceFor(SubscriptionPlan.AIMax)}
              priceInfo={t('settings.planPage.planUsage.addons.aiMax.priceInfo')}
              active={hasAiMax}
              addLabel={t('settings.planPage.planUsage.addons.addLabel')}
              activeLabel={t('settings.planPage.planUsage.addons.activeLabel')}
              onAdd={() => void billing.subscribeWorkspace(SubscriptionPlan.AIMax)}
              testId='plan-addon-ai-max'
            />
          ))}
        </SettingsSection>

      </>
    );
  };

  return (
    <SettingsPanelShell title={t('settings.planPage.title')} testId='plan-panel'>
      {renderContent()}
    </SettingsPanelShell>
  );
}

export default PlanPanel;
