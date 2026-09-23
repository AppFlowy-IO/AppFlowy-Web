import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PricingCatalog, Subscription, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { AppOperationsContext, AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { resetPricingCatalogCache } from '@/components/app/hooks/usePricingCatalog';
import UpgradePlan from '@/components/billing/UpgradePlan';

const mockTranslations: Record<string, string> = {
  'subscribe.feature.storage': 'Storage',
  'subscribe.value.unlimited': 'Unlimited',
  // Desktop-style price note with the monthly price placeholder.
  'settings.comparePlanDialog.proPlan.priceInfo': 'Per user per month \nbilled annually\n\n{} billed monthly',
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'subscribe.save') return `Save ${String(options?.discount)}%`;

      return mockTranslations[key] ?? (options?.defaultValue as string | undefined) ?? key;
    },
  }),
}));

jest.mock('@/application/services/domains', () => ({
  BillingService: { getSubscriptionLink: jest.fn(), getPricingCatalog: jest.fn() },
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/components/billing/CancelSubscribe', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ open, title, children }: { open: boolean; title?: ReactNode; children?: ReactNode }) =>
    open ? (
      <div>
        <div>{title}</div>
        {children}
      </div>
    ) : null,
}));

const catalog: PricingCatalog = {
  version: 1,
  currency: 'USD',
  annual_discount_percent: 20,
  plans: [
    {
      id: 'free',
      kind: 'workspace_plan',
      name: 'Free',
      description: 'Server free description',
      prices: [],
      features: [{ key: 'members', label: 'Up to 2 members', value: { kind: 'quantity', amount: 2, unit: 'members', display: 'Up to 2' } }],
    },
    {
      id: 'pro',
      kind: 'workspace_plan',
      name: 'Pro',
      description: 'Server pro description',
      prices: [
        { interval: SubscriptionInterval.Month, price_cents: 1250 },
        { interval: SubscriptionInterval.Year, price_cents: 12000 },
      ],
      features: [
        { key: 'storage', label: 'Unlimited storage', value: { kind: 'unlimited', display: 'Unlimited' } },
        { key: 'members', label: 'Up to 10 workspace members', value: { kind: 'quantity', amount: 10, unit: 'members', display: 'Up to 10' } },
        { key: 'guests', label: 'No guests', value: { kind: 'excluded', display: 'no' } },
      ],
    },
    {
      id: 'ai_max',
      kind: 'workspace_add_on',
      name: 'AI Max',
      description: 'Server AI Max description',
      prices: [{ interval: SubscriptionInterval.Year, price_cents: 9600 }],
      features: [],
    },
  ],
  comparison: [
    {
      key: 'workspaces',
      label: 'Workspaces',
      tooltip: null,
      values: {
        free: { kind: 'text', display: 'Charged per workspace' },
        pro: { kind: 'text', display: 'Charged per workspace' },
      },
    },
    {
      key: 'members',
      label: 'Members',
      tooltip: null,
      values: {
        free: { kind: 'quantity', amount: 2, unit: 'members', display: 'Up to 2' },
        pro: { kind: 'quantity', amount: 10, unit: 'members', display: 'Up to 10' },
      },
    },
    {
      key: 'realtime_collaboration',
      label: 'Real-time collaboration',
      tooltip: null,
      values: {
        free: { kind: 'included', display: 'yes' },
        pro: { kind: 'included', display: 'yes' },
      },
    },
    {
      key: 'guests',
      label: 'Guest editors',
      tooltip: 'Collaborate on specific pages with non-members',
      values: {
        free: { kind: 'excluded', display: 'no' },
        pro: { kind: 'quantity', amount: 10, unit: 'guests', display: 'Up to 10' },
      },
    },
    {
      key: 'storage',
      label: 'Storage',
      tooltip: null,
      values: {
        free: { kind: 'quantity', amount: 5, unit: 'gb', display: '5 GB' },
        pro: { kind: 'unlimited', display: 'Unlimited' },
      },
    },
  ],
};

function renderModal(
  getPricingCatalog: () => Promise<PricingCatalog>,
  { isOfficialHosted = true, subscriptions = [] as Subscription[] } = {}
) {
  return render(
    <MemoryRouter>
      <AuthInternalContext.Provider
        value={{
          currentWorkspaceId: 'workspace-id',
          isAuthenticated: true,
          isOfficialHosted,
          onChangeWorkspace: async () => undefined,
        }}
      >
        <AppOperationsContext.Provider
          value={{ getSubscriptions: async () => subscriptions, getPricingCatalog } as unknown as AppOperationsContextType}
        >
          <UpgradePlan open onClose={() => undefined} onOpen={() => undefined} />
        </AppOperationsContext.Provider>
      </AuthInternalContext.Provider>
    </MemoryRouter>
  );
}

describe('UpgradePlan', () => {
  beforeEach(() => {
    resetPricingCatalogCache();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the comparison table with Pro highlighted as the upgrade target', async () => {
    renderModal(async () => catalog);

    const proColumn = await screen.findByTestId('pricing-plan-pro');
    const freeColumn = screen.getByTestId('pricing-plan-free');

    // Free is the current plan; Pro is the upgrade target and therefore highlighted, like the desktop dialog.
    expect(within(freeColumn).getByTestId('current-plan-badge')).toBeTruthy();
    expect(within(proColumn).queryByTestId('current-plan-badge')).toBeNull();
    expect(proColumn.getAttribute('data-highlighted')).toBe('true');
    expect(freeColumn.getAttribute('data-highlighted')).toBe('false');

    // Annual per-month price with the monthly note, desktop style; no interval tabs.
    expect(within(proColumn).getByText('US$10')).toBeTruthy();
    expect(within(proColumn).getByText(/US\$12\.5/)).toBeTruthy();
    expect(within(freeColumn).getByText('US$0')).toBeTruthy();
    expect(within(freeColumn).getByText('settings.comparePlanDialog.freePlan.priceInfo')).toBeTruthy();
    expect(screen.queryByText('subscribe.monthly')).toBeNull();
    expect(screen.queryByTestId('pricing-plan-ai_max')).toBeNull();

    // Comparison rows from the catalog: labels, values, check marks and blank cells.
    const table = screen.getByTestId('plan-comparison');

    expect(within(table).getByText('Members')).toBeTruthy();
    expect(within(table).getByText('Guest editors')).toBeTruthy();
    expect(within(freeColumn).getByText('Up to 2')).toBeTruthy();
    expect(within(proColumn).getAllByText('Up to 10')).toHaveLength(2);
    expect(within(proColumn).getByText('Unlimited')).toBeTruthy();
    expect(within(freeColumn).getByText('5 GB')).toBeTruthy();
    expect(within(freeColumn).getAllByTestId('feature-included')).toHaveLength(1);
    expect(within(freeColumn).getAllByTestId('feature-excluded')).toHaveLength(1);
    expect(within(proColumn).getAllByTestId('feature-included')).toHaveLength(1);

    // Only the upgrade target has a button, and it checks out yearly.
    expect(within(freeColumn).queryByTestId('pricing-downgrade-free')).toBeNull();
    const { BillingService } = jest.requireMock('@/application/services/domains');

    BillingService.getSubscriptionLink.mockResolvedValue('https://checkout.example');
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    fireEvent.click(within(proColumn).getByTestId('pricing-upgrade-pro'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://checkout.example', '_current'));
    expect(BillingService.getSubscriptionLink).toHaveBeenCalledWith(
      'workspace-id',
      SubscriptionPlan.Pro,
      SubscriptionInterval.Year
    );
  });

  it('marks Pro as current and offers a downgrade on Free for a Pro workspace', async () => {
    renderModal(async () => catalog, {
      subscriptions: [
        { plan: SubscriptionPlan.Pro, currency: 'USD', price_cents: 1250, recurring_interval: SubscriptionInterval.Month },
      ],
    });

    const proColumn = await screen.findByTestId('pricing-plan-pro');
    const freeColumn = screen.getByTestId('pricing-plan-free');

    await waitFor(() => expect(within(proColumn).getByTestId('current-plan-badge')).toBeTruthy());
    expect(proColumn.getAttribute('data-highlighted')).toBe('false');
    expect(within(proColumn).queryByTestId('pricing-upgrade-pro')).toBeNull();
    expect(within(freeColumn).getByTestId('pricing-downgrade-free')).toBeTruthy();
  });

  it('shows skeleton cards while the catalog loads', () => {
    renderModal(() => new Promise<PricingCatalog>(() => undefined));

    expect(screen.getByTestId('pricing-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('pricing-plan-pro')).toBeNull();
  });

  it('offers a retry when the catalog cannot be loaded and recovers on success', async () => {
    const getPricingCatalog = jest
      .fn<Promise<PricingCatalog>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(catalog);

    renderModal(getPricingCatalog);

    const errorState = await screen.findByTestId('pricing-error');

    expect(within(errorState).getByText('subscribe.pricingUnavailable')).toBeTruthy();
    expect(screen.queryByTestId('pricing-plan-pro')).toBeNull();

    fireEvent.click(within(errorState).getByText('button.retry'));

    const proColumn = await screen.findByTestId('pricing-plan-pro');

    expect(within(proColumn).getByText('US$10')).toBeTruthy();
    expect(getPricingCatalog).toHaveBeenCalledTimes(2);
  });

  it('hides paid plans when server-info did not confirm the official cloud', async () => {
    renderModal(async () => catalog, { isOfficialHosted: false });

    await screen.findByTestId('pricing-plan-free');
    expect(screen.queryByTestId('pricing-plan-pro')).toBeNull();
  });
});
