import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { SubscriptionPlan, WorkspaceUsageAndLimit } from '@/application/types';
import { ReactComponent as CheckCircleIcon } from '@/assets/icons/check_circle.svg';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { findWorkspaceAddOn, formatStorageGb, isSubscriptionCanceled } from '@/utils/subscription';

import { fillPlaceholders, formatPeriodEnd, userDateFormat } from './billing/labels';
import { SettingsPanelError, SettingsPanelLoading, SettingsPanelShell } from './billing/SettingsPanelShell';
import { useWorkspaceBilling } from './billing/useWorkspaceBilling';

// Styles mirror the desktop plan page (settings_plan_view/widgets): 8px usage
// bars with the figure beside them, purple "Pro" badges, a "Current plan" tab
// over the plan box and a gradient "Change plan" button. The app switches
// themes with `data-dark-mode=true` on the root element, not Tailwind's `dark:`.
const PRO_BADGE_CLASS =
  'bg-[#E8E2EE] text-[#653E8C] [[data-dark-mode=true]_&]:bg-[#653E8C] [[data-dark-mode=true]_&]:text-[#E8E2EE]';
const PROGRESS_TRACK_CLASS =
  'border border-[#DDF1F7] bg-fill-secondary [[data-dark-mode=true]_&]:border-[rgba(221,241,247,0.1)]';
const GRADIENT_BUTTON_CLASS =
  'bg-[linear-gradient(135deg,#44326B,#7547C0)] hover:bg-[linear-gradient(135deg,#39285C,#6035A4)]';

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
    <div className='flex flex-1 flex-col gap-1' data-testid={testId}>
      <div className='text-[11px] font-medium text-text-secondary'>{title}</div>
      {unlimited ? (
        <div className='flex items-center gap-1 text-[11px] font-medium text-text-primary'>
          <CheckCircleIcon className='h-4 w-4 text-[#9C00FB]' />
          <span>{unlimitedLabel}</span>
        </div>
      ) : (
        <div className='flex items-center gap-2 pr-4'>
          <div
            className={cn('h-2 flex-1 overflow-hidden rounded-[8px]', PROGRESS_TRACK_CLASS)}
            role='progressbar'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className={cn('h-full', ratio >= 1 ? 'bg-function-error' : 'bg-fill-theme-thick')}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className='shrink-0 text-[11px] font-medium text-text-secondary'>{label}</div>
        </div>
      )}
    </div>
  );
}

function UpgradeToggle({
  label,
  badge,
  onToggle,
  testId,
}: {
  label: string;
  badge: string;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <div className='flex items-center' data-testid={testId}>
      <Switch checked={false} onCheckedChange={onToggle} aria-label={label} />
      <span className='ml-2.5 text-sm text-text-primary'>{label}</span>
      <span
        className={cn(
          'ml-2.5 inline-flex h-[26px] items-center rounded-full px-2.5 text-xs font-semibold',
          PRO_BADGE_CLASS
        )}
      >
        {badge}
      </span>
    </div>
  );
}

function GradientButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <button
      type='button'
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'max-w-[220px] rounded-[16px] px-5 py-2 text-center text-base font-semibold text-white shadow-[0_2px_4px_rgba(0,0,0,0.25)]',
        GRADIENT_BUTTON_CLASS
      )}
    >
      {label}
    </button>
  );
}

function usageRatio(used: number, limit: number): number {
  return limit > 0 ? used / limit : 0;
}

/** Settings > Plan: usage summary, Pro upgrade toggles and the current plan, mirroring the desktop page. */
export function PlanPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const [, setSearch] = useSearchParams();
  const currentUser = useCurrentUserOptional();
  const dateFormat = userDateFormat(currentUser?.metadata);
  const billing = useWorkspaceBilling(workspaceId);
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

  const renderContent = () => {
    if (status === 'error') return <SettingsPanelError error={error} onRetry={() => void reload()} />;
    if (!info || !usage) return <SettingsPanelLoading label={t('settings.planPage.title')} />;

    // A workspace that still has the retired AI Max add-on already has unlimited AI.
    const hasAiMax = findWorkspaceAddOn(info, SubscriptionPlan.AIMax) !== null;
    const canceled = info.subscription && isSubscriptionCanceled(info.subscription);

    return (
      <div className='flex flex-col gap-4'>
        <div className='text-base font-semibold text-text-secondary'>{t('settings.planPage.planUsage.title')}</div>
        {renderUsage(usage)}
        <div className='flex flex-col gap-1'>
          {info.plan === SubscriptionPlan.Free && (
            <UpgradeToggle
              label={t('settings.planPage.planUsage.memberProToggle')}
              badge={t('settings.planPage.planUsage.proBadge')}
              onToggle={() => void billing.subscribeWorkspace(SubscriptionPlan.Pro)}
              testId='plan-toggle-pro'
            />
          )}
          {/* Unlimited AI comes with Pro; AI Max is no longer sold. */}
          {!hasAiMax && !usage.ai_responses_unlimited && (
            <UpgradeToggle
              label={t('settings.planPage.planUsage.aiMaxToggle')}
              badge={t('settings.planPage.planUsage.proBadge')}
              onToggle={() => void billing.subscribeWorkspace(SubscriptionPlan.Pro)}
              testId='plan-toggle-unlimited-ai'
            />
          )}
        </div>

        <div className='relative' data-testid='current-plan-box'>
          <div className='mt-4 rounded-[16px] border border-[#BDBDBD] p-4'>
            <div className='flex items-center gap-4'>
              <div className='flex flex-[6] flex-col'>
                <div className='mt-1 text-2xl font-semibold text-text-primary'>{planTitle(info.plan)}</div>
                <div className='mt-2 line-clamp-3 text-sm text-text-primary'>{planInfo(info.plan)}</div>
              </div>
              <div className='flex flex-[5] justify-center'>
                <GradientButton
                  label={t('settings.planPage.planUsage.currentPlan.upgrade')}
                  onClick={openChangePlan}
                  testId='plan-change-plan'
                />
              </div>
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
          {/* The badge covers the box's top-left corner like the desktop's tab. */}
          <span className='absolute left-0 top-0 flex h-[30px] items-center rounded-[4px] rounded-bl-none bg-[#4F3F5F] px-6 text-sm font-semibold text-white'>
            {t('settings.planPage.planUsage.currentPlan.bannerLabel')}
          </span>
        </div>
      </div>
    );
  };

  return (
    <SettingsPanelShell title={t('settings.planPage.title')} testId='plan-panel'>
      {renderContent()}
    </SettingsPanelShell>
  );
}

export default PlanPanel;
