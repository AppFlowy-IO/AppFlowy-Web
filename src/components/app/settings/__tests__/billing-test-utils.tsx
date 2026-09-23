import { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import {
  PricingCatalog,
  SubscriptionInterval,
  SubscriptionPlan,
  SubscriptionStatus,
  WorkspaceSubscriptionStatus,
  WorkspaceUsageAndLimit,
} from '@/application/types';
import { AppOperationsContext, AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';

export const PERIOD_END = 1_800_014_400;

export const translations: Record<string, string> = {
  'settings.billingPage.title': 'Billing',
  'settings.billingPage.plan.title': 'Plan',
  'settings.billingPage.plan.freeLabel': 'Free',
  'settings.billingPage.plan.proLabel': 'Pro',
  'settings.billingPage.plan.planButtonLabel': 'Change plan',
  'settings.billingPage.plan.billingPeriod': 'Billing period',
  'settings.billingPage.plan.periodButtonLabel': 'Edit period',
  'settings.billingPage.paymentDetails.title': 'Payment details',
  'settings.billingPage.paymentDetails.methodLabel': 'Payment method',
  'settings.billingPage.paymentDetails.methodButtonLabel': 'Edit method',
  'settings.billingPage.addons.title': 'Add-ons',
  'settings.billingPage.addons.addLabel': 'Add',
  'settings.billingPage.addons.removeLabel': 'Remove',
  'settings.billingPage.addons.renewLabel': 'Renew',
  'settings.billingPage.addons.aiMax.label': 'AI Max',
  'settings.billingPage.addons.aiMax.description': 'Unlock unlimited AI and advanced models',
  'settings.billingPage.addons.aiMax.activeDescription': 'Next invoice due on {}',
  'settings.billingPage.addons.aiMax.canceledDescription': 'AI Max will be available until {}',
  'settings.billingPage.addons.removeDialog.title': 'Remove {}',
  'settings.billingPage.addons.removeDialog.description': 'Are you sure you want to remove {plan}? {plan} ends now.',
  'settings.billingPage.planPeriod': '{} period',
  'settings.billingPage.monthlyInterval': 'Monthly',
  'settings.billingPage.annualInterval': 'Annually',
  'settings.billingPage.monthlyPriceInfo': 'per seat billed monthly',
  'settings.billingPage.annualPriceInfo': 'per seat billed annually',
  'settings.billingPage.currentPeriodBadge': 'CURRENT',
  'settings.billingPage.changePeriod': 'Change period',
  'settings.planPage.title': 'Pricing plan',
  'settings.planPage.planUsage.title': 'Plan usage summary',
  'settings.planPage.planUsage.storageLabel': 'Storage',
  'settings.planPage.planUsage.storageUsage': '{} of {} GB',
  'settings.planPage.planUsage.unlimitedStorageLabel': 'Unlimited storage',
  'settings.planPage.planUsage.aiResponseLabel': 'AI Responses',
  'settings.planPage.planUsage.aiResponseUsage': '{} of {}',
  'settings.planPage.planUsage.unlimitedAILabel': 'Unlimited responses',
  'settings.planPage.planUsage.proBadge': 'Pro',
  'settings.planPage.planUsage.aiMaxBadge': 'AI Max',
  'settings.planPage.planUsage.memberProToggle': 'More members & unlimited AI',
  'settings.planPage.planUsage.aiMaxToggle': 'Unlimited AI and advanced models',
  'settings.planPage.planUsage.currentPlan.bannerLabel': 'Current plan',
  'settings.planPage.planUsage.currentPlan.freeTitle': 'Free',
  'settings.planPage.planUsage.currentPlan.proTitle': 'Pro',
  'settings.planPage.planUsage.currentPlan.teamTitle': 'Team',
  'settings.planPage.planUsage.currentPlan.freeInfo': 'Perfect for individuals',
  'settings.planPage.planUsage.currentPlan.proInfo': 'Perfect for teams',
  'settings.planPage.planUsage.currentPlan.upgrade': 'Change plan',
  'settings.planPage.planUsage.currentPlan.canceledInfo': 'Downgraded to Free on {}.',
  'settings.planPage.planUsage.addons.title': 'Workspace Add-ons',
  'settings.planPage.planUsage.addons.addLabel': 'Add',
  'settings.planPage.planUsage.addons.activeLabel': 'Added',
  'settings.planPage.planUsage.addons.aiMax.title': 'AI Max',
  'settings.planPage.planUsage.addons.aiMax.priceInfo': 'Per user per month billed annually',
  'subscribe.pricingUnavailable': 'Pricing unavailable',
  'button.retry': 'Retry',
  'button.confirm': 'Confirm',
  'button.cancel': 'Cancel',
};

export const translate = (key: string, options?: Record<string, unknown>) =>
  translations[key] ?? (options?.defaultValue as string | undefined) ?? key;

export function workspaceStatus(
  plan: WorkspaceSubscriptionStatus['workspace_plan'],
  overrides: Partial<WorkspaceSubscriptionStatus> = {}
): WorkspaceSubscriptionStatus {
  return {
    workspace_id: 'workspace-1',
    workspace_plan: plan,
    recurring_interval: SubscriptionInterval.Year,
    subscription_status: SubscriptionStatus.Active,
    subscription_quantity: 1,
    cancel_at: null,
    current_period_end: PERIOD_END,
    ...overrides,
  };
}


export const freeUsage: WorkspaceUsageAndLimit = {
  member_count: 1,
  member_count_limit: 2,
  storage_bytes: 1024 ** 3,
  storage_bytes_limit: 5 * 1024 ** 3,
  storage_bytes_unlimited: false,
  single_upload_limit: 7 * 1024 ** 2,
  single_upload_unlimited: false,
  ai_responses_count: 3,
  ai_responses_count_limit: 10,
  local_ai: false,
  ai_responses_unlimited: false,
};

export const proUsage: WorkspaceUsageAndLimit = {
  ...freeUsage,
  storage_bytes_unlimited: true,
  ai_responses_unlimited: true,
};

export const catalog: PricingCatalog = {
  version: 1,
  currency: 'USD',
  annual_discount_percent: 20,
  plans: [
    { id: 'free', kind: 'workspace_plan', name: 'Free', description: '', prices: [], features: [] },
    {
      id: SubscriptionPlan.Pro,
      kind: 'workspace_plan',
      name: 'Pro',
      description: '',
      prices: [
        { interval: SubscriptionInterval.Month, price_cents: 1250 },
        { interval: SubscriptionInterval.Year, price_cents: 12000 },
      ],
      features: [],
    },
    {
      id: SubscriptionPlan.AIMax,
      kind: 'workspace_add_on',
      name: 'AI Max',
      description: '',
      prices: [
        { interval: SubscriptionInterval.Month, price_cents: 1000 },
        { interval: SubscriptionInterval.Year, price_cents: 9600 },
      ],
      features: [],
    },
  ],
  comparison: [],
};

export function LocationProbe() {
  const location = useLocation();

  return <div data-testid='location-search'>{location.search}</div>;
}

export function BillingTestProviders({
  children,
  getPricingCatalog = async () => catalog,
}: {
  children: ReactNode;
  getPricingCatalog?: () => Promise<PricingCatalog>;
}) {
  return (
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AppOperationsContext.Provider value={{ getPricingCatalog } as unknown as AppOperationsContextType}>
        {children}
        <LocationProbe />
      </AppOperationsContext.Provider>
    </MemoryRouter>
  );
}
