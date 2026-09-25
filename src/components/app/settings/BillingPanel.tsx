import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { SubscriptionInterval, SubscriptionPlan, WorkspaceSubscriptionStatus } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { findWorkspaceAddOn, isBillingPortalEnabled, isSubscriptionCanceled } from '@/utils/subscription';

import { ChangePeriodDialog } from './billing/ChangePeriodDialog';
import {
  fillNamedPlaceholder,
  fillPlaceholders,
  formatPeriodEnd,
  intervalLabel,
  userDateFormat,
  workspacePlanLabel,
} from './billing/labels';
import { SettingActionRow } from './billing/SettingActionRow';
import {
  SettingsDivider,
  SettingsPanelError,
  SettingsPanelLoading,
  SettingsPanelShell,
  SettingsSection,
} from './billing/SettingsPanelShell';
import { useWorkspaceBilling } from './billing/useWorkspaceBilling';

interface PeriodEdit {
  plan: SubscriptionPlan;
  interval: SubscriptionInterval;
}

interface RemoveConfirm {
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
}

/** Settings > Billing: current plan, billing period, payment method and add-on subscriptions. */
export function BillingPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const [, setSearch] = useSearchParams();
  const currentUser = useCurrentUserOptional();
  const dateFormat = userDateFormat(currentUser?.metadata);
  const billing = useWorkspaceBilling(workspaceId);
  const [periodEdit, setPeriodEdit] = useState<PeriodEdit | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<RemoveConfirm | null>(null);

  const openChangePlan = useCallback(() => {
    // The upgrade modal mounted by the workspace menu opens on this search param.
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [setSearch]);

  const { info, status, error, reload, busy } = billing;

  const addOnDescription = useCallback(
    (
      subscription: WorkspaceSubscriptionStatus | null,
      description: string,
      activeDescription: string,
      canceledDescription: string
    ) => {
      if (!subscription) return description;
      const endDate = formatPeriodEnd(subscription.current_period_end, dateFormat);

      return fillPlaceholders(isSubscriptionCanceled(subscription) ? canceledDescription : activeDescription, endDate);
    },
    [dateFormat]
  );

  const renderContent = () => {
    if (status === 'error') return <SettingsPanelError error={error} onRetry={() => void reload()} />;
    if (!info) return <SettingsPanelLoading label={t('settings.billingPage.title')} />;

    const portalEnabled = isBillingPortalEnabled(info);
    const aiMax = findWorkspaceAddOn(info, SubscriptionPlan.AIMax);
    // AI Max is no longer sold (unlimited AI comes with Pro). A workspace that
    // still has an active AI Max add-on can manage or remove it here; a
    // canceled one simply runs out.
    const activeAiMax = aiMax && !isSubscriptionCanceled(aiMax) ? aiMax : null;
    const aiMaxLabel = t('settings.billingPage.addons.aiMax.label');

    return (
      <>
        <SettingsSection title={t('settings.billingPage.plan.title')}>
          <SettingActionRow
            label={workspacePlanLabel(t, info.plan)}
            buttonLabel={t('settings.billingPage.plan.planButtonLabel')}
            onClick={openChangePlan}
            testId='billing-change-plan'
          />
          {portalEnabled && info.subscription && (
            <SettingActionRow
              label={t('settings.billingPage.plan.billingPeriod')}
              description={intervalLabel(t, info.subscription.recurring_interval)}
              buttonLabel={t('settings.billingPage.plan.periodButtonLabel')}
              variant='outline'
              disabled={busy}
              onClick={() => setPeriodEdit({ plan: info.plan, interval: info.subscription!.recurring_interval })}
              testId='billing-edit-period'
            />
          )}
        </SettingsSection>

        {portalEnabled && (
          <>
            <SettingsDivider />
            <SettingsSection title={t('settings.billingPage.paymentDetails.title')}>
              <SettingActionRow
                label={t('settings.billingPage.paymentDetails.methodLabel')}
                buttonLabel={t('settings.billingPage.paymentDetails.methodButtonLabel')}
                variant='outline'
                onClick={() => void billing.openBillingPortal()}
                testId='billing-edit-payment-method'
              />
            </SettingsSection>
          </>
        )}

        {activeAiMax && (
          <>
            <SettingsDivider />
            <SettingsSection title={t('settings.billingPage.addons.title')}>
              <SettingActionRow
                label={aiMaxLabel}
                description={addOnDescription(
                  activeAiMax,
                  t('settings.billingPage.addons.aiMax.description'),
                  t('settings.billingPage.addons.aiMax.activeDescription'),
                  t('settings.billingPage.addons.aiMax.canceledDescription')
                )}
                buttonLabel={t('settings.billingPage.addons.removeLabel')}
                variant='outline'
                disabled={busy}
                onClick={() =>
                  setRemoveConfirm({
                    title: fillPlaceholders(t('settings.billingPage.addons.removeDialog.title'), aiMaxLabel),
                    description: fillNamedPlaceholder(
                      t('settings.billingPage.addons.removeDialog.description'),
                      'plan',
                      aiMaxLabel
                    ),
                    onConfirm: () => billing.cancelWorkspace(SubscriptionPlan.AIMax),
                  })
                }
                testId='billing-ai-max-action'
              />
              <SettingActionRow
                label={fillPlaceholders(t('settings.billingPage.planPeriod'), aiMaxLabel)}
                description={intervalLabel(t, activeAiMax.recurring_interval)}
                buttonLabel={t('settings.billingPage.plan.periodButtonLabel')}
                variant='outline'
                disabled={busy}
                onClick={() => setPeriodEdit({ plan: SubscriptionPlan.AIMax, interval: activeAiMax.recurring_interval })}
                testId='billing-ai-max-edit-period'
              />
            </SettingsSection>
          </>
        )}
      </>
    );
  };

  return (
    <SettingsPanelShell title={t('settings.billingPage.title')} testId='billing-panel'>
      {renderContent()}

      {periodEdit && (
        <ChangePeriodDialog
          open
          plan={periodEdit.plan}
          currentInterval={periodEdit.interval}
          onClose={() => setPeriodEdit(null)}
          onConfirm={(interval) => void billing.updateInterval(periodEdit.plan, interval)}
        />
      )}

      <NormalModal
        open={removeConfirm !== null}
        title={<div className='w-full text-left'>{removeConfirm?.title}</div>}
        classes={{ paper: 'w-[420px]' }}
        danger
        okText={t('button.confirm')}
        cancelText={t('button.cancel')}
        okLoading={busy}
        okButtonProps={{ 'data-testid': 'billing-remove-confirm' }}
        onOk={() => {
          const confirm = removeConfirm;

          setRemoveConfirm(null);
          if (confirm) void confirm.onConfirm();
        }}
        onCancel={() => setRemoveConfirm(null)}
        onClose={() => setRemoveConfirm(null)}
      >
        <div className='opacity-80'>{removeConfirm?.description}</div>
      </NormalModal>
    </SettingsPanelShell>
  );
}

export default BillingPanel;
