import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BillingService } from '@/application/services/domains';
import { PersonalPlan, PersonalSubscriptionStatus, SubscriptionInterval, SubscriptionStatus } from '@/application/types';
import { ReactComponent as CheckCircleIcon } from '@/assets/icons/check_circle.svg';
import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { notify } from '@/components/_shared/notify';
import { usePricingCatalog } from '@/components/app/hooks/usePricingCatalog';
import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/utils/errors';
import { findPlan, getPlanDisplayPrice } from '@/utils/pricing';

import { SettingsPanelError, SettingsPanelLoading } from './SettingsPanelShell';

type AccountState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; subscriptions: PersonalSubscriptionStatus[] };

/** Mount with the user's uid as its key so account changes discard pending requests. */
export function VaultWorkspaceAddOn() {
  const isHosted = useIsOfficialHosted();

  return isHosted ? <HostedVaultWorkspaceAddOn /> : null;
}

function HostedVaultWorkspaceAddOn() {
  const { t } = useTranslation();
  const pricing = usePricingCatalog();
  const [account, setAccount] = useState<AccountState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const checkoutRequest = useRef<object>();
  const title = t('settings.planPage.planUsage.accountAddons.title');
  const plan = pricing.catalog ? findPlan(pricing.catalog, PersonalPlan.VaultWorkspace) : undefined;
  const price = plan?.kind === 'account_add_on' ? getPlanDisplayPrice(plan, SubscriptionInterval.Year) : null;
  const active = account.status === 'ready' && account.subscriptions.some(
    (subscription) => subscription.plan === PersonalPlan.VaultWorkspace &&
      subscription.subscription_status === SubscriptionStatus.Active
  );

  useEffect(() => {
    let ignore = false;

    setAccount({ status: 'loading' });
    void BillingService.getPersonalSubscriptionStatus().then((subscriptions) => {
      if (!subscriptions) throw new Error('Account subscription status unavailable');
      if (!ignore) setAccount({ status: 'ready', subscriptions });
    }).catch(() => {
      if (!ignore) setAccount({ status: 'error' });
    });

    return () => { ignore = true; };
  }, [attempt]);

  useEffect(() => () => { checkoutRequest.current = undefined; }, []);

  const retry = () => {
    setAttempt((value) => value + 1);
    void pricing.reload();
  };

  const subscribe = async () => {
    if (account.status !== 'ready' || active || price === null || checkoutRequest.current) return;
    const request = {};

    checkoutRequest.current = request;
    setBusy(true);
    try {
      const link = await BillingService.getPersonalSubscriptionLink(PersonalPlan.VaultWorkspace, SubscriptionInterval.Year);

      if (checkoutRequest.current === request && link) window.open(link, '_current');
    } catch (error) {
      if (checkoutRequest.current === request) notify.error(getErrorMessage(error));
    } finally {
      if (checkoutRequest.current === request) {
        checkoutRequest.current = undefined;
        setBusy(false);
      }
    }
  };

  const renderContent = () => {
    if (account.status === 'error') {
      return <SettingsPanelError error={{ message: t('settings.planPage.planUsage.accountAddons.unavailable') }} onRetry={retry} />;
    }

    if (account.status === 'loading' || (!pricing.catalog && pricing.isLoading)) {
      return <SettingsPanelLoading label={title} />;
    }

    if (!plan || price === null) {
      return <SettingsPanelError error={{ message: t('subscribe.pricingUnavailable') }} onRetry={retry} />;
    }

    return (
      <div
        className={cn(
          'flex min-h-[186px] flex-col rounded-[16px] border bg-[#F7F8FC]/5 px-4 py-3',
          active ? 'border-[#BDBDBD]' : 'border-[#9C00FB]'
        )}
        data-testid='plan-addon-vault'
      >
        <div className='flex items-center gap-1'>
          <h4 className='text-sm font-semibold text-text-primary'>{plan.name}</h4>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href='https://appflowy.com/guide/vault-workspace'
                target='_blank'
                rel='noopener noreferrer'
                aria-label={t('settings.planPage.planUsage.accountAddons.learnMore')}
                className='text-icon-secondary'
              >
                <InfoIcon className='h-4 w-4' />
              </a>
            </TooltipTrigger>
            <TooltipContent>{t('settings.planPage.planUsage.accountAddons.learnMore')}</TooltipContent>
          </Tooltip>
        </div>
        <p className='mt-2.5 text-xs text-text-secondary'>{plan.description}</p>
        <div className='mt-2.5 text-2xl text-text-primary'>{price}</div>
        <p className='text-xs text-text-primary'>{t('settings.planPage.planUsage.accountAddons.annualPriceInfo')}</p>
        <button
          type='button'
          onClick={() => void subscribe()}
          disabled={active || busy}
          data-testid='plan-addon-vault-action'
          className={cn(
            'mt-8 flex w-full items-center justify-center gap-1 rounded-[16px] border px-4 py-1.5 text-xs font-medium disabled:cursor-default',
            active
              ? 'border-[#E8E2EE] bg-[#E8E2EE] text-[#5C3699]'
              : 'border-[#5C3699] text-[#5C3699] hover:bg-[#5C3699] hover:text-white disabled:opacity-50 [[data-dark-mode=true]_&]:bg-[#5C3699] [[data-dark-mode=true]_&]:text-white [[data-dark-mode=true]_&]:hover:bg-[#4D3472]'
          )}
        >
          {active && <CheckCircleIcon className='h-4 w-4' />}
          {t(active ? 'settings.planPage.planUsage.accountAddons.activeLabel' : 'settings.planPage.planUsage.accountAddons.addLabel')}
        </button>
      </div>
    );
  };

  return (
    <section aria-label={title} className='flex flex-col gap-2' data-testid='plan-account-addons'>
      <div className='flex items-center gap-1'>
        <h3 className='text-lg font-semibold text-text-primary'>{title}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type='button' aria-label={title} className='text-icon-secondary'>
              <InfoIcon className='h-4 w-4' />
            </button>
          </TooltipTrigger>
          <TooltipContent className='max-w-[600px]'>{t('settings.planPage.planUsage.accountAddons.tooltip')}</TooltipContent>
        </Tooltip>
      </div>
      {renderContent()}
    </section>
  );
}
